import { describe, expect, it } from 'vitest';

import { errorCard, repeatCard, traceUrl } from '../../src/alerts/teams-card';
import { cardActionUrl, cardFacts, cardText } from './fake-webhook';

import type { ServerErrorEvent } from '../../src/alerts/teams-card';

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const LINK = { grafanaUrl: 'https://grafana.example.com', tempoDatasourceUid: 'tempo-uid' };
const OCCURRED_AT = new Date('2026-11-16T05:45:12.345Z');

function event(overrides: Partial<ServerErrorEvent> = {}): ServerErrorEvent {
  return {
    service: 'awp-be',
    environment: 'staging',
    method: 'GET',
    route: '/api/v1/projects/:id',
    statusCode: 500,
    errorType: 'QueryFailedError',
    message: 'too many clients already',
    occurredAt: OCCURRED_AT,
    traceId: TRACE_ID,
    traceUrl: 'https://grafana.example.com/explore?x=1',
    ...overrides,
  };
}

describe('traceUrl', () => {
  it('opens the trace in the Tempo datasource around the error time', () => {
    const url = new URL(traceUrl(LINK, TRACE_ID, OCCURRED_AT));

    expect(`${url.origin}${url.pathname}`).toBe('https://grafana.example.com/explore');
    expect(url.searchParams.get('schemaVersion')).toBe('1');
    expect(url.searchParams.get('orgId')).toBe('1');
    const panes = JSON.parse(url.searchParams.get('panes') ?? '{}') as Record<
      string,
      { datasource: string; queries: { query: string; datasource: { uid: string } }[]; range: { from: string } }
    >;
    const pane = Object.values(panes)[0];
    expect(pane.datasource).toBe('tempo-uid');
    expect(pane.queries[0].query).toBe(TRACE_ID);
    expect(pane.queries[0].datasource.uid).toBe('tempo-uid');
    expect(Number(pane.range.from)).toBeLessThan(OCCURRED_AT.getTime());
  });
});

describe('errorCard', () => {
  it('builds the Workflows message with one Adaptive Card 1.4', () => {
    const payload = errorCard(event());

    expect(payload.type).toBe('message');
    expect(payload.attachments).toHaveLength(1);
    expect(payload.attachments[0].contentType).toBe('application/vnd.microsoft.card.adaptive');
    expect(payload.attachments[0].content).toMatchObject({ type: 'AdaptiveCard', version: '1.4' });
  });

  it('shows status, method, route, service, environment, error fields and the trace button', () => {
    const payload = errorCard(event());

    expect(cardText(payload)).toContain('🔴 500 · GET /api/v1/projects/:id · awp-be (staging)');
    expect(cardText(payload)).toContain('{{DATE(2026-11-16T05:45:12Z, SHORT)}} {{TIME(2026-11-16T05:45:12Z)}}');
    expect(cardFacts(payload)).toEqual({
      'Loại lỗi': 'QueryFailedError',
      Message: 'too many clients already',
      trace_id: TRACE_ID,
    });
    expect(cardActionUrl(payload)).toBe('https://grafana.example.com/explore?x=1');
  });

  it('omits the message, trace, button and environment when they are missing', () => {
    const payload = errorCard(
      event({ environment: undefined, message: undefined, traceId: undefined, traceUrl: undefined }),
    );

    expect(cardText(payload)).toContain('🔴 500 · GET /api/v1/projects/:id · awp-be"');
    expect(cardFacts(payload)).toEqual({ 'Loại lỗi': 'QueryFailedError' });
    expect(cardActionUrl(payload)).toBeUndefined();
  });
});

describe('repeatCard', () => {
  it('summarises the repeats with the last occurrence', () => {
    const payload = repeatCard(event(), 19, 60_000);

    expect(cardText(payload)).toContain('🔁 500 · GET /api/v1/projects/:id');
    expect(cardText(payload)).toContain('Lặp lại 19 lần trong 60 giây');
    expect(cardActionUrl(payload)).toBe('https://grafana.example.com/explore?x=1');
  });
});
