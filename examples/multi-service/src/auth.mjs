// auth: GET /token?id=<user> looks the user up in `users`, then signs a token.
import { createHash } from 'node:crypto';

import { withSpan } from '@devops-abcdigital/observability-node';

import { createApp, errorHandler, listen, requiredUrl } from './http.mjs';

const SERVICE = 'auth';
const USERS_URL = requiredUrl('USERS_URL');

const app = createApp();

app.get('/token', async (req, res, next) => {
  try {
    const id = String(req.query.id ?? '');
    const upstream = await fetch(`${USERS_URL}/users/${encodeURIComponent(id)}`);
    if (!upstream.ok) {
      res.status(502).json({ error: `users answered ${upstream.status}` });
      return;
    }
    const user = await upstream.json();
    const token = withSpan(
      'auth.sign-token',
      () => createHash('sha256').update(`${user.id}:${Date.now()}`).digest('hex'),
      {
        'user.id': user.id,
      },
    );
    res.json({ token, user });
  } catch (error) {
    next(error);
  }
});

app.use(errorHandler(SERVICE));
listen(app, SERVICE, Number(process.env.PORT ?? 8081));
