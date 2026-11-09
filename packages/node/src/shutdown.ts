const SHUTDOWN_SIGNALS = ['SIGTERM', 'SIGINT'] as const;

/** Upper bound for flushing queued spans so a stopped container is never held up for long. */
export const SHUTDOWN_TIMEOUT_MS = 3000;

type Shutdown = () => Promise<void>;

function withTimeout(task: Promise<void>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref();
    task
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(timer);
        resolve();
      });
  });
}

/**
 * Flushes spans when the app stops, without changing how it exits.
 *
 * - The event loop runs dry (a script or job process finishing on its own): `beforeExit` flushes,
 *   and the process exits once the export is done. `process.exit()` skips this, as it skips all
 *   pending work.
 * - SIGTERM/SIGINT: adding a signal listener disables Node's default "terminate on signal"
 *   behaviour. After flushing, if the app registered no listener of its own for that signal, the
 *   library re-raises it so the process terminates exactly as it would without the library. If
 *   the app has its own handler (e.g. NestJS `enableShutdownHooks`), exiting is left to the app.
 */
export function installShutdownHooks(shutdown: Shutdown): void {
  process.once('beforeExit', () => {
    void withTimeout(shutdown(), SHUTDOWN_TIMEOUT_MS);
  });
  for (const signal of SHUTDOWN_SIGNALS) {
    process.once(signal, () => {
      void withTimeout(shutdown(), SHUTDOWN_TIMEOUT_MS).then(() => {
        if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
      });
    });
  }
}
