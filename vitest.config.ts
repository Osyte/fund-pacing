import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Spec invariant #7: identical inputs must produce byte-identical output
    // under Node and in a browser-like environment. The determinism suite runs
    // in both; everything else runs once, under Node.
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
