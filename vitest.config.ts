import path from 'node:path';
import { defineConfig } from 'vitest/config';

const rootResolve = (...segments: string[]): string => path.resolve(__dirname, ...segments);

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/rt-draw/**/*.ts', 'src/main/messageCatalog.ts'],
      thresholds: {
        statements: 85,
        lines: 85,
        functions: 85,
        branches: 70,
      },
    },
    clearMocks: true,
    mockReset: true,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
  },
  resolve: {
    alias: {
      '@src': rootResolve('src'),
      '@rt': rootResolve('src/rt-draw'),
      '@main': rootResolve('src/main'),
      '@preload': rootResolve('src/preload'),
      '@renderer': rootResolve('src/renderer'),
      '@shared': rootResolve('src/types'),
      '@tests': rootResolve('tests'),
    },
  },
});
