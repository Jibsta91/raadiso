import { env } from '@/lib/env';

/**
 * The stack's web UIs for the console's Tools page: where each one lives, how staff sign in, and a
 * health probe on the internal network. Dev tools are routed only when DEV_TOOLS_ROUTED isn't "false"
 * (not in phone mode, never in production), Keycloak's admin console only with KEYCLOAK_ADMIN_PUBLIC.
 */
export type ToolId =
  | 'grafana'
  | 'errors'
  | 'prometheus'
  | 'traefik'
  | 'keycloak'
  | 'openbao'
  | 'mailpit'
  | 'push'
  | 'status'
  | 'pangolin';

/**
 * How staff sign in: Keycloak single sign-on, a generated secret, nothing (development tools), or not at
 * all because the page is public.
 */
export type SignIn =
  | { kind: 'sso' }
  | { kind: 'secret'; user?: string; secret: string }
  | { kind: 'none' }
  | { kind: 'public' };

export interface Tool {
  id: ToolId;
  group: 'observe' | 'identity' | 'dev';
  url: string;
  signIn: SignIn;
  /** Internal health endpoint; none for pages outside the stack's network. */
  health?: string;
  /** False when the gateway doesn't route this UI in the current mode. */
  routed: boolean;
}

export interface ToolStatus extends Tool {
  status: 'up' | 'down' | 'unknown' | 'off';
}

export function tools(locale: string): Tool[] {
  const base = new URL(env.publicBaseUrl);
  const at = (sub: string, path = '') => `${base.protocol}//${sub}.${base.host}${path}`;
  const dev = process.env.DEV_TOOLS_ROUTED !== 'false';
  const keycloakAdmin = process.env.KEYCLOAK_ADMIN_PUBLIC !== 'false';
  const pangolin = process.env.TUNNEL_DASHBOARD_URL ?? '';
  const list: Tool[] = [
    {
      id: 'grafana',
      group: 'observe',
      url: at('grafana'),
      signIn: { kind: 'sso' },
      health: 'http://grafana:3000/api/health',
      routed: process.env.GRAFANA_ROUTED !== 'false',
    },
    {
      id: 'errors',
      group: 'observe',
      url: at('errors'),
      signIn: {
        kind: 'secret',
        user: process.env.GLITCHTIP_ADMIN_EMAIL ?? 'admin@raadi.localhost',
        secret: 'glitchtip_admin_password',
      },
      health: 'http://glitchtip:8000/_health/',
      routed: dev,
    },
    {
      id: 'prometheus',
      group: 'observe',
      url: at('prometheus'),
      signIn: { kind: 'none' },
      health: 'http://prometheus:9090/-/ready',
      routed: dev,
    },
    {
      id: 'status',
      group: 'observe',
      url: `${env.publicBaseUrl}/${locale}/status`,
      signIn: { kind: 'public' },
      health: 'http://127.0.0.1:3000/api/health',
      routed: true,
    },
    {
      id: 'keycloak',
      group: 'identity',
      url: at('auth', '/admin/'),
      signIn: { kind: 'secret', user: 'admin', secret: 'keycloak_admin_password' },
      health: 'http://keycloak:9000/health/ready',
      routed: keycloakAdmin,
    },
    {
      id: 'openbao',
      group: 'identity',
      url: at('bao', '/ui/'),
      signIn: { kind: 'secret', secret: 'openbao_root_token' },
      health: 'http://openbao:8200/v1/sys/health',
      routed: dev,
    },
    {
      id: 'traefik',
      group: 'dev',
      url: at('traefik', '/dashboard/'),
      signIn: { kind: 'none' },
      health: 'http://traefik:8081/ping',
      routed: dev,
    },
    {
      id: 'mailpit',
      group: 'dev',
      url: at('mail'),
      signIn: { kind: 'none' },
      health: 'http://mailpit:8025/readyz',
      routed: dev,
    },
    {
      id: 'push',
      group: 'dev',
      url: at('push', '/messages'),
      signIn: { kind: 'none' },
      health: 'http://push-mock:4000/readyz',
      routed: true,
    },
  ];
  // Tunnel mode only (ADR-0034): Pangolin's dashboard, on its own public name.
  if (pangolin) {
    list.push({
      id: 'pangolin',
      group: 'dev',
      url: pangolin,
      signIn: { kind: 'secret', secret: 'pangolin_admin_password' },
      routed: true,
    });
  }
  return list;
}

/** Each tool with a live status (internal health probe, 3 s timeout). */
export async function toolStatus(locale: string): Promise<ToolStatus[]> {
  return Promise.all(
    tools(locale).map(async (tool): Promise<ToolStatus> => {
      if (!tool.routed) return { ...tool, status: 'off' };
      if (!tool.health) return { ...tool, status: 'unknown' };
      try {
        const res = await fetch(tool.health, {
          cache: 'no-store',
          signal: AbortSignal.timeout(3000),
        });
        return { ...tool, status: res.ok ? 'up' : 'down' };
      } catch {
        return { ...tool, status: 'down' };
      }
    }),
  );
}
