import { circuitBreaker, retry } from '@raadi/service-kit';

export class KeycloakNotFound extends Error {}

class KeycloakHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface KcUser {
  id: string;
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  enabled: boolean;
  emailVerified?: boolean;
  createdTimestamp?: number;
  requiredActions?: string[];
  attributes?: Record<string, string[]>;
}

export interface KcSession {
  id: string;
  ipAddress?: string;
  start: number;
  lastAccess: number;
  clients?: Record<string, string>;
}

export interface KcCredential {
  id: string;
  type: string;
  userLabel?: string;
  createdDate?: number;
}

export interface KcRole {
  id: string;
  name: string;
}

export interface KcEvent {
  time: number;
  type: string;
  clientId?: string;
  ipAddress?: string;
  error?: string;
}

export interface KcBruteForce {
  disabled: boolean;
  numFailures: number;
  lastFailure: number;
}

const transient = (e: unknown) =>
  !(e instanceof KeycloakNotFound) &&
  !(e instanceof KeycloakHttpError && e.status < 500 && e.status !== 429);

/**
 * Keycloak's Admin REST API with the admin-bff service account (ADR-0030): the realm's system of
 * record for accounts, sessions, credentials and roles. Retried on transient errors and guarded by
 * a circuit breaker; 404 is a result, not a failure.
 */
export class KeycloakAdmin {
  private token?: { value: string; expiresAt: number };
  private readonly breaker;
  private readonly base: string;

  constructor(
    private readonly opts: {
      keycloakUrl: string;
      realm: string;
      clientId: string;
      clientSecret: string;
    },
  ) {
    this.base = `${opts.keycloakUrl}/admin/realms/${opts.realm}`;
    this.breaker = circuitBreaker(
      (method: string, path: string, body: unknown) =>
        retry(() => this.call(method, path, body), {
          retries: method === 'GET' ? 2 : 0,
          baseDelayMs: 200,
          shouldRetry: transient,
        }),
      {
        name: 'keycloak-admin',
        timeoutMs: 15_000,
        errorFilter: (e) => !transient(e),
      },
    );
  }

  request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return this.breaker.fire(method, path, body) as Promise<T>;
  }

  // -- users ------------------------------------------------------------------------------
  searchUsers(q: string, first: number, max: number): Promise<KcUser[]> {
    const p = new URLSearchParams({ first: String(first), max: String(max) });
    if (q) p.set('search', q);
    return this.request('GET', `/users?${p}&briefRepresentation=false`);
  }

  async countUsers(q: string): Promise<number> {
    return this.request('GET', `/users/count${q ? `?search=${encodeURIComponent(q)}` : ''}`);
  }

  getUser(id: string): Promise<KcUser> {
    return this.request('GET', `/users/${encodeURIComponent(id)}`);
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const user = await this.getUser(id);
    await this.request('PUT', `/users/${encodeURIComponent(id)}`, { ...user, enabled });
  }

  sessions(id: string): Promise<KcSession[]> {
    return this.request('GET', `/users/${encodeURIComponent(id)}/sessions`);
  }

  /** Ends every session (and with it every refresh token) the user has. */
  signOut(id: string): Promise<void> {
    return this.request('POST', `/users/${encodeURIComponent(id)}/logout`);
  }

  credentials(id: string): Promise<KcCredential[]> {
    return this.request('GET', `/users/${encodeURIComponent(id)}/credentials`);
  }

  deleteCredential(id: string, credentialId: string): Promise<void> {
    return this.request(
      'DELETE',
      `/users/${encodeURIComponent(id)}/credentials/${encodeURIComponent(credentialId)}`,
    );
  }

  /** Sends Keycloak's own e-mail with a link that runs the actions (valid `lifespan` seconds). */
  executeActionsEmail(id: string, actions: string[], lifespan = 43_200): Promise<void> {
    return this.request(
      'PUT',
      `/users/${encodeURIComponent(id)}/execute-actions-email?lifespan=${lifespan}`,
      actions,
    );
  }

  realmRoles(id: string): Promise<KcRole[]> {
    return this.request('GET', `/users/${encodeURIComponent(id)}/role-mappings/realm`);
  }

  addRealmRoles(id: string, roles: KcRole[]): Promise<void> {
    return this.request('POST', `/users/${encodeURIComponent(id)}/role-mappings/realm`, roles);
  }

  removeRealmRoles(id: string, roles: KcRole[]): Promise<void> {
    return this.request('DELETE', `/users/${encodeURIComponent(id)}/role-mappings/realm`, roles);
  }

  role(name: string): Promise<KcRole> {
    return this.request('GET', `/roles/${encodeURIComponent(name)}`);
  }

  roleUsers(name: string, first = 0, max = 500): Promise<KcUser[]> {
    return this.request(
      'GET',
      `/roles/${encodeURIComponent(name)}/users?first=${first}&max=${max}&briefRepresentation=false`,
    );
  }

  /** The user's recent sign-in events (Keycloak keeps them 30 days). */
  events(userId: string, max = 25): Promise<KcEvent[]> {
    return this.request('GET', `/events?user=${encodeURIComponent(userId)}&max=${max}`);
  }

  bruteForce(id: string): Promise<KcBruteForce> {
    return this.request('GET', `/attack-detection/brute-force/users/${encodeURIComponent(id)}`);
  }

  clearBruteForce(id: string): Promise<void> {
    return this.request('DELETE', `/attack-detection/brute-force/users/${encodeURIComponent(id)}`);
  }

  async ping(): Promise<void> {
    await this.accessToken();
  }

  // -- transport --------------------------------------------------------------------------
  private async call(method: string, path: string, body: unknown): Promise<unknown> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${await this.accessToken()}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(4000),
    });
    if (res.status === 404) throw new KeycloakNotFound(`${method} ${path.split('?')[0]}: 404`);
    if (res.status === 401) this.token = undefined;
    if (!res.ok) {
      throw new KeycloakHttpError(
        res.status,
        `Keycloak ${method} ${path.split('?')[0]} returned ${res.status}`,
      );
    }
    const text = await res.text();
    return text ? (JSON.parse(text) as unknown) : undefined;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;
    const res = await fetch(
      `${this.opts.keycloakUrl}/realms/${this.opts.realm}/protocol/openid-connect/token`,
      {
        method: 'POST',
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.opts.clientId,
          client_secret: this.opts.clientSecret,
        }),
        signal: AbortSignal.timeout(3000),
      },
    );
    if (!res.ok) throw new Error(`Keycloak token endpoint returned ${res.status}`);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
    return this.token.value;
  }
}
