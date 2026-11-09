// gateway: public entry point. GET /login?id=<user> -> auth /token -> users /users/:id
import { withSpan } from '@devops-abcdigital/observability-node';

import { createApp, errorHandler, listen, requiredUrl } from './http.mjs';

const SERVICE = 'gateway';
const AUTH_URL = requiredUrl('AUTH_URL');

const app = createApp();

app.get('/login', async (req, res, next) => {
  try {
    const id = String(req.query.id ?? 'alice');
    const upstream = await fetch(`${AUTH_URL}/token?id=${encodeURIComponent(id)}`);
    if (!upstream.ok) {
      res.status(502).json({ error: `auth answered ${upstream.status}` });
      return;
    }
    const { token, user } = await upstream.json();
    const session = withSpan('gateway.create-session', () => ({ token, user, createdAt: new Date().toISOString() }), {
      'user.id': id,
    });
    res.json(session);
  } catch (error) {
    next(error);
  }
});

app.use(errorHandler(SERVICE));
listen(app, SERVICE, Number(process.env.PORT ?? 8080));
