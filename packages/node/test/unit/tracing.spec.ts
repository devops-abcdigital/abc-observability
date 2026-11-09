import { context, SpanStatusCode, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { InMemorySpanExporter, SimpleSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { markSpanError, Traced, withSpan } from '../../src/tracing';

const exporter = new InMemorySpanExporter();
const provider = new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter })] });
const contextManager = new AsyncLocalStorageContextManager();

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
  exporter.reset();
});

function finished(name: string) {
  const span = exporter.getFinishedSpans().find((s) => s.name === name);
  if (!span) throw new Error(`span ${name} not finished`);
  return span;
}

describe('withSpan', () => {
  it('returns the sync result and ends an OK span with attributes', () => {
    const result = withSpan('sync-ok', () => 42, { 'app.kind': 'unit' });

    expect(result).toBe(42);
    const span = finished('sync-ok');
    expect(span.status.code).toBe(SpanStatusCode.UNSET);
    expect(span.attributes['app.kind']).toBe('unit');
  });

  it('resolves the async result and ends the span after it settles', async () => {
    const result = await withSpan('async-ok', async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return 'done';
    });

    expect(result).toBe('done');
    expect(finished('async-ok').status.code).toBe(SpanStatusCode.UNSET);
  });

  it('records the exception, sets ERROR and rethrows on sync failure', () => {
    expect(() =>
      withSpan('sync-fail', () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');

    const span = finished('sync-fail');
    expect(span.status).toEqual({ code: SpanStatusCode.ERROR, message: 'boom' });
    expect(span.events.map((e) => e.name)).toContain('exception');
  });

  it('records the exception, sets ERROR and rejects on async failure', async () => {
    await expect(
      withSpan('async-fail', async () => {
        await Promise.resolve();
        throw new Error('async boom');
      }),
    ).rejects.toThrow('async boom');

    const span = finished('async-fail');
    expect(span.status).toEqual({ code: SpanStatusCode.ERROR, message: 'async boom' });
    expect(span.events.map((e) => e.name)).toContain('exception');
  });

  it('handles non-Error throws without an exception event', () => {
    expect(() =>
      withSpan('string-throw', () => {
        throw 'plain string' as unknown as Error;
      }),
    ).toThrow();

    const span = finished('string-throw');
    expect(span.status).toEqual({ code: SpanStatusCode.ERROR, message: 'plain string' });
  });

  it('nests spans as parent and child in the same trace', async () => {
    await withSpan('parent', async () => {
      await withSpan('child', async () => Promise.resolve());
    });

    const parent = finished('parent');
    const child = finished('child');
    expect(child.spanContext().traceId).toBe(parent.spanContext().traceId);
    expect(child.parentSpanContext?.spanId).toBe(parent.spanContext().spanId);
  });
});

describe('Traced', () => {
  class Service {
    constructor(private readonly factor: number) {}

    @Traced()
    multiply(value: number): number {
      return value * this.factor;
    }

    @Traced('custom.name')
    async fail(): Promise<void> {
      await Promise.resolve();
      throw new Error('traced failure');
    }
  }

  it('names the span ClassName.methodName and keeps `this`', () => {
    expect(new Service(3).multiply(2)).toBe(6);
    expect(finished('Service.multiply').status.code).toBe(SpanStatusCode.UNSET);
  });

  it('uses the custom name and records failures', async () => {
    await expect(new Service(1).fail()).rejects.toThrow('traced failure');

    const span = finished('custom.name');
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.events.map((e) => e.name)).toContain('exception');
  });

  it('keeps the original method name', () => {
    expect(Service.prototype.multiply.name).toBe('multiply');
  });
});

describe('markSpanError', () => {
  it('sets ERROR with the given message and adds no exception event', () => {
    const result = withSpan('job.test.sync', () => {
      markSpanError('provider rejected the credentials');
      return { error: 'provider rejected the credentials' };
    });

    expect(result.error).toBe('provider rejected the credentials');
    const span = finished('job.test.sync');
    expect(span.status).toEqual({ code: SpanStatusCode.ERROR, message: 'provider rejected the credentials' });
    expect(span.events).toHaveLength(0);
  });

  it('does nothing outside a span', () => {
    expect(() => markSpanError('no span here')).not.toThrow();
    expect(exporter.getFinishedSpans()).toHaveLength(0);
  });
});
