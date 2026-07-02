import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    globals: true,
    // CLI integration tests shell out to `npx @almadar/orb` (execFileSync
    // timeout 30s) — the 5s vitest default is too tight under contention.
    testTimeout: 30_000,
  },
});
