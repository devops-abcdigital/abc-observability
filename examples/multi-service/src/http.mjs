// Small helpers shared by the three example services.
import express from 'express';

export function createApp() {
  const app = express();
  app.get('/health', (_req, res) => res.send('ok'));
  return app;
}

/** Final Express error handler: logs and answers 500, like most real services. */
export function errorHandler(serviceName) {
  // Express recognises error handlers by their four parameters.
  // eslint-disable-next-line no-unused-vars
  return (error, _req, res, _next) => {
    process.stderr.write(`[${serviceName}] ${error.message}\n`);
    res.status(500).json({ error: 'internal error' });
  };
}

export function listen(app, serviceName, port) {
  app.listen(port, () => process.stdout.write(`[${serviceName}] listening on ${port}\n`));
}

export function requiredUrl(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}
