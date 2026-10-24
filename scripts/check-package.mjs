import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { rolldown } from 'rolldown'

const root = process.cwd()
const temp = mkdtempSync(path.join(tmpdir(), 'fund-pacing-package-'))
function run(command, args, cwd = root) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: 120000,
    env: {
      ...process.env,
      NODE_PATH: '',
      npm_config_cache: process.env.npm_config_cache ?? path.join(temp, 'npm-cache'),
      // A publish dry run still needs a real local tarball and offline install.
      // Override inherited dry-run only for these verification subprocesses.
      npm_config_dry_run: 'false',
    },
  })
}
function tool(name, bin, args) {
  const folder = path.join(root, 'node_modules', name)
  const manifest = JSON.parse(readFileSync(path.join(folder, 'package.json'), 'utf8'))
  const relative = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin[bin]
  return run(process.execPath, [path.join(folder, relative), ...args])
}
try {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  // Keep build logs separate from npm pack's machine-readable JSON output.
  run(npm, ['run', 'prepack'])
  const [packed] = JSON.parse(
    run(npm, ['pack', '--json', '--ignore-scripts', '--pack-destination', temp]),
  )
  assert.ok(existsSync(path.join(temp, packed.filename)), 'npm pack did not create the tarball')
  const files = new Set(packed.files.map((file) => file.path))
  const expected = [
    'README.md',
    'LICENSE',
    'CHANGELOG.md',
    'CONTRIBUTING.md',
    'SECURITY.md',
    'package.json',
    'docs/installation.md',
    'docs/configuration.md',
    'docs/user-guide.md',
    'docs/results.md',
    'docs/validation.md',
    'docs/known_issues.md',
    'docs/library_spec.md',
    'docs/library_design.md',
    'dist/index.js',
    'dist/index.cjs',
    'dist/index.d.ts',
    'dist/index.d.cts',
    'dist/schema/index.js',
    'dist/schema/index.cjs',
    'dist/schema/index.d.ts',
    'dist/schema/index.d.cts',
  ]
  for (const file of expected) assert.ok(files.has(file), `Package is missing ${file}`)
  for (const file of files) {
    assert.ok(
      /^(dist\/|docs\/|README\.md$|LICENSE$|CHANGELOG\.md$|CONTRIBUTING\.md$|SECURITY\.md$|package\.json$)/.test(
        file,
      ),
      `Unexpected published file: ${file}`,
    )
    assert.ok(
      !/graphs\/|\.tgz$|\.env|\.test\./.test(file),
      `Unexpected private/test artifact: ${file}`,
    )
  }
  const consumer = path.join(temp, 'consumer')
  mkdirSync(consumer, { recursive: true })
  writeFileSync(
    path.join(consumer, 'package.json'),
    JSON.stringify({ private: true, type: 'module' }),
  )
  run(
    npm,
    [
      'install',
      '--offline',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      path.join(temp, packed.filename),
    ],
    consumer,
  )
  const installed = path.join(consumer, 'node_modules', '@osyte', 'fund-pacing')
  const manifest = JSON.parse(readFileSync(path.join(installed, 'package.json'), 'utf8'))
  assert.equal(
    manifest.version,
    JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version,
  )
  assert.equal(Object.keys(manifest.dependencies ?? {}).length, 0)
  assert.equal(manifest.engines.node, '>=22')
  assert.deepEqual(Object.keys(manifest.exports).sort(), ['.', './package.json', './schema'])
  assert.equal(manifest.peerDependenciesMeta.zod.optional, true)
  for (const hook of ['preinstall', 'install', 'postinstall', 'prepare']) {
    assert.ok(!manifest.scripts?.[hook], `Unexpected consumer install hook: ${hook}`)
  }

  const config = {
    fund_life: 1.25,
    periodsPerYear: 4,
    growthRate: 0,
    yieldRate: 0,
    bowFactor: 2,
    callSchedule: { basis: 'commitment', rates: [0.2, 0.2, 0.2, 0.2, 0.2] },
    terminalLiquidation: true,
  }
  const fund = { commitment: 3, startDate: '2024-01-15' }
  const exercise = `
    const config = ${JSON.stringify(config)}, fund = ${JSON.stringify(fund)};
    assert.equal(pacing.validateConfig(config).ok, true);
    assert.equal(pacing.buildSchedule(config).length, 5);
    const rows = pacing.project(config, fund);
    assert.equal(rows.at(-1).calledCumulative, 3);
    assert.ok(rows.every(row => row.called >= 0));
    assert.equal(rows.at(-1).nav, 0);
    assert.deepEqual(pacing.reproject(config, fund, []).revised, rows);
    const late = pacing.reproject(config, fund, [{date:'2025-06-15',type:'nav',amount:2}]);
    assert.equal(late.revised.length, 6);
    assert.equal(late.asOf, '2025-06-30');
    assert.equal(late.revised.at(-1).nav, 2);
    assert.equal(JSON.parse(JSON.stringify(rows)).length, 5);
    console.log(JSON.stringify(rows));`
  const esm = run(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import assert from 'node:assert/strict'; import * as pacing from '@osyte/fund-pacing'; ${exercise}`,
    ],
    consumer,
  ).trim()
  const cjs = run(
    process.execPath,
    [
      '--input-type=commonjs',
      '-e',
      `const assert = require('node:assert/strict'); const pacing = require('@osyte/fund-pacing'); ${exercise}`,
    ],
    consumer,
  ).trim()
  assert.equal(esm, cjs)
  run(
    process.execPath,
    [
      '--input-type=commonjs',
      '-e',
      `const assert=require('node:assert/strict'); assert.throws(()=>require.resolve('zod'),{code:'MODULE_NOT_FOUND'}); assert.throws(()=>require('@osyte/fund-pacing/schema'),{code:'MODULE_NOT_FOUND'});`,
    ],
    consumer,
  )

  const browserFile = path.join(consumer, 'browser.mjs')
  writeFileSync(
    browserFile,
    `import * as pacing from '@osyte/fund-pacing'; globalThis.result = pacing.project(${JSON.stringify(config)}, ${JSON.stringify(fund)});`,
  )
  const bundle = await rolldown({ input: browserFile, platform: 'browser' })
  try {
    const { output } = await bundle.generate({ format: 'iife' })
    const chunk = output.find((item) => item.type === 'chunk')
    assert.ok(chunk)
    assert.equal(chunk.imports.length, 0)
    const context = vm.createContext({
      Date: class {
        constructor() {
          throw new Error('Date must not be used')
        }
      },
    })
    vm.runInContext(chunk.code, context, { timeout: 10000 })
    assert.equal(JSON.stringify(context.result), esm)
  } finally {
    await bundle.close()
  }

  cpSync(path.join(root, 'node_modules', 'zod'), path.join(consumer, 'node_modules', 'zod'), {
    recursive: true,
  })
  for (const mode of ['module', 'commonjs']) {
    const imports =
      mode === 'module'
        ? `import assert from 'node:assert/strict'; import {ModelConfigSchema} from '@osyte/fund-pacing/schema'; import {project} from '@osyte/fund-pacing';`
        : `const assert=require('node:assert/strict'); const {ModelConfigSchema}=require('@osyte/fund-pacing/schema'); const {project}=require('@osyte/fund-pacing');`
    run(
      process.execPath,
      [
        `--input-type=${mode}`,
        '-e',
        `${imports} const config=ModelConfigSchema.parse(${JSON.stringify(config)}); assert.equal(project(config,${JSON.stringify(fund)}).length,5);`,
      ],
      consumer,
    )
  }
  for (const extension of ['mts', 'cts']) {
    writeFileSync(
      path.join(consumer, `types.${extension}`),
      `
      import {project, type ModelConfig, type CashFlowPeriod} from '@osyte/fund-pacing';
      import {ModelConfigSchema} from '@osyte/fund-pacing/schema';
      const config: ModelConfig = ModelConfigSchema.parse(${JSON.stringify(config)});
      const rows: readonly CashFlowPeriod[] = project(config, ${JSON.stringify(fund)});
      void rows;
      // @ts-expect-error Public projection rows are readonly.
      rows[0].nav = 0;
      // @ts-expect-error The public model requires fund_life.
      const legacy: ModelConfig = {periodsPerYear:4,termPeriods:5};
      void legacy;
    `,
    )
  }
  tool('typescript', 'tsc', [
    '--noEmit',
    '--strict',
    '--exactOptionalPropertyTypes',
    '--module',
    'NodeNext',
    '--moduleResolution',
    'NodeNext',
    '--target',
    'ES2022',
    path.join(consumer, 'types.mts'),
    path.join(consumer, 'types.cts'),
  ])
  process.stdout.write(tool('publint', 'publint', [installed]))
  process.stdout.write(
    tool('@arethetypeswrong/cli', 'attw', [
      path.join(temp, packed.filename),
      '--profile',
      'node16',
    ]),
  )
  assert.ok(existsSync(path.join(installed, 'LICENSE')))
  console.log(
    `Packed ${packed.name}@${packed.version}: ${packed.entryCount} files, ${packed.size} bytes compressed.`,
  )
  console.log(
    'Package checks passed: documented files, isolated ESM/CJS, optional Zod, strict TypeScript consumers, browser-targeted bundle, and package export checks.',
  )
} finally {
  rmSync(temp, { recursive: true, force: true })
}
