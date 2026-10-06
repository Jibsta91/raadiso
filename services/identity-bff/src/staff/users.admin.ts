import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationShutdown,
  type OnModuleInit,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import {
  audit,
  type AuthenticatedRequest,
  type Principal,
  Staff,
  withTransaction,
  ZodValidationPipe,
} from '@raadi/service-kit';
import type pg from 'pg';
import { z } from 'zod';
import { PG_POOL } from '../tokens.js';
import { KeycloakAdmin, KeycloakNotFound, type KcUser } from './keycloak-admin.js';

export const KEYCLOAK_ADMIN = Symbol('KEYCLOAK_ADMIN');

export const STAFF_ROLES = ['moderator', 'support', 'operator', 'platform-admin'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
const SOURCE = 'urn:raadi:admin-bff';
/** Who lifts expired suspensions: the system, not a person. */
const SYSTEM: Principal = {
  sub: '00000000-0000-0000-0000-000000000000',
  roles: [],
  scopes: [],
  claims: {},
};

export const SUSPENSION_REASONS = [
  'fraud',
  'spam',
  'abuse',
  'chargeback',
  'impersonation',
  'security',
  'other',
] as const;

const actions = metrics
  .getMeter('admin-bff')
  .createCounter('raadi.staff.user_actions', { description: 'User administration by staff' });

// -- schemas --------------------------------------------------------------------------------
export const searchSchema = z
  .object({
    q: z.string().trim().max(100).default(''),
    role: z.enum(STAFF_ROLES).optional(),
    status: z.enum(['active', 'suspended']).optional(),
    first: z.coerce.number().int().min(0).max(10_000).default(0),
    max: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

const note = z.string().trim().max(500).default('');

export const suspendSchema = z
  .object({
    reasonCode: z.enum(SUSPENSION_REASONS),
    note,
    /** Lift automatically after this many hours; omit for "until lifted". */
    hours: z
      .number()
      .int()
      .min(1)
      .max(24 * 365)
      .optional(),
  })
  .strict();

export const noteOnlySchema = z.object({ note }).strict();

export const emailSchema = z
  .object({ action: z.enum(['password_reset', 'verify_email']) })
  .strict();

export const rolesSchema = z
  .object({ roles: z.array(z.enum(STAFF_ROLES)).max(4), note: z.string().trim().min(3).max(500) })
  .strict();

export const userNoteSchema = z
  .object({ body: z.string().trim().min(1).max(2000), pinned: z.boolean().default(false) })
  .strict();

const lookupSchema = z
  .object({
    ids: z
      .string()
      .transform((s) => s.split(',').filter(Boolean))
      .pipe(z.array(z.uuid()).min(1).max(50)),
  })
  .strict();

// -- views ----------------------------------------------------------------------------------
export interface UserSummary {
  id: string;
  email: string | null;
  name: string | null;
  enabled: boolean;
  emailVerified: boolean;
  createdAt: string | null;
  lastLoginAt: string | null;
  staffRoles: StaffRole[];
  suspended: boolean;
}

export interface Suspension {
  reasonCode: (typeof SUSPENSION_REASONS)[number];
  note: string;
  by: string;
  at: string;
  until: string | null;
}

export interface UserDetail extends UserSummary {
  displayName: string | null;
  locale: string | null;
  requiredActions: string[];
  sessions: Array<{
    id: string;
    ip: string | null;
    startedAt: string;
    lastAccessAt: string;
    clients: string[];
  }>;
  credentials: Array<{ id: string; type: string; label: string | null; createdAt: string | null }>;
  lockout: { locked: boolean; failures: number; lastFailureAt: string | null };
  suspension: Suspension | null;
  events: Array<{
    type: string;
    at: string;
    ip: string | null;
    client: string | null;
    error: string | null;
  }>;
}

export interface UserNote {
  id: string;
  authorId: string;
  body: string;
  pinned: boolean;
  createdAt: string;
}

export interface UserStats {
  total: number;
  suspended: number;
  staff: number;
  /** New accounts per day (first sign-in), oldest first. */
  signups: Array<{ day: string; count: number }>;
  /** Accounts that signed in per day, oldest first. */
  active: Array<{ day: string; count: number }>;
}

const iso = (ms?: number | null) => (ms ? new Date(ms).toISOString() : null);
const fullName = (u: KcUser) => [u.firstName, u.lastName].filter(Boolean).join(' ') || null;

/**
 * User administration for the admin console (ADR-0030): Keycloak is the system of record for
 * accounts, this service adds why and until when an account is suspended, and support's notes.
 * Every change writes an audit entry in the same transaction (ADR-0028).
 */
@Injectable()
export class UserAdminService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(UserAdminService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(KEYCLOAK_ADMIN) private readonly kc: KeycloakAdmin,
  ) {}

  onModuleInit(): void {
    // Lift suspensions whose time is up (once a minute; idempotent across replicas).
    this.timer = setInterval(() => void this.liftExpired().catch(() => undefined), 60_000);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  // -- reads --------------------------------------------------------------------------------
  async search(q: z.infer<typeof searchSchema>): Promise<{ items: UserSummary[]; total: number }> {
    let users: KcUser[];
    let total: number;
    if (q.role) {
      const all = (await this.kc.roleUsers(q.role)).filter((u) => matches(u, q.q));
      total = all.length;
      users = all.slice(q.first, q.first + q.max);
    } else if (q.status === 'suspended' && !q.q) {
      // Paged in SQL: one Keycloak call per account shown, not per suspension.
      const [page, count] = await Promise.all([
        this.pool.query<{ user_id: string }>(
          'SELECT user_id FROM user_suspensions ORDER BY suspended_at DESC LIMIT $1 OFFSET $2',
          [q.max, q.first],
        ),
        this.pool.query<{ n: string }>('SELECT count(*) AS n FROM user_suspensions'),
      ]);
      const found = await Promise.all(
        page.rows.map((r) => this.kc.getUser(r.user_id).catch(() => null)),
      );
      users = found.filter((u): u is KcUser => !!u);
      total = Number(count.rows[0]!.n);
    } else if (q.status === 'suspended') {
      // Suspended accounts are disabled in Keycloak, which searches them by name or e-mail.
      [users, total] = await Promise.all([
        this.kc.searchUsers(q.q, q.first, q.max, false),
        this.kc.countUsers(q.q, false),
      ]);
    } else {
      // "Active" is filtered by Keycloak before paging, so pages are full and the total is right.
      const enabled = q.status === 'active' ? true : undefined;
      [users, total] = await Promise.all([
        this.kc.searchUsers(q.q, q.first, q.max, enabled),
        this.kc.countUsers(q.q, enabled),
      ]);
      // Service accounts are not people.
      users = users.filter((u) => !u.username.startsWith('service-account-'));
    }
    const items = await this.summaries(users);
    return { items, total };
  }

  async detail(id: string): Promise<UserDetail> {
    const user = await this.found(this.kc.getUser(id));
    const [[summary], sessions, credentials, lockout, events, profile, suspension] =
      await Promise.all([
        this.summaries([user]),
        this.kc.sessions(id).catch(() => []),
        this.kc.credentials(id).catch(() => []),
        this.kc.bruteForce(id).catch(() => null),
        this.kc.events(id).catch(() => []),
        this.pool
          .query<{ display_name: string | null; locale: string }>(
            'SELECT display_name, locale FROM user_profiles WHERE id = $1',
            [id],
          )
          .then((r) => r.rows[0]),
        this.suspension(id),
      ]);
    return {
      ...summary!,
      displayName: profile?.display_name ?? null,
      locale: profile?.locale ?? null,
      requiredActions: user.requiredActions ?? [],
      sessions: sessions.map((s) => ({
        id: s.id,
        ip: s.ipAddress ?? null,
        startedAt: iso(s.start)!,
        lastAccessAt: iso(s.lastAccess)!,
        clients: Object.values(s.clients ?? {}),
      })),
      credentials: credentials.map((c) => ({
        id: c.id,
        type: c.type,
        label: c.userLabel ?? null,
        createdAt: iso(c.createdDate),
      })),
      lockout: {
        locked: lockout?.disabled ?? false,
        failures: lockout?.numFailures ?? 0,
        lastFailureAt: iso(lockout?.lastFailure),
      },
      suspension,
      events: events.map((e) => ({
        type: e.type,
        at: iso(e.time)!,
        ip: e.ipAddress ?? null,
        client: e.clientId ?? null,
        error: e.error ?? null,
      })),
    };
  }

  async stats(): Promise<UserStats> {
    const [total, staff, suspended, signups, active] = await Promise.all([
      this.kc.countUsers(''),
      this.staffIds(),
      this.pool.query<{ n: string }>('SELECT count(*) AS n FROM user_suspensions'),
      this.daily('created_at'),
      this.daily('last_login_at'),
    ]);
    return {
      total,
      staff: staff.size,
      suspended: Number(suspended.rows[0]!.n),
      signups,
      active,
    };
  }

  async staff(): Promise<UserSummary[]> {
    const ids = await this.staffIds();
    const users = await Promise.all([...ids.keys()].map((id) => this.kc.getUser(id)));
    return this.summaries(users);
  }

  /** E-mail and name of staff members, to show who did what. Other ids are left out. */
  async lookup(
    ids: string[],
  ): Promise<Array<{ id: string; email: string | null; name: string | null }>> {
    const staff = await this.staffIds();
    const wanted = ids.filter((id) => staff.has(id));
    const users = await Promise.all(wanted.map((id) => this.kc.getUser(id).catch(() => null)));
    return users
      .filter((u): u is KcUser => !!u)
      .map((u) => ({ id: u.id, email: u.email ?? null, name: fullName(u) }));
  }

  async notes(userId: string): Promise<UserNote[]> {
    const { rows } = await this.pool.query<{
      id: string;
      author_id: string;
      body: string;
      pinned: boolean;
      created_at: Date;
    }>(
      `SELECT id, author_id, body, pinned, created_at FROM user_notes
        WHERE user_id = $1 ORDER BY pinned DESC, created_at DESC LIMIT 100`,
      [userId],
    );
    return rows.map((r) => ({
      id: r.id,
      authorId: r.author_id,
      body: r.body,
      pinned: r.pinned,
      createdAt: r.created_at.toISOString(),
    }));
  }

  // -- changes ------------------------------------------------------------------------------
  async suspend(actor: Principal, id: string, input: z.infer<typeof suspendSchema>) {
    const user = await this.guardTarget(actor, id);
    if (!user.enabled && (await this.suspension(id))) {
      throw new BadRequestException('The account is already suspended');
    }
    await withTransaction(this.pool, async (db) => {
      await db.query(
        `INSERT INTO user_suspensions (user_id, reason_code, note, suspended_by, until)
         VALUES ($1, $2, $3, $4, CASE WHEN $5::int IS NULL THEN NULL
                                      ELSE now() + make_interval(hours => $5::int) END)
         ON CONFLICT (user_id) DO UPDATE
           SET reason_code = EXCLUDED.reason_code, note = EXCLUDED.note,
               suspended_by = EXCLUDED.suspended_by, suspended_at = now(), until = EXCLUDED.until`,
        [id, input.reasonCode, input.note, actor.sub, input.hours ?? null],
      );
      await audit(db, SOURCE, actor, {
        action: 'user.suspend',
        targetType: 'user',
        targetId: id,
        ...(input.note ? { reason: input.note } : {}),
        details: { reasonCode: input.reasonCode, ...(input.hours ? { hours: input.hours } : {}) },
      });
      // Keycloak last: if it fails, nothing above is committed.
      await this.kc.setEnabled(id, false);
      await this.kc.signOut(id);
    });
    actions.add(1, { action: 'suspend' });
  }

  async unsuspend(actor: Principal, id: string, input: z.infer<typeof noteOnlySchema>) {
    await this.guardTarget(actor, id);
    await this.lift(actor, id, input.note);
    actions.add(1, { action: 'unsuspend' });
  }

  async signOut(actor: Principal, id: string, input: z.infer<typeof noteOnlySchema>) {
    await this.guardTarget(actor, id);
    const sessions = await this.kc.sessions(id);
    await withTransaction(this.pool, async (db) => {
      await audit(db, SOURCE, actor, {
        action: 'user.sign_out',
        targetType: 'user',
        targetId: id,
        ...(input.note ? { reason: input.note } : {}),
        details: { sessions: sessions.length },
      });
      await this.kc.signOut(id);
    });
    actions.add(1, { action: 'sign_out' });
    return { sessions: sessions.length };
  }

  async sendEmail(actor: Principal, id: string, input: z.infer<typeof emailSchema>) {
    const user = await this.guardTarget(actor, id);
    if (!user.email) throw new BadRequestException('The account has no e-mail address');
    if (!user.enabled) throw new BadRequestException('The account is suspended');
    await withTransaction(this.pool, async (db) => {
      await audit(db, SOURCE, actor, {
        action: input.action === 'password_reset' ? 'user.password_reset' : 'user.verify_email',
        targetType: 'user',
        targetId: id,
      });
      await this.kc.executeActionsEmail(
        id,
        input.action === 'password_reset' ? ['UPDATE_PASSWORD'] : ['VERIFY_EMAIL'],
      );
    });
    actions.add(1, { action: input.action });
  }

  async unlock(actor: Principal, id: string) {
    await this.guardTarget(actor, id);
    await withTransaction(this.pool, async (db) => {
      await audit(db, SOURCE, actor, { action: 'user.unlock', targetType: 'user', targetId: id });
      await this.kc.clearBruteForce(id);
    });
    actions.add(1, { action: 'unlock' });
  }

  async addNote(actor: Principal, userId: string, input: z.infer<typeof userNoteSchema>) {
    await this.found(this.kc.getUser(userId));
    const noteId = randomUUID();
    await withTransaction(this.pool, async (db) => {
      await db.query(
        'INSERT INTO user_notes (id, user_id, author_id, body, pinned) VALUES ($1, $2, $3, $4, $5)',
        [noteId, userId, actor.sub, input.body, input.pinned],
      );
      // The note's text stays here; the audit log records that one was written.
      await audit(db, SOURCE, actor, {
        action: 'user.note',
        targetType: 'user',
        targetId: userId,
        details: { noteId, pinned: input.pinned },
      });
    });
    return { id: noteId };
  }

  async setStaffRoles(actor: Principal, id: string, input: z.infer<typeof rolesSchema>) {
    await this.found(this.kc.getUser(id));
    const current = (await this.kc.realmRoles(id)).map((r) => r.name);
    const want = new Set<string>(input.roles);
    const added = STAFF_ROLES.filter((r) => want.has(r) && !current.includes(r));
    const removed = STAFF_ROLES.filter((r) => !want.has(r) && current.includes(r));
    if (actor.sub === id && removed.includes('platform-admin')) {
      throw new ForbiddenException('You cannot remove your own platform-admin role');
    }
    if (!added.length && !removed.length) return { added, removed };
    const [add, remove] = await Promise.all([
      Promise.all(added.map((r) => this.kc.role(r))),
      Promise.all(removed.map((r) => this.kc.role(r))),
    ]);
    await withTransaction(this.pool, async (db) => {
      await audit(db, SOURCE, actor, {
        action: 'user.roles_change',
        targetType: 'user',
        targetId: id,
        reason: input.note,
        details: { added, removed },
      });
      if (add.length) await this.kc.addRealmRoles(id, add);
      if (remove.length) await this.kc.removeRealmRoles(id, remove);
      // New roles take effect with the next token; old sessions must not keep the old ones.
      await this.kc.signOut(id);
    });
    actions.add(1, { action: 'roles_change' });
    return { added, removed };
  }

  async resetOtp(actor: Principal, id: string, input: z.infer<typeof noteOnlySchema>) {
    await this.found(this.kc.getUser(id));
    const otp = (await this.kc.credentials(id)).filter((c) => c.type === 'otp');
    if (!otp.length) throw new BadRequestException('The account has no authenticator');
    await withTransaction(this.pool, async (db) => {
      await audit(db, SOURCE, actor, {
        action: 'user.otp_reset',
        targetType: 'user',
        targetId: id,
        ...(input.note ? { reason: input.note } : {}),
        details: { removed: otp.length },
      });
      for (const c of otp) await this.kc.deleteCredential(id, c.id);
      await this.kc.signOut(id);
    });
    actions.add(1, { action: 'otp_reset' });
  }

  // -- helpers ------------------------------------------------------------------------------
  /**
   * The target must exist, must not be the actor, and only platform admins act on staff
   * accounts (a support agent cannot lock out a moderator, or an admin).
   */
  private async guardTarget(actor: Principal, id: string): Promise<KcUser> {
    if (actor.sub === id) throw new ForbiddenException('You cannot do this to your own account');
    const user = await this.found(this.kc.getUser(id));
    if (!actor.roles.includes('platform-admin') && (await this.staffIds()).has(id)) {
      throw new ForbiddenException('Only platform admins act on staff accounts');
    }
    return user;
  }

  private async lift(actor: Principal, id: string, why: string) {
    await withTransaction(this.pool, async (db) => {
      const { rowCount } = await db.query('DELETE FROM user_suspensions WHERE user_id = $1', [id]);
      if (!rowCount && actor !== SYSTEM) {
        const user = await this.kc.getUser(id);
        if (user.enabled) throw new BadRequestException('The account is not suspended');
      }
      await audit(db, SOURCE, actor, {
        action: actor === SYSTEM ? 'user.suspension_expired' : 'user.unsuspend',
        targetType: 'user',
        targetId: id,
        ...(why ? { reason: why } : {}),
      });
      await this.kc.setEnabled(id, true);
    });
  }

  private async liftExpired(): Promise<void> {
    const { rows } = await this.pool.query<{ user_id: string }>(
      'SELECT user_id FROM user_suspensions WHERE until <= now() LIMIT 50',
    );
    for (const { user_id } of rows) {
      await this.lift(SYSTEM, user_id, '').then(
        () => this.logger.log({ userId: user_id }, 'suspension expired and was lifted'),
        (error: unknown) => this.logger.warn({ err: error, userId: user_id }, 'lifting failed'),
      );
    }
  }

  private async suspension(id: string): Promise<Suspension | null> {
    const { rows } = await this.pool.query<{
      reason_code: Suspension['reasonCode'];
      note: string;
      suspended_by: string;
      suspended_at: Date;
      until: Date | null;
    }>('SELECT * FROM user_suspensions WHERE user_id = $1', [id]);
    const r = rows[0];
    return r
      ? {
          reasonCode: r.reason_code,
          note: r.note,
          by: r.suspended_by,
          at: r.suspended_at.toISOString(),
          until: r.until?.toISOString() ?? null,
        }
      : null;
  }

  /** Staff members and their staff roles (4 role lookups). */
  private async staffIds(): Promise<Map<string, StaffRole[]>> {
    const lists = await Promise.all(STAFF_ROLES.map((r) => this.kc.roleUsers(r)));
    const map = new Map<string, StaffRole[]>();
    lists.forEach((users, i) => {
      for (const u of users) map.set(u.id, [...(map.get(u.id) ?? []), STAFF_ROLES[i]!]);
    });
    return map;
  }

  private async summaries(users: KcUser[]): Promise<UserSummary[]> {
    if (!users.length) return [];
    const ids = users.map((u) => u.id);
    const [staff, profiles, suspended] = await Promise.all([
      this.staffIds(),
      this.pool.query<{ id: string; last_login_at: Date | null }>(
        'SELECT id, last_login_at FROM user_profiles WHERE id = ANY($1::uuid[])',
        [ids],
      ),
      this.pool.query<{ user_id: string }>(
        'SELECT user_id FROM user_suspensions WHERE user_id = ANY($1::uuid[])',
        [ids],
      ),
    ]);
    const lastLogin = new Map(profiles.rows.map((r) => [r.id, r.last_login_at]));
    const susp = new Set(suspended.rows.map((r) => r.user_id));
    return users.map((u) => ({
      id: u.id,
      email: u.email ?? null,
      name: fullName(u),
      enabled: u.enabled,
      emailVerified: u.emailVerified ?? false,
      createdAt: iso(u.createdTimestamp),
      lastLoginAt: lastLogin.get(u.id)?.toISOString() ?? null,
      staffRoles: staff.get(u.id) ?? [],
      suspended: susp.has(u.id) || !u.enabled,
    }));
  }

  private async daily(column: 'created_at' | 'last_login_at') {
    const { rows } = await this.pool.query<{ day: string; count: string }>(
      `SELECT to_char(d, 'YYYY-MM-DD') AS day, count(p.id) AS count
         FROM generate_series(date_trunc('day', now()) - interval '13 days',
                              date_trunc('day', now()), interval '1 day') d
         LEFT JOIN user_profiles p ON p.${column} >= d AND p.${column} < d + interval '1 day'
        GROUP BY d ORDER BY d`,
    );
    return rows.map((r) => ({ day: r.day, count: Number(r.count) }));
  }

  private async found<T>(p: Promise<T>): Promise<T> {
    try {
      return await p;
    } catch (error) {
      if (error instanceof KeycloakNotFound) throw new NotFoundException('User not found');
      throw error;
    }
  }
}

function matches(u: KcUser, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return [u.email, u.username, u.firstName, u.lastName, u.id].some((v) =>
    v?.toLowerCase().includes(needle),
  );
}

const uuid = new ParseUUIDPipe({ version: undefined });
const SUPPORT = ['support', 'platform-admin'] as const;

/** /admin/v1/users: the console's user administration (not routed by the gateway). */
@Controller('admin/v1/users')
export class UserAdminController {
  constructor(private readonly users: UserAdminService) {}

  @Get()
  @Staff(SUPPORT)
  search(@Query(new ZodValidationPipe(searchSchema)) q: z.infer<typeof searchSchema>) {
    return this.users.search(q);
  }

  @Get('stats')
  @Staff(SUPPORT)
  stats() {
    return this.users.stats();
  }

  @Get('staff')
  @Staff(['platform-admin'])
  async staff() {
    return { items: await this.users.staff() };
  }

  @Get('lookup')
  @Staff(STAFF_ROLES)
  async lookup(@Query(new ZodValidationPipe(lookupSchema)) q: { ids: string[] }) {
    return { items: await this.users.lookup(q.ids) };
  }

  @Get(':id')
  @Staff(SUPPORT)
  detail(@Param('id', uuid) id: string) {
    return this.users.detail(id);
  }

  @Get(':id/notes')
  @Staff(SUPPORT)
  async notes(@Param('id', uuid) id: string) {
    return { items: await this.users.notes(id) };
  }

  @Post(':id/notes')
  @Staff(SUPPORT)
  @HttpCode(201)
  addNote(
    @Req() req: AuthenticatedRequest,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(userNoteSchema)) body: z.infer<typeof userNoteSchema>,
  ) {
    return this.users.addNote(req.principal!, id, body);
  }

  @Post(':id/suspend')
  @Staff(SUPPORT, { stepUp: true })
  @HttpCode(204)
  async suspend(
    @Req() req: AuthenticatedRequest,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(suspendSchema)) body: z.infer<typeof suspendSchema>,
  ) {
    await this.users.suspend(req.principal!, id, body);
  }

  @Post(':id/unsuspend')
  @Staff(SUPPORT, { stepUp: true })
  @HttpCode(204)
  async unsuspend(
    @Req() req: AuthenticatedRequest,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(noteOnlySchema)) body: z.infer<typeof noteOnlySchema>,
  ) {
    await this.users.unsuspend(req.principal!, id, body);
  }

  @Post(':id/sign-out')
  @Staff(SUPPORT)
  signOut(
    @Req() req: AuthenticatedRequest,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(noteOnlySchema)) body: z.infer<typeof noteOnlySchema>,
  ) {
    return this.users.signOut(req.principal!, id, body);
  }

  @Post(':id/emails')
  @Staff(SUPPORT)
  @HttpCode(202)
  async email(
    @Req() req: AuthenticatedRequest,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(emailSchema)) body: z.infer<typeof emailSchema>,
  ) {
    await this.users.sendEmail(req.principal!, id, body);
    return { sent: true };
  }

  @Post(':id/unlock')
  @Staff(SUPPORT)
  @HttpCode(204)
  async unlock(@Req() req: AuthenticatedRequest, @Param('id', uuid) id: string) {
    await this.users.unlock(req.principal!, id);
  }

  @Put(':id/roles')
  @Staff(['platform-admin'], { stepUp: true })
  roles(
    @Req() req: AuthenticatedRequest,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(rolesSchema)) body: z.infer<typeof rolesSchema>,
  ) {
    return this.users.setStaffRoles(req.principal!, id, body);
  }

  @Post(':id/otp-reset')
  @Staff(['platform-admin'], { stepUp: true })
  @HttpCode(204)
  async resetOtp(
    @Req() req: AuthenticatedRequest,
    @Param('id', uuid) id: string,
    @Body(new ZodValidationPipe(noteOnlySchema)) body: z.infer<typeof noteOnlySchema>,
  ) {
    await this.users.resetOtp(req.principal!, id, body);
  }
}
