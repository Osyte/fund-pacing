import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync('.github/workflows/publish.yml', 'utf8')
const step = workflow.split('- name: Check npm trusted-publisher authentication')[1] ?? ''
const script = (step.match(/node --input-type=module <<'NODE'\n([\s\S]*?) {10}NODE/)?.[1] ?? '')
  .replace(/^ {10}/gm, '')
  .replace(/^import .+\n/gm, '')

interface Scenario {
  missing?: 'url' | 'token'
  identityStatus?: number
  identityToken?: unknown
  exchangeStatus?: number
  exchangeToken?: unknown
  networkError?: boolean
  malformedResponse?: 'identity' | 'exchange'
}

function check(scenario: Scenario = {}) {
  const requests: { url: URL; options: RequestInit }[] = []
  const output: string[] = []
  const promise = runInNewContext(`(async () => {${script}})()`, {
    assert,
    URL,
    AbortSignal,
    process: {
      env: {
        ACTIONS_ID_TOKEN_REQUEST_URL:
          scenario.missing === 'url' ? '' : 'https://github.example/oidc?existing=value',
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: scenario.missing === 'token' ? '' : 'github-secret',
        // A stale npm token must not be used as a fallback by this check.
        NODE_AUTH_TOKEN: 'stale-npm-secret',
      },
    },
    readFileSync: () => JSON.stringify({ name: '@osyte/fund-pacing' }),
    console: { log: (message: string) => output.push(message) },
    fetch: async (input: string | URL, options: RequestInit) => {
      requests.push({ url: new URL(input), options })
      if (scenario.networkError) throw new Error('Network unavailable')
      expect(requests.length).toBeLessThanOrEqual(2)
      const identity = requests.length === 1
      const status = (identity ? scenario.identityStatus : scenario.exchangeStatus) ?? 200
      return {
        ok: status === 200,
        status,
        json: async () => {
          // Rejected responses may contain sensitive diagnostics: do not read/log them.
          expect(status).toBe(200)
          if (scenario.malformedResponse === (identity ? 'identity' : 'exchange')) {
            throw new SyntaxError('Malformed response containing a secret')
          }
          return identity
            ? {
                value:
                  scenario.identityToken === undefined ? 'oidc-secret' : scenario.identityToken,
              }
            : {
                token: scenario.exchangeToken === undefined ? 'npm-secret' : scenario.exchangeToken,
              }
        },
      }
    },
  }) as Promise<void>
  return { promise, requests, output }
}

describe('npm trusted-publisher authentication', () => {
  it('checks the exact package using the npm OIDC audience without uploading or logging secrets', async () => {
    expect(script).not.toBe('')
    const result = check()
    await result.promise
    expect(result.requests).toHaveLength(2)
    const [identity, exchange] = result.requests
    expect(identity?.url.hostname).toBe('github.example')
    expect(identity?.url.searchParams.get('existing')).toBe('value')
    expect(identity?.url.searchParams.get('audience')).toBe('npm:registry.npmjs.org')
    expect(identity?.options.headers).toEqual({ Authorization: 'Bearer github-secret' })
    expect(exchange?.url.href).toBe(
      'https://registry.npmjs.org/-/npm/v1/oidc/token/exchange/package/%40osyte%2Ffund-pacing',
    )
    expect(exchange?.options.method).toBe('POST')
    expect(exchange?.options.headers).toEqual({ Authorization: 'Bearer oidc-secret' })
    for (const request of result.requests) {
      expect(request.options.redirect).toBe('error')
      expect(request.options.signal).toBeDefined()
    }
    expect(result.output.join('')).toContain('No package was uploaded')
    expect(result.output.join('')).toContain('first successful publish')
    expect(result.output.join('')).not.toContain('secret')
  })

  it.each(['url', 'token'] as const)(
    'rejects missing GitHub OIDC %s before making requests',
    async (missing) => {
      const result = check({ missing })
      await expect(result.promise).rejects.toThrow('id-token: write')
      expect(result.requests).toHaveLength(0)
      expect(result.output).toHaveLength(0)
    },
  )

  it('reports GitHub token failures separately from npm authorization', async () => {
    const result = check({ identityStatus: 403 })
    await expect(result.promise).rejects.toThrow('GitHub OIDC token request failed (HTTP 403)')
    expect(result.requests).toHaveLength(1)
  })

  it.each([null, '', 123])(
    'rejects a missing or malformed GitHub token: %j',
    async (identityToken) => {
      const result = check({ identityToken })
      await expect(result.promise).rejects.toThrow('GitHub returned no OIDC token')
      expect(result.requests).toHaveLength(1)
    },
  )

  it.each([401, 403, 404])(
    'explains npm rejection (HTTP %i) without swallowing the failure',
    async (exchangeStatus) => {
      const result = check({ exchangeStatus })
      await expect(result.promise).rejects.toThrow(`authentication (HTTP ${exchangeStatus})`)
      await expect(result.promise).rejects.toThrow('publish.yml')
      await expect(result.promise).rejects.toThrow('expire after two days')
      expect(result.output).toHaveLength(0)
    },
  )

  it.each([null, '', false])(
    'rejects an empty or malformed npm credential: %j',
    async (exchangeToken) => {
      const result = check({ exchangeToken })
      await expect(result.promise).rejects.toThrow('npm returned no publishing credential')
      expect(result.output).toHaveLength(0)
    },
  )

  it('fails on network errors rather than claiming authentication worked', async () => {
    const result = check({ networkError: true })
    await expect(result.promise).rejects.toThrow('Network unavailable')
    expect(result.output).toHaveLength(0)
  })

  it.each(['identity', 'exchange'] as const)(
    'does not expose malformed %s response bodies in errors',
    async (malformedResponse) => {
      const result = check({ malformedResponse })
      await expect(result.promise).rejects.toThrow(
        malformedResponse === 'identity'
          ? 'GitHub returned no OIDC token'
          : 'npm returned no publishing credential',
      )
      await expect(result.promise).rejects.not.toThrow('secret')
      expect(result.output).toHaveLength(0)
    },
  )
})
