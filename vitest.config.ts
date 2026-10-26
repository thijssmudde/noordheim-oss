import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  // The app's `@/` imports, so tests can reach pure client modules too.
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: {
    // Hosted CPUs take longer to generate worlds and simulate complete battles.
    // Individual stress tests retain their explicit, longer timeouts.
    testTimeout: process.env.CI ? 30000 : 5000,
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    server: { deps: { inline: ['convex-test'] } },
  },
});
