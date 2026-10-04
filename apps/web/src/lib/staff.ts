/** Staff roles (Keycloak realm roles) and which admin console sections each may open (ADR-0028). */
export const STAFF_ROLES = ['moderator', 'support', 'operator', 'platform-admin'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const isStaff = (roles: readonly string[]) =>
  roles.some((r) => STAFF_ROLES.includes(r as StaffRole));

export const SECTIONS = {
  overview: STAFF_ROLES,
  moderation: ['moderator', 'platform-admin'],
  audit: ['platform-admin'],
} as const satisfies Record<string, readonly StaffRole[]>;

export type Section = keyof typeof SECTIONS;

export const canOpen = (section: Section, roles: readonly string[]) =>
  (SECTIONS[section] as readonly string[]).some((r) => roles.includes(r));
