import { context, trace, TraceFlags } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEDUPE_WINDOW_MS,
  MAX_TRACKED_ERRORS,
  notifyServerError,
  resetNotifier,
  SEND_TIMEOUT_MS,
  settleNotifications,
} from '../../src/error-notifications/notify';
import { withSpan } from '../../src/tracing';
import { cardActionUrl, cardFacts, cardText, startFakeWebhook } from './fake-webhook';

import type { TeamsPayload } from '../../src/error-notifications/teams-card.builder';
import type { FakeWebhook } from './fake-webhook';

const provider = new TracerProvider({
  spanProcessors: [new SimpleSpanProcessor({ exporter: new InMemorySpanExporter() })],
});
const contextManager = new AsyncLocalStorageContextManager();
const REQUEST = {
  method: 'get',
  originalUrl: '/api/v1/projects/42?page=2',
  baseUrl: '/api/v1',
  route: { path: '/projects/:id' },
};

class QueryFailedError extends Error {}

let webhook: FakeWebhook | undefined;
let stderr: string[];

beforeAll(() => {
  context.setGlobalContextManager(contextManager.enable());
  trace.setGlobalTracerProvider(provider);
});

afterAll(async () => {
  await provider.shutdown();
  trace.disable();
  context.disable();
});

beforeEach(() => {
  resetNotifier();
  stderr = [];
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stderr.push(String(chunk));
    return true;
  });
  vi.stubEnv('OTEL_SERVICE_NAME', 'awp-be');
  vi.stubEnv('OTEL_RESOURCE_ATTRIBUTES', 'deployment.environment=staging,team=awp');
  vi.stubEnv('ABC_ALERT_GRAFANA_URL', 'https://grafana.example.com/');
  vi.stubEnv('ABC_ALERT_TEMPO_DATASOURCE_UID', 'tempo-uid');
  vi.stubEnv('ABC_ALERT_INCLUDE_MESSAGE', '');
});

afterEach(async () => {
  resetNotifier();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await webhook?.close();
  webhook = undefined;
});

async function useWebhook(options?: Parameters<typeof startFakeWebhook>[0]): Promise<FakeWebhook> {
  webhook = await startFakeWebhook(options);
  vi.stubEnv('ABC_ALERT_TEAMS_WEBHOOK_URL', webhook.url);
  return webhook;
}

/** Answers every webhook call with 202 without a network round trip, for timer-driven tests. */
function stubFetch() {
  vi.stubEnv('ABC_ALERT_TEAMS_WEBHOOK_URL', 'https://teams.example.com/webhook');
  return vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(new Response(null, { status: 202 })));
}

function sentPayloads(fetchSpy: ReturnType<typeof stubFetch>): TeamsPayload[] {
  // The notifier always sends a JSON string body.
  return fetchSpy.mock.calls.map(([, init]) => JSON.parse(init?.body as string) as TeamsPayload);
}

