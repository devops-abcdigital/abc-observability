import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

import { ignoredPaths, isIgnoredPath } from './config';

import type { Instrumentation } from '@opentelemetry/instrumentation';

/**
 * Official auto-instrumentations with noisy low-level ones turned off. Everything else
 * (http, express, @nestjs/core, pg, undici/fetch, grpc, pino, …) keeps the upstream default: on.
 */
export function createInstrumentations(): Instrumentation[] {
  const paths = ignoredPaths();
  return getNodeAutoInstrumentations({
    '@opentelemetry/instrumentation-fs': { enabled: false },
    '@opentelemetry/instrumentation-dns': { enabled: false },
    '@opentelemetry/instrumentation-net': { enabled: false },
    // Express 5 (and NestJS 11 on top of it) routes through the `router` package, so this would
    // duplicate every handler span already produced by the Express instrumentation.
    '@opentelemetry/instrumentation-router': { enabled: false },
    '@opentelemetry/instrumentation-http': {
      ignoreIncomingRequestHook: (request) => isIgnoredPath(request.url, paths),
    },
    // Only inject trace_id/span_id into log lines; logs are not exported.
    '@opentelemetry/instrumentation-pino': { disableLogSending: true },
  });
}
