import { once } from 'node:events';
import { createServer } from 'node:http';

import type { TeamsPayload } from '../../src/error-notifications/teams-card.builder';
import type { AddressInfo } from 'node:net';

export interface FakeWebhookOptions {
  /** HTTP status to answer with (default 202, what Teams Workflows returns). */
  status?: number;
  /** Never answer, to simulate a hanging webhook. */
  hang?: boolean;
}

/** Local HTTP server standing in for the Teams Workflows webhook; no real URL is ever used in tests. */
export async function startFakeWebhook(options: FakeWebhookOptions = {}) {
  const payloads: TeamsPayload[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      payloads.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as TeamsPayload);
      if (!options.hang) res.writeHead(options.status ?? 202).end();
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/workflows/webhook`,
    payloads,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export type FakeWebhook = Awaited<ReturnType<typeof startFakeWebhook>>;

/** Text of every TextBlock and fact in the card, for simple assertions. */
export function cardText(payload: TeamsPayload): string {
  return JSON.stringify(payload.attachments[0].content);
}

export function cardFacts(payload: TeamsPayload): Record<string, string> {
  const body = payload.attachments[0].content.body as { type: string; facts?: { title: string; value: string }[] }[];
  const factSet = body.find((block) => block.type === 'FactSet');
  return Object.fromEntries((factSet?.facts ?? []).map((fact) => [fact.title, fact.value]));
}

export function cardActionUrl(payload: TeamsPayload): string | undefined {
  const actions = payload.attachments[0].content.actions as { url: string }[] | undefined;
  return actions?.[0]?.url;
}
