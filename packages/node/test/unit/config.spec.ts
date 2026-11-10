import { describe, expect, it } from 'vitest';

import { DEFAULT_IGNORED_PATHS, ignoredPaths, isIgnoredPath, isTracingEnabled } from '../../src/config';

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
