import { once } from 'node:events';

import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { teamsErrorNotifier } from '../../src';
import { resetNotifier, settleNotifications } from '../../src/error-notifications/notify';
import { cardText, startFakeWebhook } from './fake-webhook';

import type { FakeWebhook } from './fake-webhook';
import type { ErrorRequestHandler } from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

let webhook: FakeWebhook;
let server: Server | undefined;

beforeEach(async () => {
  resetNotifier();
  webhook = await startFakeWebhook();
  vi.stubEnv('ABC_ALERT_TEAMS_WEBHOOK_URL', webhook.url);
  vi.stubEnv('OTEL_SERVICE_NAME', 'express-app');
});

afterEach(async () => {
  resetNotifier();
  vi.unstubAllEnvs();
  if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
  server = undefined;
  await webhook.close();
});

function statusError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

/** App with a router mounted under /api, the notifier, and optionally the app's own final error handler. */
async function startApp(finalHandler?: ErrorRequestHandler): Promise<string> {
  const app = express();
  const router = express.Router();
  router.get('/users/:id', () => {
    throw new Error('user record is corrupted');
  });
  router.get('/async/:id', async () => {
    await Promise.resolve();
    throw new Error('async failure');
  });
  router.get('/missing', () => {
    throw statusError('no such thing', 404);
  });
  router.get('/bad', () => {
    throw Object.assign(new Error('invalid body'), { statusCode: 400 });
  });
  router.get('/odd-status', () => {
    // Express ignores error statuses outside 400-599 and answers 500.
    throw statusError('weird', 200);
  });
  router.get('/unavailable', (_req, res) => {
    res.status(503);
    throw new Error('maintenance');
  });
  app.use('/api', router);
  app.use(teamsErrorNotifier());
  if (finalHandler) app.use(finalHandler);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('teamsErrorNotifier', () => {
  it('reports a thrown error with the route pattern and keeps the app response', async () => {
    const baseUrl = await startApp((_error, _req, res, _next) => {
      res.status(500).json({ error: 'internal error' });
    });

    const response = await fetch(`${baseUrl}/api/users/42?x=1`);
    await settleNotifications();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'internal error' });
    expect(webhook.payloads).toHaveLength(1);
    expect(cardText(webhook.payloads[0])).toContain('🔴 500 · GET /api/users/:id · express-app');
  });

  it('leaves the default Express 500 response alone when the app has no error handler', async () => {
    const baseUrl = await startApp();

    const response = await fetch(`${baseUrl}/api/async/7`);
    await settleNotifications();

    expect(response.status).toBe(500);
    expect(webhook.payloads).toHaveLength(1);
    expect(cardText(webhook.payloads[0])).toContain('GET /api/async/:id');
  });

  it('ignores 4xx errors and keeps their status', async () => {
    const baseUrl = await startApp();

    const notFound = await fetch(`${baseUrl}/api/missing`);
    const badRequest = await fetch(`${baseUrl}/api/bad`);
    await settleNotifications();

    expect(notFound.status).toBe(404);
    expect(badRequest.status).toBe(400);
    expect(webhook.payloads).toHaveLength(0);
  });

  it('uses the status Express answers with: out-of-range error statuses become 500, the response status counts', async () => {
    const baseUrl = await startApp();

    const odd = await fetch(`${baseUrl}/api/odd-status`);
    const unavailable = await fetch(`${baseUrl}/api/unavailable`);
    await settleNotifications();

    expect(odd.status).toBe(500);
    expect(unavailable.status).toBe(503);
    expect(webhook.payloads.map((p) => /(\d{3}) · GET (\S+)/.exec(cardText(p))?.slice(1).join(' '))).toEqual([
      '500 /api/odd-status',
      '503 /api/unavailable',
    ]);
  });

  it('passes the error on even when reporting is off', async () => {
    vi.stubEnv('ABC_ALERT_TEAMS_WEBHOOK_URL', '');
    const baseUrl = await startApp((_error, _req, res, _next) => {
      res.status(500).send('handled');
    });

    const response = await fetch(`${baseUrl}/api/users/1`);

    expect(await response.text()).toBe('handled');
    expect(webhook.payloads).toHaveLength(0);
  });
});
