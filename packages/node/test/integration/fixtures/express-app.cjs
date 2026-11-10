// Fixture app for integration tests. Started with `node --import <register> express-app.cjs`.
// It has no SIGTERM handler on purpose, like most apps that adopt the library.
const { trace } = require('@opentelemetry/api');
const express = require('express');

const app = express();

app.get('/a', async (_req, res) => {
  const { port } = server.address();
  const upstream = await fetch(`http://127.0.0.1:${port}/b`);
  res.status(upstream.status).send(`a -> ${await upstream.text()}`);
});

app.get('/b', (_req, res) => {
  res.send('b');
});

app.get('/health', (_req, res) => {
  res.send('ok');
});

// Reports whether a real SDK is installed (spans record) or the no-op API is in use.
app.get('/recording', (_req, res) => {
  const span = trace.getTracer('fixture').startSpan('probe');
  const recording = span.isRecording();
  span.end();
  res.json({ recording });
});

const server = app.listen(0, '127.0.0.1', () => {
  process.stdout.write(`listening ${server.address().port}\n`);
});
