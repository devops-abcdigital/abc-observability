export { teamsErrorNotifier } from './error-notifications/express-error-middleware';
export { notifyServerError } from './error-notifications/notify';
export { markSpanError, Traced, withSpan } from './tracing';

export type { TeamsErrorMiddleware } from './error-notifications/express-error-middleware';
export type { ServerErrorInput, ServerErrorRequest } from './error-notifications/notify';
