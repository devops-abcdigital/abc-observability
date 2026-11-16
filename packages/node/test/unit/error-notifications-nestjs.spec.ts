import 'reflect-metadata';

import {
  BadRequestException,
  Catch,
  Controller,
  Get,
  HttpException,
  InternalServerErrorException,
  Module,
  NotFoundException,
} from '@nestjs/common';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { notifyServerError, resetNotifier, settleNotifications } from '../../src/error-notifications/notify';
import { TeamsExceptionFilter } from '../../src/nestjs';
import { cardText, startFakeWebhook } from './fake-webhook';

import type { ServerErrorRequest } from '../../src';
import type { FakeWebhook } from './fake-webhook';
import type { ArgumentsHost, ExceptionFilter, INestApplication } from '@nestjs/common';
import type { Response } from 'express';

@Controller('projects')
class ProjectsController {
  @Get(':id')
  find(): never {
    throw new Error('too many clients already');
  }

  @Get(':id/missing')
  missing(): never {
    throw new NotFoundException();
  }

  @Get(':id/invalid')
  invalid(): never {
    throw new BadRequestException('id must be a number');
  }

  @Get(':id/upstream')
  upstream(): never {
    throw new InternalServerErrorException('upstream failed');
  }

  @Get(':id/upstream-404')
  upstream404(): never {
    // Like an AxiosError: Nest ignores `status` and answers 500.
    throw Object.assign(new Error('Request failed with status code 404'), { status: 404 });
  }

  @Get(':id/payload')
  payload(): never {
    // Shaped like a body-parser error: Nest answers with its statusCode, not 500.
    throw Object.assign(new Error('request entity too large'), { statusCode: 413, status: 413 });
  }
}

@Module({ controllers: [ProjectsController] })
class TestModule {}

/** Like awp-product-hub's HttpExceptionFilter: catches HttpException only and writes its own body. */
@Catch(HttpException)
class AppHttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly reportServerErrors = false) {}

  catch(exception: HttpException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const status = exception.getStatus();
    if (this.reportServerErrors && status >= 500) {
      notifyServerError({ error: exception, request: ctx.getRequest<ServerErrorRequest>(), statusCode: status });
    }
    ctx.getResponse<Response>().status(status).json({ statusCode: status, message: exception.message, code: 'APP' });
  }
}

let webhook: FakeWebhook;
let app: INestApplication | undefined;

beforeEach(async () => {
  resetNotifier();
  webhook = await startFakeWebhook();
  vi.stubEnv('ABC_ALERT_TEAMS_WEBHOOK_URL', webhook.url);
  vi.stubEnv('OTEL_SERVICE_NAME', 'nest-app');
});

afterEach(async () => {
  resetNotifier();
  vi.unstubAllEnvs();
  await app?.close();
  app = undefined;
  await webhook.close();
});

async function startNest(filters: (adapter: HttpAdapterHost['httpAdapter']) => ExceptionFilter[]): Promise<string> {
  app = await NestFactory.create(TestModule, { logger: false });
  app.useGlobalFilters(...filters(app.get(HttpAdapterHost).httpAdapter));
  await app.listen(0, '127.0.0.1');
  return app.getUrl();
}

async function get(baseUrl: string, path: string) {
  const response = await fetch(`${baseUrl}${path}`);
  return { status: response.status, body: (await response.json()) as unknown };
}

describe('TeamsExceptionFilter', () => {
  it('reports an unknown error with the route pattern and answers exactly like Nest does by default', async () => {
    const plainUrl = await startNest(() => []);
    const expected = await get(plainUrl, '/projects/42');
    await app?.close();

    const baseUrl = await startNest((adapter) => [new TeamsExceptionFilter(adapter)]);
    const actual = await get(baseUrl, '/projects/42');
    await settleNotifications();

    expect(actual).toEqual(expected);
    expect(actual.status).toBe(500);
    expect(webhook.payloads).toHaveLength(1);
    expect(cardText(webhook.payloads[0])).toContain('🔴 500 · GET /projects/:id · nest-app');
    expect(cardText(webhook.payloads[0])).toContain('too many clients already');
  });

  it('reports a 5xx HttpException and keeps its response', async () => {
    const baseUrl = await startNest((adapter) => [new TeamsExceptionFilter(adapter)]);

    const response = await get(baseUrl, '/projects/1/upstream');
    await settleNotifications();

    expect(response).toEqual({
      status: 500,
      body: { statusCode: 500, message: 'upstream failed', error: 'Internal Server Error' },
    });
    expect(cardText(webhook.payloads[0])).toContain('InternalServerErrorException');
  });

  it('ignores 4xx exceptions and errors that carry their own 4xx status', async () => {
    const baseUrl = await startNest((adapter) => [new TeamsExceptionFilter(adapter)]);

    expect((await get(baseUrl, '/projects/1/missing')).status).toBe(404);
    expect((await get(baseUrl, '/projects/1/invalid')).status).toBe(400);
    expect((await get(baseUrl, '/projects/1/payload')).status).toBe(413);
    await settleNotifications();

    expect(webhook.payloads).toHaveLength(0);
  });

  it('reports errors whose own `status` Nest ignores, such as an upstream 404 from axios', async () => {
    const baseUrl = await startNest((adapter) => [new TeamsExceptionFilter(adapter)]);

    const response = await get(baseUrl, '/projects/1/upstream-404');
    await settleNotifications();

    expect(response.status).toBe(500);
    expect(webhook.payloads).toHaveLength(1);
  });

  it('rethrows untouched outside HTTP (GraphQL, microservices) and reports nothing', () => {
    const filter = new TeamsExceptionFilter();
    const error = new Error('resolver failed');
    const host = { getType: () => 'graphql' } as unknown as ArgumentsHost;

    expect(() => filter.catch(error, host)).toThrow(error);
    expect(webhook.payloads).toHaveLength(0);
  });

  describe('next to an app filter that catches HttpException (awp-product-hub setup)', () => {
    const register = (reportServerErrors: boolean) => (adapter: HttpAdapterHost['httpAdapter']) => [
      new TeamsExceptionFilter(adapter),
      new AppHttpExceptionFilter(reportServerErrors),
    ];

    it('lets the app filter answer HttpExceptions, without a card for 4xx', async () => {
      const baseUrl = await startNest(register(false));

      const response = await get(baseUrl, '/projects/1/invalid');
      await settleNotifications();

      expect(response).toEqual({ status: 400, body: { statusCode: 400, message: 'id must be a number', code: 'APP' } });
      expect(webhook.payloads).toHaveLength(0);
    });

    it('still reports unknown errors through the Teams filter with the default 500 body', async () => {
      const baseUrl = await startNest(register(false));

      const response = await get(baseUrl, '/projects/42');
      await settleNotifications();

      expect(response).toEqual({ status: 500, body: { statusCode: 500, message: 'Internal server error' } });
      expect(webhook.payloads).toHaveLength(1);
    });

    it('reports 5xx HttpExceptions only when the app filter calls notifyServerError', async () => {
      const silentUrl = await startNest(register(false));
      await get(silentUrl, '/projects/1/upstream');
      await settleNotifications();
      expect(webhook.payloads).toHaveLength(0);
      await app?.close();

      const reportingUrl = await startNest(register(true));
      const response = await get(reportingUrl, '/projects/1/upstream');
      await settleNotifications();

      expect(response.body).toEqual({ statusCode: 500, message: 'upstream failed', code: 'APP' });
      expect(webhook.payloads).toHaveLength(1);
      expect(cardText(webhook.payloads[0])).toContain('GET /projects/:id/upstream');
    });
  });
});
