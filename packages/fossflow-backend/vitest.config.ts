import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // SWC instead of esbuild: Nest's DI needs emitted decorator metadata.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    env: { NODE_ENV: 'test' },
    testTimeout: 30_000,
    // Starting a Postgres container can take a while on a cold machine.
    hookTimeout: 180_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/test/**', 'src/live/testing/**', 'src/main.ts']
    }
  }
});
