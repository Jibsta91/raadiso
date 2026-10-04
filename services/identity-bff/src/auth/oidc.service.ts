import { Inject, Injectable } from '@nestjs/common';
import { circuitBreaker } from '@raadi/service-kit';
import { decodeJwt } from 'jose';
import * as oidc from 'openid-client';
import type { AppConfig } from '../config.js';
import { APP_CONFIG } from '../tokens.js';
import type { LoginTransaction } from './session.store.js';

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  /** Epoch seconds. */
  accessExpiresAt: number;
  /** Seconds until the refresh token (= Keycloak SSO session idle) expires. */
  refreshExpiresIn: number;
  roles: string[];
  claims: Record<string, unknown>;
}

/**
 * Keycloak OIDC client (Authorization Code + PKCE, confidential client).
 * Browser-facing endpoints use the public URL; token/revocation calls use the
 * internal back channel. Server metadata is static, so startup does not depend
 * on Keycloak being reachable.
 */
@Injectable()
export class OidcService {
  readonly redirectUri: string;
  private readonly config: oidc.Configuration;
  private readonly codeGrant;
  private readonly refreshGrant;

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {
    const pub = cfg.issuer;
    const internal = cfg.realmInternalUrl;
    this.redirectUri = `${cfg.env.PUBLIC_BASE_URL}/auth/callback`;
    this.config = new oidc.Configuration(
      {
        issuer: pub,
        authorization_endpoint: `${pub}/protocol/openid-connect/auth`,
        end_session_endpoint: `${pub}/protocol/openid-connect/logout`,
        token_endpoint: `${internal}/protocol/openid-connect/token`,
        revocation_endpoint: `${internal}/protocol/openid-connect/revoke`,
        jwks_uri: `${internal}/protocol/openid-connect/certs`,
        userinfo_endpoint: `${internal}/protocol/openid-connect/userinfo`,
      },
      cfg.env.OIDC_CLIENT_ID,
      { client_secret: cfg.secrets.oidcClientSecret },
      oidc.ClientSecretBasic(cfg.secrets.oidcClientSecret),
    );
    // The back channel is plain HTTP on the private network; TLS ends at Traefik.
    if (internal.startsWith('http:')) oidc.allowInsecureRequests(this.config);

    this.codeGrant = circuitBreaker(
      (url: URL, tx: LoginTransaction, state: string) =>
        oidc.authorizationCodeGrant(this.config, url, {
          pkceCodeVerifier: tx.codeVerifier,
          expectedState: state,
          expectedNonce: tx.nonce,
          idTokenExpected: true,
        }),
      { name: 'keycloak-code-grant', timeoutMs: 8000 },
    );
    this.refreshGrant = circuitBreaker(
      (refreshToken: string) => oidc.refreshTokenGrant(this.config, refreshToken),
      { name: 'keycloak-refresh-grant', timeoutMs: 8000 },
    );
  }

  newTransaction(returnTo: string): LoginTransaction & { state: string } {
    return {
      state: oidc.randomState(),
      nonce: oidc.randomNonce(),
      codeVerifier: oidc.randomPKCECodeVerifier(),
      returnTo,
    };
  }

  /** `signup` opens Keycloak's registration form directly (OIDC `prompt=create`). */
  async authorizationUrl(
    tx: LoginTransaction & { state: string },
    uiLocale: string,
    signup = false,
  ): Promise<URL> {
    // admin-bff sets OIDC_PROMPT=login: the console always asks for the password again, even with
    // a Keycloak session from the website (ADR-0028).
    const prompt = signup ? 'create' : this.cfg.env.OIDC_PROMPT;
    return oidc.buildAuthorizationUrl(this.config, {
      ...(prompt ? { prompt } : {}),
      redirect_uri: this.redirectUri,
      scope: 'openid profile email',
      response_type: 'code',
      state: tx.state,
      nonce: tx.nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(tx.codeVerifier),
      code_challenge_method: 'S256',
      ui_locales: uiLocale,
    });
  }

  /** `query` is the raw callback query string (including the leading "?"). */
  async exchangeCode(query: string, tx: LoginTransaction, state: string): Promise<TokenSet> {
    const url = new URL(`${this.redirectUri}${query}`);
    const res = await this.codeGrant.fire(url, tx, state);
    return this.toTokenSet(res, res.claims() as Record<string, unknown> | undefined);
  }

  async refresh(refreshToken: string): Promise<TokenSet> {
    const res = await this.refreshGrant.fire(refreshToken);
    return this.toTokenSet(res, res.claims() as Record<string, unknown> | undefined);
  }

  /** `returnTo` must already be a safe same-site path (see safeReturnTo). */
  endSessionUrl(idToken: string | undefined, returnTo = '/'): string {
    const target = `${this.cfg.env.PUBLIC_BASE_URL}${returnTo}`;
    if (!idToken) return target;
    return oidc.buildEndSessionUrl(this.config, {
      id_token_hint: idToken,
      post_logout_redirect_uri: target,
    }).href;
  }

  async revoke(refreshToken: string): Promise<void> {
    await oidc.tokenRevocation(this.config, refreshToken, { token_type_hint: 'refresh_token' });
  }

  private toTokenSet(
    res: oidc.TokenEndpointResponse,
    idClaims: Record<string, unknown> | undefined,
  ): TokenSet {
    const access = decodeJwt(res.access_token);
    const realmAccess = access.realm_access as { roles?: string[] } | undefined;
    const now = Math.floor(Date.now() / 1000);
    const refreshExpiresIn = Number((res as Record<string, unknown>).refresh_expires_in ?? 1800);
    return {
      accessToken: res.access_token,
      refreshToken: res.refresh_token,
      idToken: res.id_token,
      accessExpiresAt: now + (res.expires_in ?? 300),
      refreshExpiresIn: refreshExpiresIn > 0 ? refreshExpiresIn : 1800,
      roles: (realmAccess?.roles ?? []).filter((r) => !r.startsWith('default-roles-')),
      claims: { ...access, ...(idClaims ?? {}) },
    };
  }
}
