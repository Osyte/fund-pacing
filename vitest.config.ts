import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Shared canonical snapshots cover Node and browser-like globals.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/types.ts'],
      reporter: ['text', 'json-summary', 'html'],
      thresholds: { statements: 95, branches: 90, functions: 100, lines: 95 },
    },
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: ['tests/determinism.test.ts'],
        },
      },
    ],
  },
})
