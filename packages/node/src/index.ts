export { teamsErrorNotifier } from './alerts/express';
export { notifyServerError } from './alerts/notify';
export { markSpanError, Traced, withSpan } from './tracing';

export type { TeamsErrorMiddleware } from './alerts/express';
export type { ServerErrorInput, ServerErrorRequest } from './alerts/notify';
