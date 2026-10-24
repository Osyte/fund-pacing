import { describe, expect, it } from 'vitest'
import {
  buildSchedule,
  type ModelConfig,
  PacingConfigError,
  project,
  reproject,
  validateConfig,
} from '../src/index.js'
import { ModelConfigSchema } from '../src/schema/index.js'

const CONFIG = {
  periodsPerYear: 4,
  fund_life: 1,
  growthRate: 0.1,
  yieldRate: 0,
  bowFactor: 2,
  callSchedule: { basis: 'commitment', rates: [0.25, 0.25, 0.25, 0.25] },
  terminalLiquidation: true,
} satisfies ModelConfig
const FUND = { commitment: 10_000, startDate: '2024-01-15' }

describe('optional term extension (issue #22)', () => {
  it('accepts omission in all four functions and matches an explicit zero', () => {
    const explicitZero = { ...CONFIG, termExtensionYears: 0 }
    const actuals = [{ date: '2024-05-15', type: 'call' as const, amount: 1000 }]

    expect(validateConfig(CONFIG)).toEqual({ ok: true })
    expect(buildSchedule(CONFIG)).toEqual(buildSchedule(explicitZero))
    expect(project(CONFIG, FUND)).toEqual(project(explicitZero, FUND))
    expect(reproject(CONFIG, FUND)).toEqual(reproject(explicitZero, FUND))
    expect(reproject(CONFIG, FUND, actuals)).toEqual(reproject(explicitZero, FUND, actuals))
    expect(Object.hasOwn(CONFIG, 'termExtensionYears')).toBe(false)
  })

  it.each([1, 2, 4] as const)(
    'keeps late actuals without adding forecast periods when omitted at frequency %i',
    (periodsPerYear) => {
      const config: ModelConfig = {
        ...CONFIG,
        periodsPerYear,
        callSchedule: {
          basis: 'commitment',
          rates: Array(periodsPerYear).fill(1 / periodsPerYear),
        },
      }
      const actuals = [
        { date: '2025-02-15', type: 'call' as const, amount: 1000 },
        { date: '2025-02-15', type: 'nav' as const, amount: 900 },
      ]
      const result = reproject(config, FUND, actuals)
      expect(result).toEqual(reproject({ ...config, termExtensionYears: 0 }, FUND, actuals))
      expect(result.baseline).toHaveLength(periodsPerYear)
      expect(result.variance).toHaveLength(periodsPerYear)
      expect(result.revised).toHaveLength(periodsPerYear + 1)
      expect(result.revised.at(-1)).toMatchObject({ source: 'actual', called: 1000, nav: 900 })
      expect(result.asOf).toBe(result.revised.at(-1)?.periodEnd)

      // Explicit fractional extensions retain the existing frequency-dependent rounding.
      const extended = reproject({ ...config, termExtensionYears: 0.4 }, FUND, actuals)
      expect(extended.revised).toHaveLength(periodsPerYear + 1 + Math.round(0.4 * periodsPerYear))
      expect(extended.asOf).toBe(result.asOf)
      expect(extended.baseline).toEqual(result.baseline)
    },
  )

  it('keeps the final late period a forecast when NAV is modeled and extension is omitted', () => {
    const result = reproject(CONFIG, FUND, [{ date: '2025-02-15', type: 'call', amount: 1000 }])
    expect(result.revised).toHaveLength(5)
    expect(result.revised.at(-1)).toMatchObject({
      periodEnd: '2025-03-31',
      source: 'forecast',
      called: 1000,
      distributed: 0,
      nav: 1000,
    })
    expect(result.asOf).toBe('2025-03-31')
  })

  it('treats explicit undefined as omission in runtime inputs and schema output', () => {
    const input = { ...CONFIG, termExtensionYears: undefined, distributionSchedule: undefined }
    const runtimeConfig = input as unknown as ModelConfig
    expect(validateConfig(runtimeConfig)).toEqual({ ok: true })
    expect(project(runtimeConfig, FUND)).toEqual(project(CONFIG, FUND))
    const parsed: ModelConfig = ModelConfigSchema.parse(input)
    expect(Object.hasOwn(parsed, 'termExtensionYears')).toBe(false)
    expect(Object.hasOwn(parsed, 'distributionSchedule')).toBe(false)
    expect(parsed).toEqual(CONFIG)
    expect(project(parsed, FUND)).toEqual(project(CONFIG, FUND))
  })

  it.each([0, 0.4, 3])(
    'preserves a supplied extension of %s in schema output',
    (termExtensionYears) => {
      const input = { ...CONFIG, termExtensionYears }
      const parsed: ModelConfig = ModelConfigSchema.parse(input)
      expect(parsed.termExtensionYears).toBe(termExtensionYears)
      expect(validateConfig(parsed)).toEqual({ ok: true })
    },
  )

  it('parses a config with extension omitted directly into the core type', () => {
    const parsed: ModelConfig = ModelConfigSchema.parse(CONFIG)
    expect(Object.hasOwn(parsed, 'termExtensionYears')).toBe(false)
    expect(reproject(parsed, FUND)).toEqual(reproject(CONFIG, FUND))
  })

  it.each([-1, NaN, Infinity, -Infinity, null, '0', false, {}, []])(
    'rejects invalid supplied extension %j in validation, engines, and schema',
    (termExtensionYears) => {
      const input = { ...CONFIG, termExtensionYears }
      const config = input as unknown as ModelConfig
      const result = validateConfig(config)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.issues).toContainEqual(
          expect.objectContaining({ path: 'termExtensionYears', code: 'INVALID_TERM_EXTENSION' }),
        )
      }
      expect(ModelConfigSchema.safeParse(input).success).toBe(false)
      expect(() => buildSchedule(config)).toThrow(PacingConfigError)
      expect(() => project(config, FUND)).toThrow(PacingConfigError)
      expect(() => reproject(config, FUND)).toThrow(PacingConfigError)
    },
  )
})
