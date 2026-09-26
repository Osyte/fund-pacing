import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/schema/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  treeshake: true,
  sourcemap: true,
  target: 'es2022',
  // zod is an optional peer — never bundled into the core entry point.
  external: ['zod'],
})
