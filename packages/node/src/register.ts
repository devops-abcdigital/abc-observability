/**
 * Entry point for `node --import @devops-abcdigital/observability-node/register`.
 * Must run before the app imports anything else so instrumentations can patch modules.
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

import { isTracingEnabled } from './config';
import { startTracing } from './sdk';

if (isTracingEnabled()) {
  try {
    // ESM apps need the loader hook; CommonJS apps are patched through require().
    register('@opentelemetry/instrumentation/hook.mjs', pathToFileURL(__filename));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[observability-node] ESM hook not registered, ESM modules will not be traced: ${detail}\n`);
  }
  startTracing();
}
