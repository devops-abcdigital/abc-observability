// Fixture: a short-lived process (script, one-off job) that ends on its own once its work is done.
const { trace } = require('@opentelemetry/api');

const span = trace.getTracer('fixture').startSpan('job.fixture.run');
setTimeout(() => {
  span.end();
  process.stdout.write('job done\n');
}, 50);
