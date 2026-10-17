import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const require = createRequire(path.join(root, 'package.json'))
const ts = require('typescript')
const pages = [
  'README.md',
  'docs/configuration.md',
  'docs/user-guide.md',
  'docs/validation.md',
  'docs/installation.md',
]
const parsed = ts.getParsedCommandLineOfConfigFile(
  path.join(root, 'tsconfig.json'),
  {},
  { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
)
const options = {
  ...parsed.options,
  noUnusedLocals: false,
  noUnusedParameters: false,
  noEmit: true,
}
const exportsByPage = {
  'README.md': ['rows'],
  'docs/configuration.md': ['config', 'customDistributions'],
  'docs/user-guide.md': [
    'config',
    'curve',
    'earlierDistributions',
    'laterDistributions',
    'forecast',
    'result',
    'extended',
    'validation',
    'preStartTransactions',
  ],
  'docs/validation.md': ['validation', 'schemaValidation', 'parsedActuals'],
  'docs/installation.md': [],
}
let examples = 0
const outputs = {}
for (const page of pages) {
  const blocks = [
    ...fs.readFileSync(page, 'utf8').matchAll(/^[ \t]*```ts[^\n]*\n([\s\S]*?)^[ \t]*```/gm),
  ].map((m) => m[1])
  examples += blocks.length
  const code = blocks.join('\n\n')
  const virtualFile = path.join(root, `.docs-check-${path.basename(page)}.ts`)
  const host = ts.createCompilerHost(options),
    original = host.getSourceFile.bind(host)
  host.getSourceFile = (name, version, onError, create) =>
    name === virtualFile
      ? ts.createSourceFile(name, code, version, true)
      : original(name, version, onError, create)
  const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([virtualFile], options, host))
  if (diagnostics.length)
    throw Error(
      ts.formatDiagnostics(diagnostics, {
        getCanonicalFileName: (f) => f,
        getCurrentDirectory: () => root,
        getNewLine: () => '\n',
      }),
    )
  let js = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText
  for (const [name, local] of [
    ['@osyte/fund-pacing/schema', 'dist/schema/index.js'],
    ['@osyte/fund-pacing', 'dist/index.js'],
  ])
    js = js.replaceAll(`'${name}'`, JSON.stringify(pathToFileURL(path.join(root, local)).href))
  js =
    'const console = {log: (...args) => {}};\n' +
    js +
    `\nexport { ${exportsByPage[page].join(', ')} };`
  outputs[page] = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
  console.log(`Typechecked and executed ${page}: ${blocks.length} TypeScript examples.`)
}
const readme = outputs['README.md']
assert.equal(readme.rows.length, 16)
assert.equal(readme.rows[0].called, 250000000)
assert.equal(readme.rows[0].periodEnd, '2024-03-31')
const guide = outputs['docs/user-guide.md']
assert.equal(guide.curve[0].calledFraction, 0.25)
assert.ok(
  guide.earlierDistributions[7].distributedFraction >
    guide.laterDistributions[7].distributedFraction,
)
assert.equal(guide.forecast.length, 16)
assert.equal(guide.forecast[0].source, 'forecast')
assert.equal(guide.forecast.at(-1).nav, 0)
assert.equal(guide.result.asOf, '2024-06-30')
assert.equal(guide.result.revised[1].nav, 360000000)
assert.equal(guide.result.revised[2].called, 325000000)
assert.equal(guide.result.revised[2].source, 'forecast')
assert.deepEqual(
  [guide.extended.baseline.length, guide.extended.revised.length, guide.extended.variance.length],
  [16, 29, 16],
)
assert.equal(guide.validation.issues[0].code, 'INVALID_FUND_LIFE')
assert.equal(guide.preStartTransactions.length, 0)
const { validateConfig } = await import(pathToFileURL(path.join(root, 'dist/index.js')).href)
assert.equal(validateConfig(outputs['docs/configuration.md'].customDistributions).ok, true)
assert.equal(outputs['docs/validation.md'].schemaValidation.success, false)
const installJS = [
  ...fs
    .readFileSync('docs/installation.md', 'utf8')
    .matchAll(/^[ \t]*```js[^\n]*\n([\s\S]*?)^[ \t]*```/gm),
].map((m) => m[1])
for (const block of installJS) {
  if (block.includes('require(')) Function('require', 'console', block)(require, { log: () => {} })
  else {
    const js = block.replaceAll(
      "'@osyte/fund-pacing'",
      JSON.stringify(pathToFileURL(path.join(root, 'dist/index.js')).href),
    )
    await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
  }
}
console.log(
  `Verified ${examples} TypeScript examples, both JavaScript import styles, and the documented curve/cash-flow/extension results.`,
)

const markdownFiles = []
function collect(folder) {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const full = path.join(folder, entry.name)
    if (entry.isDirectory()) collect(full)
    else if (entry.name.endsWith('.md')) markdownFiles.push(full)
  }
}
for (const name of fs.readdirSync(root))
  if (name.endsWith('.md')) markdownFiles.push(path.join(root, name))
for (const folder of ['docs', 'fixtures', '.github']) collect(path.join(root, folder))
let links = 0
for (const file of markdownFiles) {
  const source = fs.readFileSync(file, 'utf8')
  for (const match of source.matchAll(/(?<!!)\[[^\]\n]*\]\(([^)]+)\)/g)) {
    const target = match[1].trim().replace(/^<|>$/g, '')
    if (/^[a-z][a-z\d+.-]*:/i.test(target)) continue
    const [relative, anchor] = target.split('#')
    const destination = relative ? path.resolve(path.dirname(file), relative) : file
    assert.ok(fs.existsSync(destination), `Missing link in ${file}: ${target}`)
    if (anchor && destination.endsWith('.md')) {
      const headings = [...fs.readFileSync(destination, 'utf8').matchAll(/^#{1,6}\s+(.+)$/gm)].map(
        (item) =>
          item[1]
            .toLowerCase()
            .replace(/[^\p{L}\p{N}_ -]/gu, '')
            .replaceAll(' ', '-'),
      )
      assert.ok(headings.includes(anchor), `Missing anchor in ${file}: ${target}`)
    }
    links++
  }
}
console.log(`Verified ${links} local documentation links and anchors.`)
