import { Catch } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

import { notifyServerError } from './error-notifications/notify';

import type { ServerErrorRequest } from './error-notifications/notify';
import type { ArgumentsHost } from '@nestjs/common';

/**
 * The status `BaseExceptionFilter` answers with: `getStatus()` for an `HttpException` (checked by
 * shape, so a second copy of `@nestjs/common` cannot turn a 404 into a 500 alert), `statusCode` for
 * an http-errors style error that also has a message, otherwise 500.
 */
function nestStatus(exception: unknown): number {
  const { getStatus, statusCode, message } = (exception ?? {}) as {
    getStatus?: unknown;
    statusCode?: unknown;
    message?: unknown;
  };
  if (typeof getStatus === 'function') {
    const status: unknown = getStatus.call(exception);
    if (typeof status === 'number') return status;
  }
  return typeof statusCode === 'number' && statusCode > 0 && message ? statusCode : 500;
}

/**
 * Global NestJS exception filter that reports HTTP errors answered with 500 or above to Teams and
 * leaves the response to Nest's default handling:
 * `app.useGlobalFilters(new TeamsExceptionFilter(app.get(HttpAdapterHost).httpAdapter))`.
 *
 * Nest tries global filters from the last registered to the first, so when the app has its own
 * global filter (for example `@Catch(HttpException)`), register this one first. Exceptions that
 * filter catches never reach this one; call `notifyServerError()` from it for status 500 and above.
 *
 * HTTP only: in other contexts (GraphQL, microservices, WebSockets) the exception is rethrown
 * untouched, as if this filter were not registered.
 */
@Catch()
export class TeamsExceptionFilter extends BaseExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') throw exception;
    try {
      const statusCode = nestStatus(exception);
      if (statusCode >= 500) {
        notifyServerError({
          error: exception,
          request: host.switchToHttp().getRequest<ServerErrorRequest>(),
          statusCode,
        });
      }
    } catch {
      // Reporting must never change how Nest answers the request.
    }
    super.catch(exception, host);
  }
}
