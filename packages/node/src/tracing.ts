import { SpanStatusCode, trace } from '@opentelemetry/api';

import type { Attributes, Span, Tracer } from '@opentelemetry/api';

const TRACER_NAME = '@devops-abcdigital/observability-node';

function tracer(): Tracer {
  return trace.getTracer(TRACER_NAME);
}

function recordFailure(span: Span, error: unknown): void {
  if (error instanceof Error) {
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
  } else {
    span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function';
}

/**
 * Runs `fn` inside a new active span. Works with sync and async functions: on error the
 * exception is recorded, status is set to ERROR and the error is rethrown; the span always ends.
 * When tracing is disabled this just calls `fn` (with a no-op span).
 */
export function withSpan<T>(name: string, fn: (span: Span) => T, attributes?: Attributes): T {
  return tracer().startActiveSpan(name, { attributes }, (span) => {
    let result: T;
    try {
      result = fn(span);
    } catch (error) {
      recordFailure(span, error);
      span.end();
      throw error;
    }
    if (!isPromiseLike(result)) {
      span.end();
      return result;
    }
    return Promise.resolve(result).then(
      (value) => {
        span.end();
        return value;
      },
      (error: unknown) => {
        recordFailure(span, error);
        span.end();
        throw error;
      },
    ) as T;
  });
}

type MetadataReflect = {
  getMetadataKeys?: (target: object) => unknown[];
  getMetadata?: (key: unknown, target: object) => unknown;
  defineMetadata?: (key: unknown, value: unknown, target: object) => void;
};

/** Keeps metadata set by other decorators (e.g. NestJS `@Cron`, `@OnEvent`) on the wrapped method. */
function copyMetadata(from: object, to: object): void {
  const reflect = Reflect as unknown as MetadataReflect;
  if (!reflect.getMetadataKeys || !reflect.getMetadata || !reflect.defineMetadata) return;
  for (const key of reflect.getMetadataKeys(from)) {
    reflect.defineMetadata(key, reflect.getMetadata(key, from), to);
  }
}

type Method = (this: unknown, ...args: unknown[]) => unknown;

/**
 * Method decorator that wraps the method in {@link withSpan}. The span name defaults to
 * `ClassName.methodName`.
 */
export function Traced(name?: string): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    const original: unknown = descriptor.value;
    if (typeof original !== 'function') return descriptor;
    const method = original as Method;
    const spanName = name ?? `${target.constructor.name}.${String(propertyKey)}`;
    const wrapped: Method = function (this: unknown, ...args: unknown[]) {
      return withSpan(spanName, () => method.apply(this, args));
    };
    Object.defineProperty(wrapped, 'name', { value: method.name });
    copyMetadata(method, wrapped);
    return { ...descriptor, value: wrapped as typeof descriptor.value };
  };
}

/**
 * Marks the active span as failed with an already-sanitized message, for code that catches an
 * error and returns a result instead of throwing (so {@link withSpan} never sees it). Takes a
 * string on purpose: raw provider errors can carry URLs with keys or request headers. Does nothing
 * when there is no active span.
 */
export function markSpanError(message: string): void {
  trace.getActiveSpan()?.setStatus({ code: SpanStatusCode.ERROR, message });
}
