/** Staff roles (Keycloak realm roles) and which admin console sections each may open (ADR-0028). */
export const STAFF_ROLES = ['moderator', 'support', 'operator', 'platform-admin'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const isStaff = (roles: readonly string[]) =>
  roles.some((r) => STAFF_ROLES.includes(r as StaffRole));

/**
 * Sections and the roles that open them (ADR-0030). Services check the same roles again on every
 * call, with console tokens only. Operators see numbers about the platform, never user data.
 */
export const SECTIONS = {
  overview: STAFF_ROLES,
  users: ['support', 'platform-admin'],
  listings: ['moderator', 'support', 'platform-admin'],
  moderation: ['moderator', 'platform-admin'],
  orders: ['support', 'platform-admin'],
  reviews: ['moderator', 'support', 'platform-admin'],
  operations: ['operator', 'platform-admin'],
  tools: ['operator', 'platform-admin'],
  ranking: ['operator', 'platform-admin'],
  staff: ['platform-admin'],
  audit: ['platform-admin'],
} as const satisfies Record<string, readonly StaffRole[]>;

export type Section = keyof typeof SECTIONS;

export const canOpen = (section: Section, roles: readonly string[]) =>
  (SECTIONS[section] as readonly string[]).some((r) => roles.includes(r));

/** Actions beyond reading, by the roles services require for them. */
export const CAN = {
  suspend: ['support', 'platform-admin'],
  manageStaff: ['platform-admin'],
  moderate: ['moderator', 'platform-admin'],
  refund: ['platform-admin'],
} as const satisfies Record<string, readonly StaffRole[]>;

export const can = (action: keyof typeof CAN, roles: readonly string[]) =>
  (CAN[action] as readonly string[]).some((r) => roles.includes(r));

/** Navigation: sections in groups, with the key that opens each after "g" (g u → users). */
export const NAV_GROUPS: Array<{
  group: 'workspace' | 'marketplace' | 'platform';
  items: Array<{ section: Section; href: string; key: string }>;
}> = [
  {
    group: 'workspace',
    items: [
      { section: 'overview', href: '/admin', key: 'o' },
      { section: 'moderation', href: '/admin/moderation', key: 'm' },
    ],
  },
  {
    group: 'marketplace',
    items: [
      { section: 'users', href: '/admin/users', key: 'u' },
      { section: 'listings', href: '/admin/listings', key: 'l' },
      { section: 'orders', href: '/admin/orders', key: 'p' },
      { section: 'reviews', href: '/admin/reviews', key: 'r' },
    ],
  },
  {
    group: 'platform',
    items: [
      { section: 'operations', href: '/admin/operations', key: 's' },
      { section: 'tools', href: '/admin/tools', key: 'k' },
      { section: 'ranking', href: '/admin/ranking', key: 'b' },
      { section: 'staff', href: '/admin/staff', key: 't' },
      { section: 'audit', href: '/admin/audit', key: 'a' },
    ],
  },
];
