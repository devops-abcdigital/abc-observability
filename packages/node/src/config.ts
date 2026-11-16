/**
 * Library-specific configuration. Standard `OTEL_*` variables (service name, sampler,
 * resource attributes, exporter options) are left to the OpenTelemetry SDK; this file only
 * decides whether tracing starts at all, which incoming paths are ignored, and how 500 errors
 * are reported to Teams.
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

/** Teams Workflows webhook URL. Unset means 500 error notifications are off. */
export const ALERT_WEBHOOK_URL_ENV = 'ABC_ALERT_TEAMS_WEBHOOK_URL';
/** Grafana base URL used to build the "Xem trace" link, e.g. `https://agf.abcdigital.io`. */
export const ALERT_GRAFANA_URL_ENV = 'ABC_ALERT_GRAFANA_URL';
/** UID of the Tempo datasource in that Grafana. */
export const ALERT_TEMPO_DATASOURCE_UID_ENV = 'ABC_ALERT_TEMPO_DATASOURCE_UID';
/** `false` leaves the (sanitized) error message out of the notification. */
export const ALERT_INCLUDE_MESSAGE_ENV = 'ABC_ALERT_INCLUDE_MESSAGE';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const ENVIRONMENT_ATTRIBUTES = ['deployment.environment.name', 'deployment.environment'];
const UNKNOWN_SERVICE = 'unknown_service';

export interface AlertConfig {
  webhookUrl: string;
  /** Present only when both the Grafana URL and the Tempo datasource UID are set. */
  traceLink?: { grafanaUrl: string; tempoDatasourceUid: string };
  includeMessage: boolean;
  service: string;
  environment?: string;
}

/** The webhook URL carries its own signature, so plain HTTP is only accepted for local test servers. */
function isAcceptedWebhookUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname));
  } catch {
    return false;
  }
}

function trimmed(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value === '' ? undefined : value;
}

/** Reads `deployment.environment(.name)` from `OTEL_RESOURCE_ATTRIBUTES` (display only, the SDK owns the rest). */
function environmentName(env: Env): string | undefined {
  const attributes = new Map<string, string>();
  for (const pair of (env.OTEL_RESOURCE_ATTRIBUTES ?? '').split(',')) {
    const separator = pair.indexOf('=');
    if (separator <= 0) continue;
    try {
      attributes.set(pair.slice(0, separator).trim(), decodeURIComponent(pair.slice(separator + 1).trim()));
    } catch {
      // A malformed percent-encoding only loses the environment label.
    }
  }
  return ENVIRONMENT_ATTRIBUTES.map((key) => attributes.get(key)).find((value) => value !== undefined && value !== '');
}

/**
 * Configuration for 500 error notifications, or `undefined` when they are off. An invalid webhook
 * URL also turns them off and is reported through `onInvalid` (without the URL, which is a secret).
 */
export function alertConfig(
  env: Env = process.env,
  onInvalid: (message: string) => void = () => undefined,
): AlertConfig | undefined {
  const webhookUrl = trimmed(env, ALERT_WEBHOOK_URL_ENV);
  if (webhookUrl === undefined) return undefined;
  if (!isAcceptedWebhookUrl(webhookUrl)) {
    onInvalid(`${ALERT_WEBHOOK_URL_ENV} must be an https URL, error notifications are off`);
    return undefined;
  }
  const grafanaUrl = trimmed(env, ALERT_GRAFANA_URL_ENV)?.replace(/\/+$/, '');
  const tempoDatasourceUid = trimmed(env, ALERT_TEMPO_DATASOURCE_UID_ENV);
  return {
    webhookUrl,
    traceLink: grafanaUrl && tempoDatasourceUid ? { grafanaUrl, tempoDatasourceUid } : undefined,
    includeMessage: trimmed(env, ALERT_INCLUDE_MESSAGE_ENV)?.toLowerCase() !== 'false',
    service: trimmed(env, 'OTEL_SERVICE_NAME') ?? UNKNOWN_SERVICE,
    environment: environmentName(env),
  };
}
