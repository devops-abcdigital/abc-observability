import { context, createContextKey, isSpanContextValid, trace, TraceFlags } from '@opentelemetry/api';

import { alertConfig } from '../config';
import { MAX_SCANNED_LENGTH, sanitizeMessage } from './sanitize';
import { errorCard, repeatCard, traceUrl } from './teams-card';

import type { AlertConfig } from '../config';
import type { ServerErrorEvent, TeamsPayload } from './teams-card';

/** Same error (service, method, route, type) within this window: first one is sent, the rest are counted. */
export const DEDUPE_WINDOW_MS = 60_000;
/** A slow or hanging webhook is abandoned after this long. */
export const SEND_TIMEOUT_MS = 3_000;
/** Upper bound on distinct errors tracked at once, so a flood of unique routes cannot grow memory. */
export const MAX_TRACKED_ERRORS = 500;

/**
 * The key `suppressTracing()` from `@opentelemetry/core` sets. `createContextKey` is `Symbol.for`,
 * so instrumentations recognise it without a dependency on core. Suppressing keeps the webhook call
 * (whose URL holds a signature) out of the traces.
 */
const SUPPRESS_TRACING_KEY = createContextKey('OpenTelemetry SDK Context Key SUPPRESS_TRACING');

/** The parts of a request the notifier reads; `express.Request` (also under NestJS) fits as is. */
export interface ServerErrorRequest {
  method?: string;
  originalUrl?: string;
  url?: string;
  baseUrl?: string;
  route?: { path?: unknown };
}

export interface ServerErrorInput {
  error: unknown;
  request?: ServerErrorRequest;
  /** Defaults to 500. Anything below 500 is ignored. */
  statusCode?: number;
}

interface DedupeWindow {
  repeats: number;
  last?: ServerErrorEvent;
  timer: NodeJS.Timeout;
}

const windows = new Map<string, DedupeWindow>();
const pending = new Set<Promise<void>>();
const warned = new Set<string>();

/** Error message plus its network cause code (e.g. `fetch failed (ECONNREFUSED)`). */
function detail(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const code = (error.cause as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' ? `${error.message} (${code})` : error.message;
}

/** One stderr line per kind of problem; `send` is re-armed by the next successful delivery. */
function warnOnce(kind: string, message: string): void {
  if (warned.has(kind)) return;
  warned.add(kind);
  process.stderr.write(`[observability-node] ${message}\n`);
}

/** Numbers, UUIDs, hex and long tokens: values, not route names. */
function isIdSegment(segment: string): boolean {
  return (
    /^\d+$/.test(segment) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment) ||
    /^[0-9a-f]{16,}$/i.test(segment) ||
    (segment.length >= 20 && /\d/.test(segment) && /[a-z]/i.test(segment))
  );
}

/** Path without query string, with ID-like segments replaced by `:id` so values stay out of the chat and the dedupe key. */
function pathOf(request: ServerErrorRequest | undefined): string | undefined {
  const raw = request?.originalUrl ?? request?.url;
  if (!raw) return undefined;
  return raw
    .split('?', 1)[0]
    .split('/')
    .map((segment) => (isIdSegment(segment) ? ':id' : segment))
    .join('/');
}

/**
 * Where the router that matched `pattern` is mounted. Express clears `baseUrl` once an error leaves
 * a router, so an app-level error middleware rebuilds it from the path, unless the pattern can span
 * a variable number of segments.
 */
