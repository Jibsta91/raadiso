import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { type AuthenticatedRequest, Public, Roles, ZodValidationPipe } from '@raadi/service-kit';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import {
  type CreateOrder,
  createOrderSchema,
  idempotencyKeySchema,
  listQuerySchema,
} from './model.js';
import { PaymentsService } from './payments.service.js';

const uuidPipe = new ParseUUIDPipe({ version: undefined });

@Controller('api/v1/payments')
@Roles('user')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Public()
  @Get('products')
  products() {
    return this.payments.products();
  }

  /** 201 for a new order, 200 when the Idempotency-Key was seen before. */
  @Post('orders')
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  async create(
    @Req() req: AuthenticatedRequest,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(createOrderSchema)) body: CreateOrder,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const idempotencyKey = new ZodValidationPipe(idempotencyKeySchema).transform(key ?? '');
    const token = req.headers.authorization!.slice('Bearer '.length);
    const { created, order } = await this.payments.createOrder(
      req.principal!,
      token,
      idempotencyKey,
      body,
    );
    void reply.status(created ? 201 : 200).send(order);
  }

  @Get('orders')
  list(
    @Req() req: AuthenticatedRequest,
    @Query(new ZodValidationPipe(listQuerySchema)) q: z.infer<typeof listQuerySchema>,
  ) {
    return this.payments.listMine(req.principal!, q.limit);
  }

  @Get('orders/:id')
  get(@Req() req: AuthenticatedRequest, @Param('id', uuidPipe) id: string) {
    return this.payments.getOrder(req.principal!, id);
  }

  /**
   * Provider webhooks. No user token: requests are authenticated by the
   * provider's signature over the raw body.
   */
  @Public()
  @Post('webhooks/:provider')
  @HttpCode(204)
  async webhook(
    @Param('provider') provider: string,
    @Req() req: FastifyRequest & { rawBody?: Buffer },
  ): Promise<void> {
    await this.payments.webhook(provider, {
      path: req.url,
      host: req.headers.host ?? '',
      headers: req.headers,
      rawBody: req.rawBody ?? Buffer.alloc(0),
    });
  }
}