describe('notifyServerError', () => {
  it('sends nothing when the webhook URL is not set', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    notifyServerError({ error: new Error('boom'), request: REQUEST });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(stderr).toEqual([]);
  });

  it('sends nothing for status codes below 500', () => {
    const fetchSpy = stubFetch();

    notifyServerError({ error: new Error('not found'), request: REQUEST, statusCode: 404 });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('turns itself off with one warning for a non-https webhook URL', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    vi.stubEnv('ABC_ALERT_TEAMS_WEBHOOK_URL', 'http://teams.example.com/webhook?sig=secret');

    notifyServerError({ error: new Error('a'), request: REQUEST });
    notifyServerError({ error: new Error('b'), request: { ...REQUEST, route: { path: '/other' } } });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(stderr).toHaveLength(1);
    expect(stderr[0]).toContain('ABC_ALERT_TEAMS_WEBHOOK_URL must be an https URL');
    expect(stderr[0]).not.toContain('secret');
  });

  it('posts a card with service, route pattern, error and a link to the sampled trace', async () => {
    const hook = await useWebhook();

    const traceId = withSpan('request', (span) => {
      notifyServerError({ error: new QueryFailedError('too many clients already'), request: REQUEST });
      return span.spanContext().traceId;
    });
    await settleNotifications();

    expect(hook.payloads).toHaveLength(1);
    const [payload] = hook.payloads;
    expect(cardText(payload)).toContain('🔴 500 · GET /api/v1/projects/:id · awp-be (staging)');
    expect(cardFacts(payload)).toEqual({
      'Loại lỗi': 'QueryFailedError',
      Message: 'too many clients already',
      trace_id: traceId,
    });
    const link = cardActionUrl(payload) ?? '';
    expect(link.startsWith('https://grafana.example.com/explore?')).toBe(true);
    expect(decodeURIComponent(link)).toContain(traceId);
  });

  it('falls back to the path without query string when no route matched', async () => {
    const hook = await useWebhook();

    notifyServerError({ error: new Error('x'), request: { method: 'POST', originalUrl: '/upload?token=abc' } });
    await settleNotifications();

    expect(cardText(hook.payloads[0])).toContain('500 · POST /upload · awp-be');
  });

  it('rebuilds the router mount point that Express clears before app-level error middleware', async () => {
    const hook = await useWebhook();
    const routes = [
      { method: 'GET', originalUrl: '/api/v1/projects/42?x=1', baseUrl: '', route: { path: '/projects/:id' } },
      { method: 'GET', originalUrl: '/api/v1', baseUrl: '', route: { path: '/' } },
      { method: 'GET', originalUrl: '/static/files/a/b.txt', baseUrl: '', route: { path: '/files/*splat' } },
      { method: 'GET', originalUrl: '/', baseUrl: '', route: { path: '/' } },
    ];

    for (const request of routes) notifyServerError({ error: new Error('x'), request });
    await settleNotifications();

    expect(hook.payloads.map((p) => /500 · GET (\S+)/.exec(cardText(p))?.[1])).toEqual([
      '/api/v1/projects/:id',
      '/api/v1',
      '/files/*splat',
      '/',
    ]);
  });

  it('masks ID-like segments of unmatched paths and of rebuilt mount points', async () => {
    const hook = await useWebhook();
    const requests = [
      { method: 'GET', originalUrl: '/reset/3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b/confirm' },
      { method: 'GET', originalUrl: '/files/123/AbCdEf0123456789XyZ0token' },
      { method: 'GET', originalUrl: '/tenants/7/items/9', baseUrl: '', route: { path: '/items/:id' } },
    ];

    for (const request of requests) notifyServerError({ error: new Error('x'), request });
    await settleNotifications();

    expect(hook.payloads.map((p) => /500 · GET (\S+)/.exec(cardText(p))?.[1])).toEqual([
      '/reset/:id/confirm',
      '/files/:id/:id',
      '/tenants/:id/items/:id',
    ]);
  });

  it('keeps markdown links in the message from becoming clickable', async () => {
    const hook = await useWebhook();

    notifyServerError({ error: new Error('see [click here](https://evil.example.com)'), request: REQUEST });
    await settleNotifications();

    expect(cardFacts(hook.payloads[0]).Message).toBe('see [click here]​(https://evil.example.com)');
  });

  it('adds the network cause code to delivery warnings', async () => {
    const hook = await useWebhook();
    const url = hook.url;
    await hook.close();
    webhook = undefined;
    vi.stubEnv('ABC_ALERT_TEAMS_WEBHOOK_URL', url);

    notifyServerError({ error: new Error('x'), request: REQUEST });
    await settleNotifications();

    expect(stderr.join('')).toContain('error notification not delivered: fetch failed (ECONNREFUSED)');
  });

  it('adds no trace link for an unsampled span', async () => {
    const hook = await useWebhook();
    const unsampled = trace.wrapSpanContext({
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
      traceFlags: TraceFlags.NONE,
    });

    context.with(trace.setSpan(context.active(), unsampled), () =>
      notifyServerError({ error: new Error('x'), request: REQUEST }),
    );
    await settleNotifications();

    expect(cardFacts(hook.payloads[0]).trace_id).toBeUndefined();
    expect(cardActionUrl(hook.payloads[0])).toBeUndefined();
  });

  it('shows the trace id but no link when Grafana is not configured', async () => {
    const hook = await useWebhook();
    vi.stubEnv('ABC_ALERT_GRAFANA_URL', '');

    withSpan('request', () => notifyServerError({ error: new Error('x'), request: REQUEST }));
    await settleNotifications();

    expect(cardFacts(hook.payloads[0]).trace_id).toMatch(/^[0-9a-f]{32}$/);
    expect(cardActionUrl(hook.payloads[0])).toBeUndefined();
  });

  it('sanitizes the message, and leaves it out when ABC_ALERT_INCLUDE_MESSAGE=false', async () => {
    const hook = await useWebhook();

    notifyServerError({ error: new Error('cannot reach postgres://app:pw@db:5432/x'), request: REQUEST });
    await settleNotifications();
    expect(cardFacts(hook.payloads[0]).Message).toBe('cannot reach postgres://***@db:5432/x');

    resetNotifier();
    vi.stubEnv('ABC_ALERT_INCLUDE_MESSAGE', 'false');
    notifyServerError({ error: new Error('cannot reach postgres://app:pw@db:5432/x'), request: REQUEST });
    await settleNotifications();
    expect(cardFacts(hook.payloads[1]).Message).toBeUndefined();
  });

  it('names the error by its class, and copes with thrown non-errors', async () => {
    const hook = await useWebhook();

    notifyServerError({ error: 'plain string', request: { method: 'GET', url: '/a' } });
    notifyServerError({ error: { message: 'object error' }, request: { method: 'GET', url: '/b' } });
    notifyServerError({ error: undefined, request: { method: 'GET', url: '/c' } });
    await settleNotifications();

    expect(hook.payloads.map((p) => cardFacts(p)['Loại lỗi'])).toEqual(['string', 'Object', 'undefined']);
    expect(cardFacts(hook.payloads[1]).Message).toBe('object error');
  });

  it('returns at once and warns only once when the webhook answers with an error', async () => {
    const hook = await useWebhook({ status: 500 });

    notifyServerError({ error: new Error('a'), request: REQUEST });
    notifyServerError({ error: new Error('b'), request: { ...REQUEST, route: { path: '/other' } } });
    await settleNotifications();

    expect(hook.payloads).toHaveLength(2);
    expect(stderr).toHaveLength(1);
    expect(stderr[0]).toContain('error notification not delivered: webhook answered HTTP 500');
    expect(stderr[0]).not.toContain(hook.url);
  });

  it(`gives up on a hanging webhook after ${SEND_TIMEOUT_MS} ms without blocking the caller`, async () => {
    await useWebhook({ hang: true });

    const started = performance.now();
    notifyServerError({ error: new Error('a'), request: REQUEST });
    expect(performance.now() - started).toBeLessThan(50);

    await settleNotifications();
    expect(performance.now() - started).toBeGreaterThanOrEqual(SEND_TIMEOUT_MS - 100);
    expect(stderr.join('')).toContain('error notification not delivered');
  });

  it('never throws, even when the request object is hostile', () => {
    stubFetch();
    const hostile = {
      get method(): string {
        throw new Error('getter exploded');
      },
    };

    expect(() => notifyServerError({ error: new Error('x'), request: hostile })).not.toThrow();
    expect(stderr.join('')).toContain('error notification skipped: getter exploded');
  });
});

