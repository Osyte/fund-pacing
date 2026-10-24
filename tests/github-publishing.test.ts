import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync('.github/workflows/publish-github.yml', 'utf8')
const scripts = [
  ...workflow.matchAll(/node --input-type=module <<'NODE'\n([\s\S]*?)          NODE/g),
].map((match) => (match[1] ?? '').replace(/^          /gm, '').replace(/^import .+\n/gm, ''))
const pkg = {
  name: '@osyte/fund-pacing',
  version: '1.0.1',
  repository: { url: 'git+https://github.com/Osyte/fund-pacing.git' },
}
const bytes = Buffer.from('synthetic npm tarball bytes')
const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`

interface Scenario {
  tag?: string
  head?: string
  onMain?: boolean
  lockVersion?: string
  npmStatus?: number
  npmCommit?: string
  npmVersion?: string
  tarballURL?: string
  downloadStatus?: number
  integrity?: string
  packedVersion?: string
}

function prepare(scenario: Scenario = {}) {
  const output: string[] = []
  const files: { filename: string; bytes: Buffer }[] = []
  let requests = 0
  const context = {
    assert,
    Buffer,
    URL,
    AbortSignal,
    path,
    createHash,
    process: {
      env: { RELEASE_TAG: scenario.tag ?? 'v1.0.1', RUNNER_TEMP: '/tmp', GITHUB_OUTPUT: '/output' },
    },
    console: { log: () => {} },
    readFileSync: (filename: string) =>
      JSON.stringify(
        filename === 'package.json'
          ? pkg
          : {
              version: scenario.lockVersion ?? pkg.version,
              packages: { '': { version: pkg.version } },
            },
      ),
    appendFileSync: (_filename: string, value: string) => output.push(value),
    writeFileSync: (filename: string, contents: Buffer) =>
      files.push({ filename, bytes: contents }),
    execFileSync: (command: string, args: string[], options?: { input?: Buffer }) => {
      if (command === 'tar') {
        expect(options?.input).toEqual(bytes)
        return JSON.stringify({ ...pkg, version: scenario.packedVersion ?? pkg.version })
      }
      expect(command).toBe('git')
      if (args[0] === 'merge-base') {
        if (scenario.onMain === false) throw new Error('Commit is not on main')
        return ''
      }
      return args[1] === 'HEAD' ? (scenario.head ?? 'release-commit') : 'release-commit'
    },
    fetch: async () => {
      requests++
      if (requests === 1)
        return {
          ok: (scenario.npmStatus ?? 200) === 200,
          status: scenario.npmStatus ?? 200,
          json: async () => ({
            ...pkg,
            version: scenario.npmVersion ?? pkg.version,
            gitHead: scenario.npmCommit ?? 'release-commit',
            dist: {
              tarball: scenario.tarballURL ?? 'https://registry.npmjs.org/fund-pacing.tgz',
              integrity: scenario.integrity ?? integrity,
            },
          }),
        }
      return {
        ok: (scenario.downloadStatus ?? 200) === 200,
        status: scenario.downloadStatus ?? 200,
        arrayBuffer: async () => bytes,
      }
    },
  }
  return {
    promise: runInNewContext(`(async () => {${scripts[0]}})()`, context) as Promise<void>,
    output,
    files,
  }
}

describe('GitHub Packages release guards', () => {
  it('verifies the npm artifact and passes the exact bytes to the publishing step', async () => {
    expect(scripts).toHaveLength(2)
    const result = prepare()
    await result.promise
    expect(result.files).toEqual([{ filename: '/tmp/fund-pacing-1.0.1.tgz', bytes }])
    expect(result.output.join('')).toContain(`integrity=${integrity}`)
    expect(result.output.join('')).toContain('version=1.0.1')
  })

  it.each<Scenario>([
    { tag: 'main' },
    { tag: 'v1.0.1-beta.1' },
    { tag: 'v2.0.0' },
    { head: 'different-commit' },
    { onMain: false },
    { lockVersion: '1.0.0' },
    { npmStatus: 404 },
    { npmStatus: 503 },
    { npmCommit: 'different-commit' },
    { npmVersion: '1.0.0' },
    { tarballURL: 'https://untrusted.example/package.tgz' },
    { downloadStatus: 500 },
    { integrity: 'sha512-corrupted' },
    { packedVersion: '1.0.0' },
  ])('rejects an invalid release before writing an upload artifact: %j', async (scenario) => {
    const result = prepare(scenario)
    await expect(result.promise).rejects.toThrow()
    expect(result.files).toHaveLength(0)
    expect(result.output).toHaveLength(0)
  })

  it.each([
    { status: 0, data: integrity, expected: 'published=true' },
    { status: 1, data: { error: { code: 'E404' } }, expected: 'published=false' },
    { status: 0, data: 'different-integrity', expected: null },
    { status: 1, data: { error: { code: 'E403' } }, expected: null },
    { status: 1, data: { error: { code: 'E401' } }, expected: null },
  ])(
    'handles an existing GitHub package or lookup error: %j',
    async ({ status, data, expected }) => {
      const output: string[] = []
      const promise = runInNewContext(`(async () => {${scripts[1]}})()`, {
        assert,
        process: { env: { VERSION: pkg.version, INTEGRITY: integrity, GITHUB_OUTPUT: '/output' } },
        console: { log: () => {} },
        appendFileSync: (_filename: string, value: string) => output.push(value),
        spawnSync: (command: string, args: string[]) => {
          expect(command).toBe('npm')
          expect(args).toContain('--registry=https://npm.pkg.github.com')
          return { status, stdout: JSON.stringify(data) }
        },
      }) as Promise<void>
      if (expected === null) {
        await expect(promise).rejects.toThrow()
        expect(output).toHaveLength(0)
      } else {
        await promise
        expect(output.join('')).toContain(expected)
      }
    },
  )
})
