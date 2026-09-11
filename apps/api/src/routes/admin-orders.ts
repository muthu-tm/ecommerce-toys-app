import type { FastifyRequest } from 'fastify';

import type {
  AdminOrderActionResponse,
  AdminOrderListResponse,
  AdminOrderMutationResponse,
  IssueRefundResponse,
} from '@romp/contracts';
import {
  AdminOrderListRequestSchema,
  CancelOrderRequestSchema,
  FulfilmentRequestSchema,
  IssueRefundRequestSchema,
  RejectPaymentRequestSchema,
  VerifyPaymentRequestSchema,
} from '@romp/contracts';
import {
  advanceFulfilment,
  cancelOrder,
  findOrder,
  issueRefund,
  listOrders,
  rejectPayment,
  verifyPayment,
} from '@romp/data';
import { parseOrThrow } from '@romp/observability';

import type { RompApp } from '../app';
import { requireAdminHook } from '../plugins/auth';
import { RATE_LIMITS, rateLimitKey } from '../plugins/rate-limit';
import { requireOperator } from '../request-context';

import { toOrderView } from './orders';

/**
 * The admin order-and-money routes — verify a payment, reject one, issue a refund, and read the
 * verification queue.
 *
 * These are the backoffice actions that settle an order. Every one is attributable: the acting
 * admin's uid is recorded on the order event and the spine event the repository writes, which is the
 * whole point of the manual-payment audit (`SECURITY.md`). Verifying and rejecting are staff
 * actions; issuing a refund — the one action that moves money outward — is owner-only, enforced in
 * the repository so it holds however the route is reached. Errors are `AppError`s the core handler
 * renders to problem+json, so the routes only translate the request and hand off.
 */
export function registerAdminOrderRoutes(app: RompApp): void {
  const { context } = app.deps;

  const limit = (request: FastifyRequest): void => {
    app.rateLimiter.consume(rateLimitKey(request, 'adminOrderWrite'), RATE_LIMITS.adminOrderWrite);
  };

  // --- the order list: newest first, filterable and searchable ------------
  app.get('/v1/admin/orders', { preHandler: requireAdminHook }, async (request, reply) => {
    const operator = requireOperator(request);
    const query = parseOrThrow(AdminOrderListRequestSchema, request.query);

    const page = await listOrders(context, operator, {
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.fulfilmentStatus === undefined ? {} : { fulfilmentStatus: query.fulfilmentStatus }),
      ...(query.humanId === undefined ? {} : { humanId: query.humanId }),
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      limit: query.limit,
    });

    const response: AdminOrderListResponse = {
      items: page.items.map((order) => toOrderView(order)),
      nextCursor: page.nextCursor,
    };
    return reply.send(response);
  });

  // --- verify a payment: commit stock and mark the order paid -------------
  app.post(
    '/v1/admin/orders/:id/verify-payment',
    { preHandler: requireAdminHook },
    async (request, reply) => {
      const operator = requireOperator(request);
      limit(request);
      const { id: orderId } = request.params as { id: string };
      const body = parseOrThrow(VerifyPaymentRequestSchema, request.body);

      await verifyPayment(context, operator, {
        orderId,
        paidAmountMinor: body.paidAmountMinor,
      });

      // Return the full, freshly-read order so the backoffice reflects the new state.
      const order = await findOrder(context, operator, orderId);
      const response: AdminOrderActionResponse = toOrderView(order);
      return reply.send(response);
    },
  );

  // --- reject a payment: the customer may resubmit ------------------------
  app.post(
    '/v1/admin/orders/:id/reject-payment',
    { preHandler: requireAdminHook },
    async (request, reply) => {
      const operator = requireOperator(request);
      limit(request);
      const { id: orderId } = request.params as { id: string };
      const body = parseOrThrow(RejectPaymentRequestSchema, request.body);

      await rejectPayment(context, operator, { orderId, reason: body.reason });

      const order = await findOrder(context, operator, orderId);
      const response: AdminOrderActionResponse = toOrderView(order);
      return reply.send(response);
    },
  );

  // --- advance fulfilment: pack, ship, deliver, hold ----------------------
  app.post(
    '/v1/admin/orders/:id/fulfilment',
    { preHandler: requireAdminHook },
    async (request, reply) => {
      const operator = requireOperator(request);
      limit(request);
      const { id: orderId } = request.params as { id: string };
      const body = parseOrThrow(FulfilmentRequestSchema, request.body);

      await advanceFulfilment(context, operator, {
        orderId,
        status: body.status,
        carrier: body.carrier,
        trackingNo: body.trackingNo,
        holdReason: body.holdReason,
      });

      const order = await findOrder(context, operator, orderId);
      const response: AdminOrderMutationResponse = toOrderView(order);
      return reply.send(response);
    },
  );

  // --- cancel an order: release or restock, per its prior state -----------
  app.post(
    '/v1/admin/orders/:id/cancel',
    { preHandler: requireAdminHook },
    async (request, reply) => {
      const operator = requireOperator(request);
      limit(request);
      const { id: orderId } = request.params as { id: string };
      const body = parseOrThrow(CancelOrderRequestSchema, request.body);

      await cancelOrder(context, operator, {
        orderId,
        reason: body.reason,
        restock: body.restock,
      });

      const order = await findOrder(context, operator, orderId);
      const response: AdminOrderMutationResponse = toOrderView(order);
      return reply.send(response);
    },
  );

  // --- issue a refund (owner-only, enforced in the repository) ------------
  app.post('/v1/admin/refunds', { preHandler: requireAdminHook }, async (request, reply) => {
    const operator = requireOperator(request);
    limit(request);
    const body = parseOrThrow(IssueRefundRequestSchema, request.body);

    const result = await issueRefund(context, operator, {
      orderId: body.orderId,
      mode: body.mode,
      amountMinor: body.amountMinor,
      reason: body.reason,
      note: body.note,
      outwardUpiRef: body.outwardUpiRef,
      restock: body.restock,
    });

    const response: IssueRefundResponse = {
      refundId: result.refundId as IssueRefundResponse['refundId'],
      orderId: result.orderId as IssueRefundResponse['orderId'],
      status: result.status as IssueRefundResponse['status'],
      refundedMinor: result.refundedMinor as IssueRefundResponse['refundedMinor'],
    };
    return reply.send(response);
  });
}
