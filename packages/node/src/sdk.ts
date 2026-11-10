import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';

import { isTracingEnabled } from './config';
import { createInstrumentations } from './instrumentations';
import { installShutdownHooks } from './shutdown';

let sdk: NodeSDK | undefined;

function warn(message: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[observability-node] ${message}: ${detail}\n`);
}

/**
 * Starts the OpenTelemetry SDK for traces only. Never throws: a broken setup must not take the
 * app down, it only prints one warning to stderr. Returns whether tracing is running.
 */
export function startTracing(): boolean {
  if (sdk !== undefined) return true;
  if (!isTracingEnabled()) return false;
  try {
    const instance = new NodeSDK({
      traceExporter: new OTLPTraceExporter(),
      instrumentations: createInstrumentations(),
      // Empty lists stop the SDK from creating its default OTLP metrics and logs pipelines.
      metricReaders: [],
      logRecordProcessors: [],
    });
    instance.start();
    sdk = instance;
    installShutdownHooks(stopTracing);
    return true;
  } catch (error) {
    warn('tracing disabled, SDK failed to start', error);
    return false;
  }
}

/** Flushes queued spans and stops the SDK. Safe to call when tracing never started. */
export async function stopTracing(): Promise<void> {
  const instance = sdk;
  sdk = undefined;
  if (instance === undefined) return;
  try {
    await instance.shutdown();
  } catch (error) {
    warn('failed to flush spans on shutdown', error);
  }
}
