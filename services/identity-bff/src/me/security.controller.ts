import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  type AuthenticatedRequest,
  circuitBreaker,
  STEP_UP_MAX_AGE,
  StepUpRequiredException,
} from '@raadi/service-kit';
import type { AppConfig } from '../config.js';
import { APP_CONFIG } from '../tokens.js';

/** One signed-in session on one device (browser or app), as Keycloak sees it. */
export interface SecuritySession {
  id: string;
  browser: string;
  os: string;
  device: string;
  mobile: boolean;
  ip: string | null;
  startedAt: string;
  lastAccessAt: string;
  expiresAt: string;
  apps: string[];
  current: boolean;
}

export interface SignInMethod {
  type: 'password' | 'otp' | 'webauthn-passwordless' | 'webauthn';
  removable: boolean;
  credentials: Array<{ id: string; label: string | null; createdAt: string | null }>;
}

export interface SecurityOverview {
  sessions: SecuritySession[];
  methods: SignInMethod[];
  /** When the person last entered their password (auth_time): removing a method needs it recent. */
  signedInAt: string | null;
}

interface KcDevice {
  os?: string;
  device?: string;
  mobile?: boolean;
  sessions?: Array<{
    id: string;
    ipAddress?: string;
    started: number;
    lastAccess: number;
    expires: number;
    browser?: string;
    current?: boolean;
    clients?: Array<{ clientId: string; clientName?: string }>;
  }>;
}

interface KcCredentialType {
  type: string;
  removeable?: boolean;
  userCredentialMetadatas?: Array<{
    credential: { id: string; userLabel?: string; createdDate?: number };
  }>;
}

const METHODS = ['password', 'otp', 'webauthn-passwordless', 'webauthn'] as const;
/** App names for our OIDC clients; anything else shows its Keycloak client id. */
const APPS: Record<string, string> = {
  'raadi-bff': 'web',
  'raadi-mobile': 'app',
  'raadi-admin': 'console',
  grafana: 'grafana',
};

class AccountApiError extends Error {
  constructor(readonly status: number) {
    super(`Keycloak account API returned ${status}`);
  }
}

/**
 * Keycloak's Account REST API with the user's own token (audience `account`, role
 * manage-account): identity-bff needs no privileges of its own to show and end the user's sessions
 * and manage their sign-in methods (ADR-0031).
 */
@Injectable()
export class AccountClient {
  private readonly base: string;
  private readonly breaker;

  constructor(@Inject(APP_CONFIG) cfg: AppConfig) {
    this.base = `${cfg.realmInternalUrl}/account`;
    this.breaker = circuitBreaker(
      async (token: string, method: string, path: string) => {
        const res = await fetch(`${this.base}${path}`, {
          method,
          headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
          signal: AbortSignal.timeout(4000),
        });
        if (!res.ok) throw new AccountApiError(res.status);
        const text = await res.text();
        return text ? (JSON.parse(text) as unknown) : undefined;
      },
      {
        name: 'keycloak-account',
        timeoutMs: 6000,
        errorFilter: (e) => e instanceof AccountApiError && e.status < 500,
      },
    );
  }

  async call<T>(token: string, method: string, path: string): Promise<T> {
    try {
      return (await this.breaker.fire(token, method, path)) as T;
    } catch (error) {
      if (error instanceof AccountApiError && error.status === 404)
        throw new NotFoundException('Not found');
      if (error instanceof AccountApiError && error.status < 500)
        throw new BadRequestException('Keycloak refused the request');
      throw new ServiceUnavailableException('Account service unavailable');
    }
  }
}

const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

export function toOverview(
  devices: KcDevice[],
  credentials: KcCredentialType[],
  authTime: number | undefined,
): SecurityOverview {
  const sessions = devices.flatMap((d) =>
    (d.sessions ?? []).map((s) => ({
      id: s.id,
      browser: s.browser ?? 'unknown',
      os: d.os ?? 'Other',
      device: d.device ?? 'Other',
      mobile: d.mobile ?? false,
      ip: s.ipAddress ?? null,
      startedAt: iso(s.started),
      lastAccessAt: iso(s.lastAccess),
      expiresAt: iso(s.expires),
      apps: [...new Set((s.clients ?? []).map((c) => APPS[c.clientId] ?? c.clientId))],
      current: s.current ?? false,
    })),
  );
  sessions.sort(
    (a, b) => Number(b.current) - Number(a.current) || b.lastAccessAt.localeCompare(a.lastAccessAt),
  );
  const methods = METHODS.map((type) => {
    const found = credentials.find((c) => c.type === type);
    return {
      type,
      removable: found?.removeable ?? type !== 'password',
      credentials: (found?.userCredentialMetadatas ?? []).map((m) => ({
        id: m.credential.id,
        label: m.credential.userLabel ?? null,
        createdAt: m.credential.createdDate
          ? new Date(m.credential.createdDate).toISOString()
          : null,
      })),
    };
  });
  return { sessions, methods, signedInAt: authTime ? iso(authTime) : null };
}

const ID = /^[\w-]{8,64}$/;
const token = (req: AuthenticatedRequest) => req.headers.authorization!.slice(7);

/** The signed-in user's devices, sessions and sign-in methods (website security page). */
@Controller('api/v1/identity/me')
export class SecurityController {
  constructor(private readonly account: AccountClient) {}

  @Get('security')
  async overview(@Req() req: AuthenticatedRequest): Promise<SecurityOverview> {
    const [devices, credentials] = await Promise.all([
      this.account.call<KcDevice[]>(token(req), 'GET', '/sessions/devices'),
      this.account.call<KcCredentialType[]>(token(req), 'GET', '/credentials'),
    ]);
    return toOverview(devices, credentials, Number(req.principal!.claims.auth_time) || undefined);
  }

  /** Signs one session out (a lost phone, a shared computer). */
  @Delete('sessions/:id')
  @HttpCode(204)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async endSession(@Req() req: AuthenticatedRequest, @Param('id') id: string): Promise<void> {
    if (!ID.test(id)) throw new BadRequestException('Invalid session id');
    await this.account.call(token(req), 'DELETE', `/sessions/${encodeURIComponent(id)}`);
  }

  /** Signs out every other session; this one stays. */
  @Delete('sessions')
  @HttpCode(204)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async endOtherSessions(@Req() req: AuthenticatedRequest): Promise<void> {
    await this.account.call(token(req), 'DELETE', '/sessions?current=false');
  }

  /** Removes a passkey or an authenticator: needs a recent sign-in (RFC 9470 step-up). */
  @Delete('credentials/:id')
  @HttpCode(204)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async removeCredential(@Req() req: AuthenticatedRequest, @Param('id') id: string): Promise<void> {
    if (!ID.test(id)) throw new BadRequestException('Invalid credential id');
    const authTime = Number(req.principal!.claims.auth_time);
    if (!(authTime > Date.now() / 1000 - STEP_UP_MAX_AGE)) {
      throw new StepUpRequiredException(STEP_UP_MAX_AGE);
    }
    await this.account.call(token(req), 'DELETE', `/credentials/${encodeURIComponent(id)}`);
  }
}
