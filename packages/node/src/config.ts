/**
 * Library-specific configuration. Standard `OTEL_*` variables (service name, sampler,
 * resource attributes, exporter options) are left to the OpenTelemetry SDK; this file only
 * decides whether tracing starts at all and which incoming paths are ignored.
 */

/** Health-check paths that would otherwise flood traces with one span every few seconds. */
export const DEFAULT_IGNORED_PATHS: readonly string[] = ['/health', '/api/v1/health'];

/** Comma-separated list of paths that replaces {@link DEFAULT_IGNORED_PATHS}. */
export const IGNORE_PATHS_ENV = 'ABC_OTEL_IGNORE_PATHS';

const ENDPOINT_ENVS = ['OTEL_EXPORTER_OTLP_ENDPOINT', 'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT'] as const;

type Env = Readonly<Record<string, string | undefined>>;

/** Tracing runs only when an OTLP endpoint is configured; otherwise the library stays fully inert. */
export function isTracingEnabled(env: Env = process.env): boolean {
  return ENDPOINT_ENVS.some((name) => (env[name] ?? '').trim() !== '');
}

export function ignoredPaths(env: Env = process.env): readonly string[] {
  const raw = env[IGNORE_PATHS_ENV];
  if (raw === undefined || raw.trim() === '') return DEFAULT_IGNORED_PATHS;
  return raw
    .split(',')
    .map((path) => path.trim())
    .filter((path) => path !== '');
}

/** Matches the request path exactly, ignoring the query string and a trailing slash. */
export function isIgnoredPath(url: string | undefined, paths: readonly string[]): boolean {
  if (url === undefined) return false;
  const pathname = url.split('?', 1)[0].replace(/(.)\/+$/, '$1');
  return paths.includes(pathname);
}
