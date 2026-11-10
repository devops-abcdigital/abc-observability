import { once } from 'node:events';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { delay, runShortJob, SPAN_KIND_CLIENT, SPAN_KIND_SERVER, startApp, startReceiver, waitFor } from './harness';

import type { Receiver, StartedApp } from './harness';

const SERVICE_NAME = 'observability-node-it';
const EXIT_DEADLINE_MS = 5_000;

let receiver: Receiver;
let app: StartedApp | undefined;

beforeEach(async () => {
  receiver = await startReceiver();
});

afterEach(async () => {
  await app?.stop();
  app = undefined;
  await receiver.close();
});

function tracingEnv(extra: Record<string, string> = {}): Record<string, string> {
  return {
    OTEL_SERVICE_NAME: SERVICE_NAME,
    OTEL_EXPORTER_OTLP_ENDPOINT: receiver.url,
    OTEL_BSP_SCHEDULE_DELAY: '100',
    ...extra,
  };
}

describe('node --import register', () => {
  it('exports one trace across an incoming request, an outgoing fetch and the downstream request', async () => {
    app = await startApp(tracingEnv());

    const response = await fetch(`${app.baseUrl}/a`);
    expect(await response.text()).toBe('a -> b');

    const serverA = await waitFor(() =>
      receiver.spans.find((s) => s.kind === SPAN_KIND_SERVER && s.attributes['url.path'] === '/a'),
    );
    const serverB = await waitFor(() =>
      receiver.spans.find((s) => s.kind === SPAN_KIND_SERVER && s.attributes['url.path'] === '/b'),
    );
    const client = await waitFor(() =>
      receiver.spans.find((s) => s.kind === SPAN_KIND_CLIENT && s.traceId === serverA.traceId),
    );

    expect(serverA.serviceName).toBe(SERVICE_NAME);
    expect(serverB.traceId).toBe(serverA.traceId);
    expect(serverB.parentSpanId).toBe(client.spanId);
    // The client span sits under span A (directly or through framework spans such as Express handlers).
    const traceSpanIds = new Set(receiver.spans.filter((s) => s.traceId === serverA.traceId).map((s) => s.spanId));
    expect(client.parentSpanId && traceSpanIds.has(client.parentSpanId)).toBe(true);
  });

  it('produces Express handler spans once, without duplicates from the router instrumentation', async () => {
    app = await startApp(tracingEnv());

    await fetch(`${app.baseUrl}/b`);

    const server = await waitFor(() => receiver.spans.find((s) => s.attributes['url.path'] === '/b'));
    await waitFor(() =>
      receiver.spans.find(
        (s) => s.traceId === server.traceId && s.scopeName === '@opentelemetry/instrumentation-express',
      ),
    );
    expect(receiver.spans.some((s) => s.scopeName === '@opentelemetry/instrumentation-router')).toBe(false);
  });

  it('creates no span for the health check path', async () => {
    app = await startApp(tracingEnv());

    await fetch(`${app.baseUrl}/health`);
    await fetch(`${app.baseUrl}/b`);

    await waitFor(() => receiver.spans.find((s) => s.attributes['url.path'] === '/b'));
    expect(receiver.spans.some((s) => s.attributes['url.path'] === '/health')).toBe(false);
  });

  it('stays inert without an OTLP endpoint and the app still serves requests', async () => {
    app = await startApp({ OTEL_SERVICE_NAME: SERVICE_NAME, OTEL_BSP_SCHEDULE_DELAY: '100' });

    const response = await fetch(`${app.baseUrl}/recording`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ recording: false });
    expect((await fetch(`${app.baseUrl}/a`)).status).toBe(200);

    await delay(500);
    expect(receiver.requestCount()).toBe(0);
  });

  it('keeps serving when the exporter endpoint is unreachable', async () => {
    app = await startApp(tracingEnv({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1' }));

    expect(await (await fetch(`${app.baseUrl}/recording`)).json()).toEqual({ recording: true });
    expect((await fetch(`${app.baseUrl}/a`)).status).toBe(200);

    // Give the batch processor time to attempt (and fail) an export.
    await delay(1_000);
    expect(app.child.exitCode).toBeNull();
    expect((await fetch(`${app.baseUrl}/b`)).status).toBe(200);
  });

  it('exits on SIGTERM when the app has no handler of its own', async () => {
    app = await startApp(tracingEnv());
    const started = Date.now();

    app.child.kill('SIGTERM');
    await once(app.child, 'exit');

    expect(Date.now() - started).toBeLessThan(EXIT_DEADLINE_MS);
  });

  // Windows has no catchable SIGTERM: child.kill() terminates the process immediately.
  it.skipIf(process.platform === 'win32')('flushes queued spans on SIGTERM before exiting', async () => {
    // A long batch delay means spans only leave the process through the shutdown flush.
    app = await startApp(tracingEnv({ OTEL_BSP_SCHEDULE_DELAY: '60000' }));
    await fetch(`${app.baseUrl}/b`);

    app.child.kill('SIGTERM');
    const [, signal] = (await once(app.child, 'exit')) as [number | null, NodeJS.Signals | null];

    expect(signal).toBe('SIGTERM');
    expect(receiver.spans.some((s) => s.attributes['url.path'] === '/b')).toBe(true);
  });

  it('flushes queued spans when a short-lived process ends on its own, then exits normally', async () => {
    // A long batch delay means the span only leaves the process through the exit flush.
    const { code, durationMs } = await runShortJob(tracingEnv({ OTEL_BSP_SCHEDULE_DELAY: '60000' }));

    expect(code).toBe(0);
    expect(durationMs).toBeLessThan(EXIT_DEADLINE_MS);
    expect(receiver.spans.map((s) => s.name)).toContain('job.fixture.run');
  });
});
