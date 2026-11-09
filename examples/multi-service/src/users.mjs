// users: GET /users/:id. The id "broken" fails, so the error shows up in this service's span.
// Also runs a background cleanup job to show how jobs get their own `job.*` root span.
import { markSpanError, withSpan } from '@devops-abcdigital/observability-node';

import { createApp, errorHandler, listen } from './http.mjs';

const SERVICE = 'users';
const CLEANUP_INTERVAL_MS = Number(process.env.CLEANUP_INTERVAL_MS ?? 30_000);
const USERS = new Map([
  ['alice', { id: 'alice', name: 'Alice' }],
  ['bob', { id: 'bob', name: 'Bob' }],
]);

function findUser(id) {
  return withSpan(
    'users.find',
    async () => {
      // Stands in for a database call that fails for one specific record.
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (id === 'broken') throw new Error('user record is corrupted');
      return USERS.get(id) ?? { id, name: id };
    },
    { 'user.id': id },
  );
}

/**
 * Background job. Like many real jobs it catches its own errors and reports a result instead of
 * throwing, so it calls markSpanError() for the failure to reach the trace (and the Teams alert).
 */
function runCleanup({ fail = false } = {}) {
  return withSpan('job.example.cleanup', async (span) => {
    try {
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (fail) throw new Error('storage timeout');
      span.setAttribute('cleanup.removed', 3);
      return { ok: true };
    } catch (error) {
      const message = `cleanup failed: ${error.message}`;
      markSpanError(message);
      process.stderr.write(`[${SERVICE}] ${message}\n`);
      return { ok: false, error: message };
    }
  });
}

const app = createApp();

app.get('/users/:id', async (req, res, next) => {
  try {
    res.json(await findUser(req.params.id));
  } catch (error) {
    next(error);
  }
});

// Trigger the job on demand; `?fail=1` makes it fail (used to test job error alerts).
app.post('/jobs/cleanup', async (req, res) => {
  res.json(await runCleanup({ fail: req.query.fail === '1' }));
});

app.use(errorHandler(SERVICE));
listen(app, SERVICE, Number(process.env.PORT ?? 8082));

setInterval(() => void runCleanup(), CLEANUP_INTERVAL_MS).unref();
