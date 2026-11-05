import type { AppFastifyReply, AppFastifyRequest } from '../types/app.js';

// Errors Fastify and its plugins raise on purpose (failed validation, malformed JSON, rate limits)
// carry a 4xx status and a message written for the client. Anything else is a bug: log it, and
// don't tell the client what went wrong.
export const appErrorHandler = (
  error: Error & { statusCode?: number; code?: string },
  request: AppFastifyRequest,
  reply: AppFastifyReply
) => {
  if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
    return reply.status(error.statusCode).send({
      success: false,
      error: error.message,
      code: error.code,
    });
  }

  // On MongoDB, an id that isn't a valid ObjectId can't name anything.
  if (error.code === 'P2023') {
    return reply.status(404).send({ success: false, error: 'Not found', code: 'NOT_FOUND' });
  }
  if (error.name === 'PrismaClientValidationError') {
    request.server.log.warn({ url: request.url, method: request.method }, 'Invalid query shape');
    return reply
      .status(400)
      .send({ success: false, error: 'Invalid request', code: 'BAD_REQUEST' });
  }

  request.server.log.error(
    {
      error: error.message,
      stack: error.stack,
      url: request.url,
      method: request.method,
    },
    'Unhandled error'
  );

  return reply.status(500).send({
    success: false,
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
    timestamp: new Date().toISOString(),
  });
};
