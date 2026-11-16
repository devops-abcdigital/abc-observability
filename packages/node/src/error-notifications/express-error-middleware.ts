import { notifyServerError } from './notify';

import type { ServerErrorRequest } from './notify';

export type TeamsErrorMiddleware = (
  error: unknown,
  request: ServerErrorRequest,
  response: unknown,
  next: (error?: unknown) => void,
) => void;

function errorStatusCode(value: unknown): number | undefined {
  return typeof value === 'number' && value >= 400 && value < 600 ? value : undefined;
}

/**
 * The status Express's final handler answers with: the error's `status` or `statusCode` (400–599),
 * else the status already set on the response (400–599), else 500.
 */
function expressStatus(error: unknown, response: unknown): number {
  const { status, statusCode } = (typeof error === 'object' && error !== null ? error : {}) as {
    status?: unknown;
    statusCode?: unknown;
  };
  const responseStatus = (response as { statusCode?: unknown } | null | undefined)?.statusCode;
  return errorStatusCode(status) ?? errorStatusCode(statusCode) ?? errorStatusCode(responseStatus) ?? 500;
}

/**
 * Express error middleware that reports errors answered with 500 or above to Teams, then passes
 * the error on unchanged. Register it after the routes and before the app's own error handler:
 * `app.use(teamsErrorNotifier())`.
 */
export function teamsErrorNotifier(): TeamsErrorMiddleware {
  return (error, request, response, next) => {
    try {
      notifyServerError({ error, request, statusCode: expressStatus(error, response) });
    } catch {
      // Reporting must never change how the app handles the error.
    }
    next(error);
  };
}
