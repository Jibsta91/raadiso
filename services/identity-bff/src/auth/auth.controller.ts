import { Controller, Get, HttpCode, Inject, Logger, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { trace } from '@opentelemetry/api';
import { Public } from '@raadi/service-kit';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config.js';
import { loginCounter, refreshCounter } from '../metrics.js';
import { APP_CONFIG } from '../tokens.js';
import { UsersRepository } from '../users/users.repository.js';
import { ACCOUNT_ACTIONS, type AccountAction, OidcService } from './oidc.service.js';
import {
  afterLoginPath,
  isCsrfSafe,
  keycloakUiLocale,
  normaliseLocale,
  safeReturnTo,
} from './security.js';
import { type SessionData, SessionStore } from './session.store.js';

const REFRESH_SKEW_SEC = 30;
const AUTH_THROTTLE = { default: { limit: 20, ttl: 60_000 } };

type Req = FastifyRequest & { cookies: Record<string, string | undefined> };

@Public()
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly oidc: OidcService,
    private readonly sessions: SessionStore,
    private readonly users: UsersRepository,
  ) {}

  /**
   * Starts the Authorization Code + PKCE flow; `?signup=1` opens registration instead of login, and
   * `?action=` one of ACCOUNT_ACTIONS (add a passkey, set up an authenticator, change the password).
   */
  @Get('login')
  @Throttle(AUTH_THROTTLE)
  async login(@Req() req: Req, @Res() reply: FastifyReply): Promise<void> {
    const query = req.query as Record<string, unknown>;
    const locale = normaliseLocale(query.locale);
    const tx = this.oidc.newTransaction(safeReturnTo(query.returnTo, `/${locale}`));
    await this.sessions.putLoginTransaction(tx.state, tx);
    const signup = query.signup === '1' || query.signup === 'true';
    const action = ACCOUNT_ACTIONS.find((a) => a === query.action) as AccountAction | undefined;
    // `?reauth=1`: ask for the password even with a Keycloak session, for a fresh auth_time (step-up).
    const reauth = query.reauth === '1';
    const url = await this.oidc.authorizationUrl(
      tx,
      keycloakUiLocale(locale),
      signup,
      action,
      reauth,
    );
    this.redirect(reply, 302, url.href);
  }

  /** Completes login: exchanges the code, records the user, issues the session cookie. */
  @Get('callback')
  @Throttle(AUTH_THROTTLE)
  async callback(@Req() req: Req, @Res() reply: FastifyReply): Promise<void> {
    const search = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    const params = new URLSearchParams(search);
    const state = params.get('state') ?? '';
    const tx = await this.sessions.takeLoginTransaction(state);
    if (!tx) {
      loginCounter.add(1, { outcome: 'failure', reason: 'invalid_state' });
      return this.redirect(reply, 302, '/?authError=expired');
    }
    if (params.has('error')) {
      const reason = params.get('error') === 'access_denied' ? 'cancelled' : 'idp_error';
      loginCounter.add(1, { outcome: reason === 'cancelled' ? 'cancelled' : 'failure', reason });
      return this.redirect(reply, 302, `${tx.returnTo.split('?')[0]}?authError=${reason}`);
    }

    let tokens;
    try {
      tokens = await this.oidc.exchangeCode(search, tx, state);
    } catch (error) {
      loginCounter.add(1, { outcome: 'failure', reason: 'code_exchange' });
      this.logger.warn({ err: error }, 'authorization code exchange failed');
      return this.redirect(reply, 302, '/?authError=login_failed');
    }

    const c = tokens.claims;
    const { profile, registered } = await this.users.recordLogin({
      id: String(c.sub),
      email: String(c.email ?? ''),
      displayName: typeof c.name === 'string' ? c.name : undefined,
      locale: normaliseLocale(c.locale === 'no' ? 'nb' : c.locale),
    });

    // Session fixation defence: always a fresh id; drop any previous session.
    await this.sessions.destroy(req.cookies[this.cfg.env.SESSION_COOKIE_NAME]);
    const session: SessionData = {
      user: {
        id: profile.id,
        email: profile.email,
        name: profile.displayName ?? undefined,
        locale: profile.locale,
        roles: tokens.roles,
      },
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      idToken: tokens.idToken,
      accessExpiresAt: tokens.accessExpiresAt,
      createdAt: Math.floor(Date.now() / 1000),
    };
    const sid = await this.sessions.create(session, tokens.refreshExpiresIn);
    trace.getActiveSpan()?.setAttribute('enduser.id', profile.id);
    loginCounter.add(1, { outcome: 'success', reason: registered ? 'first_login' : 'returning' });
    this.logger.log({ userId: profile.id, registered }, 'user logged in');

    void reply.setCookie(this.cfg.env.SESSION_COOKIE_NAME, sid, this.cookieOptions());
    this.redirect(reply, 302, afterLoginPath(tx.returnTo, profile.locale, registered));
  }

  /**
   * Ends the local session, revokes the refresh token and signs out of Keycloak (RP-initiated logout).
   * `?returnTo=` (a same-site path, as for login) is where Keycloak sends the browser afterwards.
   */
  @Post('logout')
  @HttpCode(303)
  async logout(@Req() req: Req, @Res() reply: FastifyReply): Promise<void> {
    if (!isCsrfSafe(req.method, req.headers, this.cfg.allowedOrigins)) {
      return void reply
        .status(403)
        .send({ status: 403, title: 'forbidden', detail: 'Cross-site request rejected' });
    }
    const sid = req.cookies[this.cfg.env.SESSION_COOKIE_NAME];
    const session = await this.sessions.get(sid);
    await this.sessions.destroy(sid);
    if (session?.refreshToken) {
      await this.oidc
        .revoke(session.refreshToken)
        .catch((err) => this.logger.warn({ err }, 'token revocation failed'));
    }
    void reply.clearCookie(this.cfg.env.SESSION_COOKIE_NAME, { path: '/' });
    const returnTo = safeReturnTo((req.query as Record<string, unknown>).returnTo);
    this.redirect(reply, 303, this.oidc.endSessionUrl(session?.idToken, returnTo));
  }

  /** Session status for the web app. Never exposes tokens. */
  @Get('session')
  async session(@Req() req: Req, @Res() reply: FastifyReply): Promise<void> {
    const session = await this.sessions.get(req.cookies[this.cfg.env.SESSION_COOKIE_NAME]);
    void reply
      .header('cache-control', 'no-store')
      .send(session ? { authenticated: true, user: session.user } : { authenticated: false });
  }

  /**
   * Traefik forwardAuth target (internal only — the public router excludes it).
   * Converts the session cookie into a short-lived access token on the upstream
   * request. Requests without a session pass through untouched (a mobile bearer
   * token, or anonymous); every service still validates the JWT itself.
   */
  @Get('forward')
  @Throttle({ default: { limit: 100_000, ttl: 60_000 } })
  async forward(@Req() req: Req, @Res() reply: FastifyReply): Promise<void> {
    const sid = req.cookies[this.cfg.env.SESSION_COOKIE_NAME];
    const session = sid ? await this.sessions.get(sid) : null;
    if (!sid || !session) {
      // No browser session: pass the caller's own bearer token (the native app's) back unchanged.
      // Traefik drops request headers listed in authResponseHeaders unless the answer carries them,
      // so without this the app's token never reached the services. They validate it themselves.
      const bearer = req.headers.authorization;
      if (typeof bearer === 'string' && /^Bearer [\w.~+/-]+=*$/.test(bearer)) {
        return void reply.status(200).header('authorization', bearer).send();
      }
      return void reply.status(200).send();
    }

    const method = String(req.headers['x-forwarded-method'] ?? 'GET');
    if (!isCsrfSafe(method, req.headers, this.cfg.allowedOrigins)) {
      return void reply.status(403).header('content-type', 'application/problem+json').send({
        type: 'about:blank',
        title: 'forbidden',
        status: 403,
        detail: 'Cross-site request rejected',
      });
    }

    const token = await this.freshAccessToken(sid, session);
    if (!token) return void reply.status(200).send();
    void reply.status(200).header('authorization', `Bearer ${token}`).send();
  }

  private async freshAccessToken(sid: string, session: SessionData): Promise<string | null> {
    const now = Math.floor(Date.now() / 1000);
    if (session.accessExpiresAt - REFRESH_SKEW_SEC > now) return session.accessToken;
    if (!session.refreshToken) return null;

    const refreshed = await this.sessions.withRefreshLock(sid, async () => {
      // Re-read under the lock: a request that held it just before us may already have
      // refreshed, and the refresh token we read earlier is then spent (single use).
      const current = await this.sessions.get(sid);
      if (!current?.refreshToken) return null;
      if (current.accessExpiresAt - REFRESH_SKEW_SEC > Math.floor(Date.now() / 1000)) {
        return current.accessToken;
      }
      try {
        const t = await this.oidc.refresh(current.refreshToken);
        const next: SessionData = {
          ...current,
          user: { ...current.user, roles: t.roles },
          accessToken: t.accessToken,
          refreshToken: t.refreshToken ?? current.refreshToken,
          idToken: t.idToken ?? current.idToken,
          accessExpiresAt: t.accessExpiresAt,
        };
        await this.sessions.save(sid, next, t.refreshExpiresIn);
        refreshCounter.add(1, { outcome: 'success' });
        return next.accessToken;
      } catch (error) {
        refreshCounter.add(1, { outcome: 'failure' });
        this.logger.warn({ err: error }, 'token refresh failed; ending session');
        await this.sessions.destroy(sid);
        return null;
      }
    });
    if (refreshed !== null) return refreshed;

    // Another request holds the lock: wait briefly for its result.
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const latest = await this.sessions.get(sid);
      if (!latest) return null;
      if (latest.accessExpiresAt - REFRESH_SKEW_SEC > now) return latest.accessToken;
    }
    return null;
  }

  private cookieOptions() {
    return {
      httpOnly: true,
      secure: this.cfg.cookieSecure,
      sameSite: 'lax' as const,
      path: '/',
      maxAge: this.cfg.env.SESSION_MAX_AGE_SEC,
    };
  }

  private redirect(reply: FastifyReply, status: number, location: string): void {
    void reply
      .status(status)
      .header('location', location)
      .header('cache-control', 'no-store')
      .send();
  }
}
