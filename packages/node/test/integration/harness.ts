import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { ChildProcess } from 'node:child_process';
import type { AddressInfo } from 'node:net';

// `--import` takes a URL; a bare Windows path (D:\...) is rejected as an unknown scheme.
const REGISTER_URL = pathToFileURL(path.resolve(__dirname, '../../dist/register.js')).href;
const FIXTURE_PATH = path.resolve(__dirname, 'fixtures/express-app.cjs');
const SHORT_JOB_PATH = path.resolve(__dirname, 'fixtures/short-job.cjs');
const READY_TIMEOUT_MS = 10_000;

export const SPAN_KIND_SERVER = 2;
export const SPAN_KIND_CLIENT = 3;

export interface ReceivedSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  serviceName?: string;
  scopeName?: string;
  attributes: Record<string, unknown>;
}

interface OtlpAttribute {
  key: string;
  value: Record<string, unknown>;
}

interface OtlpBody {
  resourceSpans?: {
    resource?: { attributes?: OtlpAttribute[] };
    scopeSpans?: {
      scope?: { name?: string };
      spans?: (Omit<ReceivedSpan, 'attributes' | 'serviceName' | 'scopeName'> & { attributes?: OtlpAttribute[] })[];
    }[];
  }[];
}

function attributeMap(attributes: OtlpAttribute[] = []): Record<string, unknown> {
  return Object.fromEntries(attributes.map((a) => [a.key, Object.values(a.value)[0]]));
}

/** Minimal OTLP/HTTP JSON receiver standing in for Alloy. */
export async function startReceiver() {
  const spans: ReceivedSpan[] = [];
  let requestCount = 0;
  const server = createServer((req, res) => {
    requestCount += 1;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as OtlpBody;
      for (const resourceSpan of body.resourceSpans ?? []) {
        const resource = attributeMap(resourceSpan.resource?.attributes);
        for (const scope of resourceSpan.scopeSpans ?? []) {
          for (const span of scope.spans ?? []) {
            spans.push({
              ...span,
              serviceName: resource['service.name'] as string | undefined,
              scopeName: scope.scope?.name,
              attributes: attributeMap(span.attributes),
            });
          }
        }
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    spans,
    requestCount: () => requestCount,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export type Receiver = Awaited<ReturnType<typeof startReceiver>>;

/** Parent env without any OTEL_* / ABC_OTEL_* values so tests control configuration exactly. */
function cleanEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(ABC_)?OTEL_/.test(key)));
}

export interface StartedApp {
  baseUrl: string;
  child: ChildProcess;
  stderr: () => string;
  stop: () => Promise<void>;
}

export async function startApp(env: Record<string, string>): Promise<StartedApp> {
  const child = spawn(process.execPath, ['--import', REGISTER_URL, FIXTURE_PATH], {
    env: { ...cleanEnv(), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));

  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`app did not start: ${stderr}`)), READY_TIMEOUT_MS);
    child.once('exit', (code) => reject(new Error(`app exited early (${code}): ${stderr}`)));
    child.stdout?.on('data', (chunk: Buffer) => {
      const match = /listening (\d+)/.exec(chunk.toString());
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
  });

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    child,
    stderr: () => stderr,
    stop: async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill('SIGKILL');
      await once(child, 'exit');
    },
  };
}

/** Runs the short-job fixture until it exits on its own; resolves with its exit code and duration. */
export async function runShortJob(env: Record<string, string>): Promise<{ code: number | null; durationMs: number }> {
  const started = Date.now();
  const child = spawn(process.execPath, ['--import', REGISTER_URL, SHORT_JOB_PATH], {
    env: { ...cleanEnv(), ...env },
    stdio: 'ignore',
  });
  const [code] = (await once(child, 'exit')) as [number | null];
  return { code, durationMs: Date.now() - started };
}

export async function waitFor<T>(probe: () => T | undefined, timeoutMs = 5_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = probe();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('condition not met in time');
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
