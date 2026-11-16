import { describe, expect, it } from 'vitest';

import { alertConfig, DEFAULT_IGNORED_PATHS, ignoredPaths, isIgnoredPath, isTracingEnabled } from '../../src/config';

describe('isTracingEnabled', () => {
  it('is off when no OTLP endpoint is set', () => {
    expect(isTracingEnabled({})).toBe(false);
  });

  it('is off when the endpoint is blank', () => {
    expect(isTracingEnabled({ OTEL_EXPORTER_OTLP_ENDPOINT: '  ' })).toBe(false);
  });

  it('is on with the generic endpoint', () => {
    expect(isTracingEnabled({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318' })).toBe(true);
  });

  it('is on with the traces-only endpoint', () => {
    expect(isTracingEnabled({ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://localhost:4318/v1/traces' })).toBe(true);
  });
});

describe('ignoredPaths', () => {
  it('defaults to the health check paths', () => {
    expect(ignoredPaths({})).toEqual(DEFAULT_IGNORED_PATHS);
    expect(ignoredPaths({ ABC_OTEL_IGNORE_PATHS: ' ' })).toEqual(DEFAULT_IGNORED_PATHS);
  });

  it('replaces the defaults with a trimmed comma-separated list', () => {
    expect(ignoredPaths({ ABC_OTEL_IGNORE_PATHS: ' /ping, /ready ,,' })).toEqual(['/ping', '/ready']);
  });
});

describe('isIgnoredPath', () => {
  const paths = ['/health', '/api/v1/health'];

  it('matches exact paths, ignoring query string and trailing slash', () => {
    expect(isIgnoredPath('/health', paths)).toBe(true);
    expect(isIgnoredPath('/api/v1/health?probe=1', paths)).toBe(true);
    expect(isIgnoredPath('/health/', paths)).toBe(true);
  });

  it('does not match other paths or prefixes', () => {
    expect(isIgnoredPath('/healthcheck', paths)).toBe(false);
    expect(isIgnoredPath('/api/v1/health/db', paths)).toBe(false);
    expect(isIgnoredPath('/', paths)).toBe(false);
    expect(isIgnoredPath(undefined, paths)).toBe(false);
  });
});

describe('alertConfig', () => {
  const WEBHOOK = 'https://prod.westus.logic.azure.com/workflows/abc/triggers/manual/paths/invoke?sig=xyz';

  it('is off without a webhook URL', () => {
    expect(alertConfig({})).toBeUndefined();
    expect(alertConfig({ ABC_ALERT_TEAMS_WEBHOOK_URL: ' ' })).toBeUndefined();
  });

  it('reads the webhook, trace link settings, service and environment', () => {
    expect(
      alertConfig({
        ABC_ALERT_TEAMS_WEBHOOK_URL: WEBHOOK,
        ABC_ALERT_GRAFANA_URL: 'https://agf.example.com/',
        ABC_ALERT_TEMPO_DATASOURCE_UID: 'tempo-uid',
        OTEL_SERVICE_NAME: 'awp-be',
        OTEL_RESOURCE_ATTRIBUTES: 'team=awp,deployment.environment=staging',
      }),
    ).toEqual({
      webhookUrl: WEBHOOK,
      traceLink: { grafanaUrl: 'https://agf.example.com', tempoDatasourceUid: 'tempo-uid' },
      includeMessage: true,
      service: 'awp-be',
      environment: 'staging',
    });
  });

  it('has no trace link unless both Grafana URL and Tempo UID are set', () => {
    expect(alertConfig({ ABC_ALERT_TEAMS_WEBHOOK_URL: WEBHOOK, ABC_ALERT_GRAFANA_URL: 'https://g' })?.traceLink).toBe(
      undefined,
    );
  });

  it('prefers deployment.environment.name, decodes values and defaults the service name', () => {
    const config = alertConfig({
      ABC_ALERT_TEAMS_WEBHOOK_URL: WEBHOOK,
      OTEL_RESOURCE_ATTRIBUTES: 'deployment.environment=old,deployment.environment.name=prod%20eu',
    });
    expect(config?.environment).toBe('prod eu');
    expect(config?.service).toBe('unknown_service');
    expect(alertConfig({ ABC_ALERT_TEAMS_WEBHOOK_URL: WEBHOOK })?.environment).toBeUndefined();
  });

  it('leaves the message out only for ABC_ALERT_INCLUDE_MESSAGE=false', () => {
    expect(
      alertConfig({ ABC_ALERT_TEAMS_WEBHOOK_URL: WEBHOOK, ABC_ALERT_INCLUDE_MESSAGE: 'FALSE' })?.includeMessage,
    ).toBe(false);
    expect(alertConfig({ ABC_ALERT_TEAMS_WEBHOOK_URL: WEBHOOK, ABC_ALERT_INCLUDE_MESSAGE: 'no' })?.includeMessage).toBe(
      true,
    );
  });

  it('rejects non-https URLs except loopback test servers, without echoing the URL', () => {
    const problems: string[] = [];
    const onInvalid = (message: string) => problems.push(message);

    expect(alertConfig({ ABC_ALERT_TEAMS_WEBHOOK_URL: 'http://teams.example.com/x?sig=s3' }, onInvalid)).toBe(
      undefined,
    );
    expect(alertConfig({ ABC_ALERT_TEAMS_WEBHOOK_URL: 'not a url' }, onInvalid)).toBeUndefined();
    expect(alertConfig({ ABC_ALERT_TEAMS_WEBHOOK_URL: 'http://127.0.0.1:9999/hook' }, onInvalid)).toBeDefined();
    expect(problems).toHaveLength(2);
    expect(problems.join()).not.toContain('s3');
  });
});