describe('dedupe', () => {
  it('turns 20 identical errors in one window into the first card plus one "repeated 19 times" card', async () => {
    vi.useFakeTimers();
    const fetchSpy = stubFetch();

    for (let i = 0; i < 20; i += 1) notifyServerError({ error: new QueryFailedError(`fail ${i}`), request: REQUEST });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(DEDUPE_WINDOW_MS);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [first, summary] = sentPayloads(fetchSpy);
    expect(cardFacts(first).Message).toBe('fail 0');
    expect(cardText(summary)).toContain('Lặp lại 19 lần trong 60 giây');
    expect(cardFacts(summary).Message).toBe('fail 19');

    await vi.advanceTimersByTimeAsync(DEDUPE_WINDOW_MS * 2);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('sends no summary when the error did not repeat, and a later error is new again', async () => {
    vi.useFakeTimers();
    const fetchSpy = stubFetch();

    notifyServerError({ error: new Error('once'), request: REQUEST });
    await vi.advanceTimersByTimeAsync(DEDUPE_WINDOW_MS);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    notifyServerError({ error: new Error('again'), request: REQUEST });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(cardText(sentPayloads(fetchSpy)[1])).toContain('🔴');
  });

  it('keeps a sustained error to one summary per window', async () => {
    vi.useFakeTimers();
    const fetchSpy = stubFetch();

    notifyServerError({ error: new Error('x'), request: REQUEST });
    for (let window = 0; window < 3; window += 1) {
      notifyServerError({ error: new Error('x'), request: REQUEST });
      notifyServerError({ error: new Error('x'), request: REQUEST });
      await vi.advanceTimersByTimeAsync(DEDUPE_WINDOW_MS);
    }

    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(sentPayloads(fetchSpy).slice(1).map(cardText)).toEqual(
      Array.from({ length: 3 }, () => expect.stringContaining('Lặp lại 2 lần') as string),
    );
  });

  it('tracks different routes, methods and error types separately', () => {
    const fetchSpy = stubFetch();

    notifyServerError({ error: new Error('x'), request: REQUEST });
    notifyServerError({ error: new Error('x'), request: { ...REQUEST, method: 'POST' } });
    notifyServerError({ error: new Error('x'), request: { ...REQUEST, route: { path: '/projects' } } });
    notifyServerError({ error: new QueryFailedError('x'), request: REQUEST });
    notifyServerError({ error: new Error('x'), request: REQUEST });

    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it(`stops tracking new errors past ${MAX_TRACKED_ERRORS} distinct ones, with one warning`, () => {
    const fetchSpy = stubFetch();

    for (let i = 0; i <= MAX_TRACKED_ERRORS + 5; i += 1) {
      notifyServerError({ error: new Error('x'), request: { method: 'GET', url: `/route-${i}` } });
    }

    expect(fetchSpy).toHaveBeenCalledTimes(MAX_TRACKED_ERRORS);
    expect(stderr.filter((line) => line.includes('distinct errors'))).toHaveLength(1);
  });
});
