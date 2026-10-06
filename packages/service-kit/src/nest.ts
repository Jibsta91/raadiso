import {
  applyDecorators,
  type ArgumentsHost,
  type CallHandler,
  Catch,
  type CanActivate,
  type ExceptionFilter,
  type ExecutionContext,
  HttpException,
  type INestApplication,
  HttpStatus,
  Injectable,
  type NestInterceptor,
  type PipeTransform,
  SetMetadata,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
  Controller,
  Get,
  Logger,
  Res,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { trace } from '@opentelemetry/api';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Observable } from 'rxjs';
import type { z } from 'zod';
import { AuthzUnavailableError } from './authz.js';
import { HealthRegistry } from './health.js';
import { JwtVerifier, type Principal } from './jwt.js';

// ---------------------------------------------------------------------------
// Errors: RFC 9457 problem+json, never leaking internals.
// ---------------------------------------------------------------------------
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ProblemDetails');

  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const req = host.switchToHttp().getRequest<FastifyRequest>();
    const unavailable = exception instanceof AuthzUnavailableError;
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : unavailable
          ? HttpStatus.SERVICE_UNAVAILABLE
          : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = exception instanceof HttpException ? exception.getResponse() : undefined;
    const detail = unavailable
      ? 'A dependency is temporarily unavailable; please retry.'
      : status >= 500
        ? 'An unexpected error occurred.'
        : typeof body === 'string'
          ? body
          : ((body as { message?: unknown })?.message ?? undefined);

    if (status >= 500) this.logger.error({ err: exception, path: req.url }, 'request failed');

    const problem: Record<string, unknown> = {
      type: 'about:blank',
      title: HttpStatus[status]?.replaceAll('_', ' ').toLowerCase() ?? 'error',
      status,
      instance: req.url,
      traceId: trace.getActiveSpan()?.spanContext().traceId,
    };
    if (Array.isArray(detail)) problem.errors = detail;
    else if (detail !== undefined) problem.detail = detail;
    const errors = (body as { errors?: unknown } | undefined)?.errors;
    if (errors) problem.errors = errors;
    if (exception instanceof StepUpRequiredException) {
      // RFC 9470: the client signs in again and retries with a fresher token.
      problem.type = 'urn:raadi:problem:step-up-required';
      problem.maxAge = exception.maxAge;
      void reply.header(
        'www-authenticate',
        `Bearer error="insufficient_user_authentication", error_description="A recent sign-in is required", max_age=${exception.maxAge}`,
      );
    }

    void reply.status(status).header('content-type', 'application/problem+json').send(problem);
  }
}

// ---------------------------------------------------------------------------
// Validation: zod schemas at the edge of every handler.
// ---------------------------------------------------------------------------
export class ZodValidationPipe<S extends z.ZodType> implements PipeTransform {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return result.data;
  }
}

// ---------------------------------------------------------------------------
// AuthN/Z: every non-public route requires a valid JWT; @Roles adds RBAC.
// ---------------------------------------------------------------------------
export const IS_PUBLIC = 'raadi:isPublic';
export const ROLES = 'raadi:roles';
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** The staff roles (ADR-0028). They open staff endpoints only: @Staff, with a console token. */
export const STAFF_ROLE_NAMES = ['moderator', 'support', 'operator', 'platform-admin'] as const;
/**
 * Roles for website and app routes. A staff role here would let a website session act as staff
 * without the console token, step-up and reason that @Staff requires (ADR-0030), so it fails at
 * startup instead.
 */
export const Roles = (...roles: string[]) => {
  const staff = roles.filter((r) => (STAFF_ROLE_NAMES as readonly string[]).includes(r));
  if (staff.length) {
    throw new Error(`@Roles(${staff.join(', ')}): staff roles belong in @Staff (ADR-0030)`);
  }
  return SetMetadata(ROLES, roles);
};

export const STAFF = 'raadi:staff';

