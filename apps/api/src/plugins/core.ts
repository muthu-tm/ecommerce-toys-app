import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  NotFoundError,
  RateLimitedError,
  resolveRequestId,
  runWithRequestContext,
  toAppError,
  toProblemDetails,
} from '@romp/observability';

import type { ApiDeps } from '../deps';
import { anonymousCaller } from '../request-context';

/**
 * The outermost layer: correlation ID, request-scoped context, request logging, and the
 * error handler that turns anything thrown into RFC 7807.
 *
 * This is registered first so the request ID exists before any other middleware runs (auth
 * logs against it) and so the error handler wraps everything (a throw in any later hook or
 * handler lands here). The order `API.md` fixes is load-bearing, and this plugin owns the
 * two ends of it.
 */
export function registerCore(app: FastifyInstance, deps: ApiDeps): void {
  const { logger } = deps;

  // Correlation ID + ambient request context, before anything else. The ID is taken from an
  // inbound `x-request-id` (sanitised) or minted, echoed on the response, and made ambient
  // so every log line the request produces carries it without being passed one.
  app.addHook('onRequest', (request, reply, done) => {
    const requestId = resolveRequestId(request.headers['x-request-id']);
    request.requestId = requestId;
    // Every request starts anonymous; the auth middleware upgrades it once a token is
    // verified. A handler that forgets to run auth therefore sees "nobody", never a
    // half-set identity.
    request.caller = anonymousCaller;
    reply.header('x-request-id', requestId);

    // Run the rest of the request inside the ambient context, so the logger's mixin and any
    // deep call can read the correlation ID.
    runWithRequestContext({ requestId, route: request.routeOptions.url ?? request.url }, () => {
      done();
    });
  });

  // Structured request/response logging on the shared logger, which redacts phone, email,
  // UTR, password and authorization at serialisation time. Logging the *type* of an
  // identifier is fine; logging the value is what the redactor prevents.
  app.addHook('onResponse', (request, reply, done) => {
    logger.info(
      {
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        durationMs: Math.round(reply.elapsedTime),
      },
      'request.completed',
    );
    done();
  });

  // The single place an error becomes a response. Everything thrown — a Zod failure, an
  // AppError, an unexpected throw — is normalised to an AppError, logged with its context,
  // and rendered as problem+json. Internal detail never crosses the boundary: `toAppError`
  // wraps an unknown throw as INTERNAL, whose detail `toProblemDetails` refuses to expose.
  app.setErrorHandler((error: unknown, request: FastifyRequest, reply: FastifyReply) => {
    const appError = toAppError(error);
    const problem = toProblemDetails(appError, request.requestId);

    // 5xx is a real failure worth a stack; 4xx is the client's problem and logged at info so
    // the logs are not noise. The error's own `context` rides along, already redaction-safe.
    if (appError.httpStatus >= 500) {
      logger.error({ err: appError, ...appError.context }, 'request.failed');
    } else {
      logger.info({ code: appError.code, ...appError.context }, 'request.rejected');
    }

    if (appError instanceof RateLimitedError) {
      reply.header('retry-after', String(appError.retryAfterSeconds));
    }

    void reply.code(appError.httpStatus).type('application/problem+json').send(problem);
  });

  // A 404 for an unmatched route should also be problem+json, not Fastify's default JSON.
  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    const problem = toProblemDetails(
      new NotFoundError({ detail: 'No such endpoint.' }),
      request.requestId,
    );
    void reply.code(404).type('application/problem+json').send(problem);
  });
}
