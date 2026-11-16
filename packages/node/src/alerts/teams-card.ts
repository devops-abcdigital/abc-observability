import type { AlertConfig } from '../config';

/** One 500 error, already sanitized and ready to show. */
export interface ServerErrorEvent {
  service: string;
  environment?: string;
  method: string;
  route: string;
  statusCode: number;
  errorType: string;
  message?: string;
  occurredAt: Date;
  traceId?: string;
  traceUrl?: string;
}

/** Body Teams Workflows "Send webhook alerts to a chat" expects: a message with one Adaptive Card. */
export interface TeamsPayload {
  type: 'message';
  attachments: { contentType: 'application/vnd.microsoft.card.adaptive'; content: Record<string, unknown> }[];
}

/** Time either side of the error that the Grafana link searches, so the trace is found later too. */
const TRACE_LINK_MARGIN_MS = 30 * 60_000;

/** Grafana Explore link that opens one trace in the Tempo datasource. */
export function traceUrl(link: NonNullable<AlertConfig['traceLink']>, traceId: string, occurredAt: Date): string {
  const at = occurredAt.getTime();
  const panes = {
    trace: {
      datasource: link.tempoDatasourceUid,
      queries: [
        {
          refId: 'A',
          datasource: { type: 'tempo', uid: link.tempoDatasourceUid },
          queryType: 'traceql',
          query: traceId,
        },
      ],
      range: { from: String(at - TRACE_LINK_MARGIN_MS), to: String(at + TRACE_LINK_MARGIN_MS) },
    },
  };
  return `${link.grafanaUrl}/explore?schemaVersion=1&orgId=1&panes=${encodeURIComponent(JSON.stringify(panes))}`;
}

/**
 * Teams renders card text as markdown. Messages and unmatched paths can carry request input, so a
 * zero-width space keeps `[text](url)` from becoming a clickable link in the chat.
 */
function plain(text: string): string {
  return text.replace(/\]\(/g, ']​(');
}

function title(icon: string, event: ServerErrorEvent): string {
  const where = event.environment ? `${event.service} (${event.environment})` : event.service;
  return `${icon} ${event.statusCode} · ${event.method} ${plain(event.route)} · ${where}`;
}

/** Teams renders `{{DATE()}}`/`{{TIME()}}` in each reader's local time; it needs an ISO time without milliseconds. */
function localTime(date: Date): string {
  const iso = date.toISOString().replace(/\.\d{3}Z$/, 'Z');
  return `{{DATE(${iso}, SHORT)}} {{TIME(${iso})}}`;
}

function card(heading: string, subtitle: string, event: ServerErrorEvent): TeamsPayload {
  const facts = [
    { title: 'Loại lỗi', value: event.errorType },
    ...(event.message ? [{ title: 'Message', value: plain(event.message) }] : []),
    ...(event.traceId ? [{ title: 'trace_id', value: event.traceId }] : []),
  ];
  const content: Record<string, unknown> = {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    msteams: { width: 'Full' },
    body: [
      { type: 'TextBlock', text: heading, weight: 'Bolder', size: 'Medium', color: 'Attention', wrap: true },
      { type: 'TextBlock', text: subtitle, isSubtle: true, spacing: 'None', wrap: true },
      { type: 'FactSet', facts },
    ],
  };
  if (event.traceUrl) {
    content.actions = [{ type: 'Action.OpenUrl', title: 'Xem trace', url: event.traceUrl }];
  }
  return {
    type: 'message',
    attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content }],
  };
}

/** First notification for an error. */
export function errorCard(event: ServerErrorEvent): TeamsPayload {
  return card(title('🔴', event), localTime(event.occurredAt), event);
}

/** Summary after the dedupe window; `last` is the most recent repeat, so its trace link is the freshest. */
export function repeatCard(last: ServerErrorEvent, repeats: number, windowMs: number): TeamsPayload {
  const seconds = Math.round(windowMs / 1000);
  return card(
    title('🔁', last),
    `Lặp lại ${repeats} lần trong ${seconds} giây · lần cuối ${localTime(last.occurredAt)}`,
    last,
  );
}
