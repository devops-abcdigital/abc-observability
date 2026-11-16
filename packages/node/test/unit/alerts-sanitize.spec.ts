import { describe, expect, it } from 'vitest';

import { MAX_MESSAGE_LENGTH, sanitizeMessage } from '../../src/alerts/sanitize';

describe('sanitizeMessage', () => {
  it('drops credentials from URLs but keeps scheme and host', () => {
    expect(sanitizeMessage('connect failed: postgres://app:s3cret@db.internal:5432/main')).toBe(
      'connect failed: postgres://***@db.internal:5432/main',
    );
    expect(sanitizeMessage('GET https://user:p@ss@api.example.com/x')).toBe('GET https://***@api.example.com/x');
  });

  it('leaves e-mail addresses in query strings and plain URLs alone', () => {
    expect(sanitizeMessage('GET https://api.example.com/users?email=a@b.com')).toBe(
      'GET https://api.example.com/users?email=a@b.com',
    );
  });

  it('masks secret query values', () => {
    expect(
      sanitizeMessage('POST https://x.io/hook?api-version=1&sig=AbC123&sp=%2Ftriggers&token=t0k&access_token=zz'),
    ).toBe('POST https://x.io/hook?api-version=1&sig=***&sp=%2Ftriggers&token=***&access_token=***');
    expect(sanitizeMessage('https://maps.example.com/api?key=abc&password=hunter2&q=1')).toBe(
      'https://maps.example.com/api?key=***&password=***&q=1',
    );
  });

  it('masks bearer tokens and JWTs', () => {
    expect(sanitizeMessage('header Authorization: Bearer abc.def-123 rejected')).toBe(
      'header Authorization: Bearer *** rejected',
    );
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl';
    expect(sanitizeMessage(`invalid token ${jwt}`)).toBe('invalid token ***');
  });

  it('masks long hex and mixed-case base64 strings', () => {
    expect(sanitizeMessage('key 0123456789abcdef0123456789abcdef rejected')).toBe('key *** rejected');
    // Base64 of a made-up phrase: long, mixed case with digits, and shaped like no real provider's key.
    expect(sanitizeMessage('secret Qm9vdHN0cmFwS2V5Rm9yVGVzdHM2MDI0 leaked')).toBe('secret *** leaked');
  });

  it('keeps routes, UUIDs and long plain words readable', () => {
    const message = 'record 3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b missing at /api/v1/projects/dashboard/settings';
    expect(sanitizeMessage(message)).toBe(message);
    expect(sanitizeMessage('internationalizationconfigurationerror')).toBe('internationalizationconfigurationerror');
  });

  it('masks secrets in connection strings, config dumps, JSON and headers', () => {
    expect(sanitizeMessage('Server=db;User Id=app;Password=Hunter2!;Pwd=x9')).toBe(
      'Server=db;User Id=app;Password=***;Pwd=***',
    );
    expect(sanitizeMessage('bad grant client_secret=abc refresh_token=def')).toBe(
      'bad grant client_secret=*** refresh_token=***',
    );
    expect(sanitizeMessage('body {"user":"a","password":"p4ss","apiKey": "k"}')).toBe(
      'body {"user":"a","password":"***","apiKey": "***"}',
    );
    expect(sanitizeMessage('headers x-api-key: k-123, Authorization: Basic dXNlcjpwYXNz')).toBe(
      'headers x-api-key: ***, Authorization: Basic ***',
    );
  });

  it('stays fast on long hostile input, scanning only the first part', () => {
    for (const unit of ['a.', 'x-', 'a', 'eyJ.']) {
      const started = performance.now();
      const result = sanitizeMessage(unit.repeat(80_000));
      expect(performance.now() - started).toBeLessThan(100);
      expect(result.length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH);
    }
  });

  it(`cuts the result to ${MAX_MESSAGE_LENGTH} characters`, () => {
    const result = sanitizeMessage('a '.repeat(400));
    expect(result).toHaveLength(MAX_MESSAGE_LENGTH);
    expect(result.endsWith('…')).toBe(true);
    expect(sanitizeMessage('short')).toBe('short');
  });
});