function mountPrefix(request: ServerErrorRequest, pattern: string): string {
  if (request.baseUrl) return request.baseUrl;
  if (/[*?({]/.test(pattern)) return '';
  const segments = (pathOf(request) ?? '').split('/').filter(Boolean);
  const patternSegments = pattern.split('/').filter(Boolean).length;
  return segments.length > patternSegments ? `/${segments.slice(0, -patternSegments || undefined).join('/')}` : '';
}

/** Route pattern when the framework matched one, else the path with IDs masked. */
function routeOf(request: ServerErrorRequest | undefined): string {
  const pattern = request?.route?.path;
  if (request && typeof pattern === 'string') {
    const prefix = mountPrefix(request, pattern);
    return prefix && pattern === '/' ? prefix : `${prefix}${pattern}` || '/';
  }
  return pathOf(request) ?? 'unknown route';
}

function errorTypeOf(error: unknown): string {
  if (error instanceof Error) return error.name && error.name !== 'Error' ? error.name : error.constructor.name;
  if (typeof error === 'object' && error !== null) return error.constructor?.name ?? 'Object';
  return typeof error;
}

function messageOf(error: unknown): string | undefined {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  const message = (error as { message?: unknown } | null | undefined)?.message;
  return typeof message === 'string' ? message : undefined;
}

function activeTraceId(): string | undefined {
  const spanContext = trace.getActiveSpan()?.spanContext();
  if (!spanContext || !isSpanContextValid(spanContext)) return undefined;
  return (spanContext.traceFlags & TraceFlags.SAMPLED) !== 0 ? spanContext.traceId : undefined;
}

/** The message stays raw here; it is sanitized only when a card is actually sent (see {@link sanitized}). */
function describeError(input: ServerErrorInput, statusCode: number, config: AlertConfig): ServerErrorEvent {
  const occurredAt = new Date();
  const message = config.includeMessage ? messageOf(input.error)?.slice(0, MAX_SCANNED_LENGTH) : undefined;
  const traceId = activeTraceId();
  return {
    service: config.service,
    environment: config.environment,
    method: (input.request?.method ?? 'UNKNOWN').toUpperCase(),
    route: routeOf(input.request),
    statusCode,
    errorType: errorTypeOf(input.error),
    message,
    occurredAt,
    traceId,
    traceUrl: traceId && config.traceLink ? traceUrl(config.traceLink, traceId, occurredAt) : undefined,
  };
}

function sanitized(event: ServerErrorEvent): ServerErrorEvent {
  return { ...event, message: event.message === undefined ? undefined : sanitizeMessage(event.message) || undefined };
}

function send(webhookUrl: string, payload: TeamsPayload): void {
  const delivery = context
    .with(context.active().setValue(SUPPRESS_TRACING_KEY, true), () =>
      fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      }),
    )
    .then(async (response) => {
      await response.body?.cancel();
      if (!response.ok) throw new Error(`webhook answered HTTP ${response.status}`);
      warned.delete('send');
    })
    // Never include the URL: it is a secret.
    .catch((error: unknown) => warnOnce('send', `error notification not delivered: ${detail(error)}`))
    .finally(() => pending.delete(delivery));
  pending.add(delivery);
}

function openWindow(key: string, webhookUrl: string): void {
  const timer = setTimeout(() => closeWindow(key, webhookUrl), DEDUPE_WINDOW_MS);
  timer.unref();
  windows.set(key, { repeats: 0, timer });
}

/** Sends the repeat summary, then keeps counting, so a sustained error gives one message per window. */
function closeWindow(key: string, webhookUrl: string): void {
  try {
    const window = windows.get(key);
    windows.delete(key);
    if (windows.size < MAX_TRACKED_ERRORS) warned.delete('capacity');
    if (!window?.last || window.repeats === 0) return;
    send(webhookUrl, repeatCard(sanitized(window.last), window.repeats, DEDUPE_WINDOW_MS));
    openWindow(key, webhookUrl);
  } catch (error) {
    warnOnce('internal', `error notification skipped: ${detail(error)}`);
  }
}

/**
 * Reports a 500 error to the Teams chat configured by `ABC_ALERT_TEAMS_WEBHOOK_URL`. Returns at
 * once and never throws: delivery runs in the background and failures only print one stderr
 * warning. Does nothing when the webhook URL is not set or `statusCode` is below 500.
 */
export function notifyServerError(input: ServerErrorInput): void {
  try {
    const statusCode = input.statusCode ?? 500;
    if (statusCode < 500) return;
    const config = alertConfig(process.env, (message) => warnOnce('config', message));
    if (!config) return;

    const event = describeError(input, statusCode, config);
    const key = [event.service, event.method, event.route, event.errorType].join('|');
    const open = windows.get(key);
    if (open) {
      open.repeats += 1;
      open.last = event;
      return;
    }
    if (windows.size >= MAX_TRACKED_ERRORS) {
      warnOnce('capacity', `more than ${MAX_TRACKED_ERRORS} distinct errors in ${DEDUPE_WINDOW_MS / 1000}s, skipping`);
      return;
    }
    openWindow(key, config.webhookUrl);
    send(config.webhookUrl, errorCard(sanitized(event)));
  } catch (error) {
    warnOnce('internal', `error notification skipped: ${detail(error)}`);
  }
}

/** @internal Test helper: waits for in-flight deliveries. */
export async function settleNotifications(): Promise<void> {
  await Promise.all([...pending]);
}

/** @internal Test helper: forgets dedupe windows and warnings. */
export function resetNotifier(): void {
  for (const window of windows.values()) clearTimeout(window.timer);
  windows.clear();
  warned.clear();
}