/** Client id of the admin console (ADR-0028); only its tokens open staff endpoints. */
export const CONSOLE_CLIENT_ID = process.env.ADMIN_CLIENT_ID ?? 'raadi-admin';
/** How recent a sign-in must be for a step-up action, in seconds (ADR-0030). */
export const STEP_UP_MAX_AGE = Number(process.env.STEP_UP_MAX_AGE_SECONDS ?? 900);

/**
 * A staff endpoint (ADR-0030): one of the roles, AND a token the admin console obtained (azp
 * `raadi-admin`), so a website session never drives staff APIs even for staff. With `stepUp`, the
 * person must also have signed in within STEP_UP_MAX_AGE (RFC 9470 challenge otherwise).
 */
export const Staff = (roles: readonly string[], opts: { stepUp?: boolean } = {}) =>
  applyDecorators(
    SetMetadata(ROLES, [...roles]),
    SetMetadata(STAFF, { stepUp: opts.stepUp ?? false }),
  );

/** 401 with a step-up challenge: sign in again (RFC 9470). */
export class StepUpRequiredException extends UnauthorizedException {
  constructor(readonly maxAge: number) {
    super({ message: 'This action needs a recent sign-in', code: 'step_up_required' });
  }
}

export type AuthenticatedRequest = FastifyRequest & { principal?: Principal };

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: JwtVerifier,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = req.headers.authorization;
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) {
      // Public routes still recognise a valid token (e.g. an owner viewing their
      // own listing); an invalid one is ignored rather than rejected.
      if (header?.startsWith('Bearer ')) {
        req.principal = await this.verifier.verify(header.slice(7)).catch(() => undefined);
      }
      return true;
    }

    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Missing bearer token');
    try {
      req.principal = await this.verifier.verify(header.slice(7));
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    trace.getActiveSpan()?.setAttribute('enduser.id', req.principal.sub);

    const required = this.reflector.getAllAndOverride<string[]>(ROLES, targets);
    if (required?.length && !required.some((r) => req.principal!.roles.includes(r))) {
      throw new ForbiddenException('Insufficient role');
    }
    const staff = this.reflector.getAllAndOverride<{ stepUp: boolean }>(STAFF, targets);
    if (staff) {
      if (req.principal.claims.azp !== CONSOLE_CLIENT_ID) {
        throw new ForbiddenException('Staff endpoints accept admin console tokens only');
      }
      const authTime = Number(req.principal.claims.auth_time);
      if (staff.stepUp && !(authTime > Date.now() / 1000 - STEP_UP_MAX_AGE)) {
        throw new StepUpRequiredException(STEP_UP_MAX_AGE);
      }
    }
    return true;
  }
}

// ---------------------------------------------------------------------------
// Health: liveness and readiness (dependency checks, draining on shutdown).
// ---------------------------------------------------------------------------
@Public()
@Controller()
export class HealthController {
  constructor(private readonly health: HealthRegistry) {}

  @Get('healthz')
  liveness() {
    return { status: 'ok' };
  }

  @Get('readyz')
  async readiness(@Res() reply: FastifyReply): Promise<void> {
    const report = await this.health.readiness();
    void reply.status(report.status === 'ok' ? 200 : 503).send(report);
  }
}

// ---------------------------------------------------------------------------
// Tracing: name server spans after the matched route ("GET /me").
// ---------------------------------------------------------------------------
@Injectable()
export class RouteSpanInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const route = req.routeOptions?.url;
    const span = trace.getActiveSpan();
    if (span && route) {
      span.setAttribute('http.route', route);
      span.updateName(`${req.method} ${route}`);
    }
    return next.handle();
  }
}

/**
 * Responses default to `Cache-Control: no-store`: most carry personal data, and no shared cache (a CDN
 * later) may keep them. Routes whose answers may be cached say so themselves (public search results,
 * listing pages for visitors). Call before `listen()`.
 */
export function noStoreByDefault(app: INestApplication): void {
  const fastify = app.getHttpAdapter().getInstance() as FastifyInstance;
  fastify.addHook('onSend', async (_req: FastifyRequest, reply: FastifyReply, payload: unknown) => {
    if (!reply.hasHeader('cache-control')) void reply.header('cache-control', 'no-store');
    return payload;
  });
}
