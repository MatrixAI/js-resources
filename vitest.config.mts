import babel, { defineRolldownBabelPreset } from '@rolldown/plugin-babel';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  cacheDir: './tmp/vitest',
  plugins: [
    babel({
      presets: [
        defineRolldownBabelPreset({
          preset: () => ({
            plugins: [
              ['@babel/plugin-proposal-decorators', { version: '2023-11' }],
            ],
          }),
          rolldown: { filter: { code: '@' } },
        }),
      ],
    }),
  ],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    typecheck: { enabled: true, include: ['tests/**/*.test-d.ts'] },
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
