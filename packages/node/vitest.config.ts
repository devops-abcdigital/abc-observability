import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    testTimeout: 20_000,
    // Integration tests spawn real Node processes; keep them from competing for ports and CPU.
    fileParallelism: false,
  },
});
