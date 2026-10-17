import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  buildSchedule,
  type FundTerms,
  type ModelConfig,
  PacingConfigError,
  PacingInputError,
  project,
  reproject,
  type Transaction,
  validateConfig,
} from '../src/index.js'
import { allocate, noRound, roundMinor } from '../src/internal/money.js'
import { ModelConfigSchema } from '../src/schema/index.js'

const CONFIG: ModelConfig = {
  fund_life: 1.25,
  periodsPerYear: 4,
  growthRate: 0,
  yieldRate: 0,
  bowFactor: 2,
  callSchedule: { basis: 'commitment', rates: [0.2, 0.2, 0.2, 0.2, 0.2] },
  distributionSchedule: { basis: 'nav', rates: [0, 0, 0, 0, 0] },
  terminalLiquidation: false,
  termExtensionYears: 0,
}
const FUND = { commitment: 10000, startDate: '2024-01-15' }

describe('release regression: monetary allocation', () => {
  it('never creates negative calls for a three-cent commitment split over five periods', () => {
    const rows = project(CONFIG, { ...FUND, commitment: 3 })
    expect(rows.map((row) => row.called)).toEqual([1, 1, 1, 0, 0])
    expect(rows.at(-1)?.calledCumulative).toBe(3)
  })
  it('preserves exact nonnegative integer allocations for tiny and maximum-safe totals', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.integer({ min: 0, max: 1000 }), fc.constant(Number.MAX_SAFE_INTEGER)),
        fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 1, maxLength: 60 }),
        (total, weights) => {
          fc.pre(weights.some((weight) => weight > 0))
          const parts = allocate(total, weights)
          expect(parts.reduce((sum, part) => sum + part, 0)).toBe(total)
          parts.forEach((part, i) => {
            expect(Number.isSafeInteger(part)).toBe(true)
            expect(part).toBeGreaterThanOrEqual(0)
            if (weights[i] === 0) expect(part).toBe(0)
          })
        },
      ),
      { numRuns: 1000 },
    )
  })
  it('calls exactly commitment for every accepted near-100% schedule', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10000000000 }),
        fc.constantFrom(-5e-10, 0, 5e-10),
        (commitment, delta) => {
          const config = {
            ...CONFIG,
            fund_life: 0.5,
            callSchedule: { basis: 'commitment' as const, rates: [0.5, 0.5 + delta] },
          }
          expect(validateConfig(config).ok).toBe(true)
          expect(project(config, { ...FUND, commitment }).at(-1)?.calledCumulative).toBe(commitment)
        },
      ),
      { numRuns: 300 },
    )
  })
  it('keeps calls nonnegative when actuals leave a tiny amount to allocate', () => {
    const config = {
      ...CONFIG,
      fund_life: 1.5,
      callSchedule: { basis: 'commitment' as const, rates: Array(6).fill(1 / 6) },
    }
    const { revised } = reproject(config, { ...FUND, commitment: 100 }, [
      { date: '2024-03-31', type: 'call', amount: 97 },
    ])
    expect(revised.at(-1)?.calledCumulative).toBe(100)
    expect(revised.every((row) => row.called >= 0)).toBe(true)
  })
  it('rejects fractional cumulative overflow even when each individual period remains finite', () => {
    const periods = 700
    const config: ModelConfig = {
      ...CONFIG,
      fund_life: periods,
      periodsPerYear: 1,
      growthRate: 2,
      callSchedule: {
        basis: 'commitment',
        rates: Array.from({ length: periods }, (_, i) => (i === 0 ? 1 : 0)),
      },
      distributionSchedule: {
        basis: 'nav',
        rates: Array.from({ length: periods }, (_, i) => (i < 644 ? 0 : 2 / 3)),
      },
    }
    expect(() => buildSchedule(config)).toThrow(
      expect.objectContaining({ code: 'NUMERIC_OVERFLOW' }),
    )
  })
  it('rejects non-finite and unsafe monetary arithmetic instead of returning corrupt JSON', () => {
    expect(() => roundMinor(Number.MAX_SAFE_INTEGER + 1)).toThrow(PacingInputError)
    expect(() => noRound(Infinity)).toThrow(PacingInputError)
    const config = { ...CONFIG, growthRate: 1e308 }
    expect(() => project(config, FUND)).toThrow(
      expect.objectContaining({ code: 'NUMERIC_OVERFLOW' }),
    )
    expect(() => buildSchedule({ ...config, periodsPerYear: 1, fund_life: 5 })).toThrow(
      expect.objectContaining({ code: 'NUMERIC_OVERFLOW' }),
    )
    expect(() =>
      reproject(CONFIG, FUND, [
        { date: '2024-03-31', type: 'call', amount: Number.MAX_SAFE_INTEGER },
        { date: '2024-06-30', type: 'call', amount: 1 },
      ]),
    ).toThrow(expect.objectContaining({ code: 'NUMERIC_OVERFLOW' }))
  })
})

describe('release regression: runtime input boundaries', () => {
  it('rejects sparse schedules and sparse transaction arrays', () => {
    for (const field of ['callSchedule', 'distributionSchedule'] as const) {
      const config = {
        ...CONFIG,
        [field]: { basis: field === 'callSchedule' ? 'unfunded' : 'nav', rates: Array(5) },
      } as ModelConfig
      const result = validateConfig(config)
      expect(result.ok).toBe(false)
      if (!result.ok)
        expect(result.issues).toContainEqual(
          expect.objectContaining({ path: `${field}.rates[0]`, code: 'INVALID_RATE' }),
        )
      expect(() => project(config, FUND)).toThrow(PacingConfigError)
    }
    expect(() => reproject(CONFIG, FUND, Array(1))).toThrow(PacingInputError)
  })
  it.each([null, undefined, [], 42])(
    'rejects malformed fund terms %s with a library error',
    (fund) => {
      expect(() => project(CONFIG, fund as unknown as FundTerms)).toThrow(PacingInputError)
    },
  )
  it.each([null, {}, 42, 'history'])(
    'rejects non-array actuals %s with a library error',
    (actuals) => {
      expect(() => reproject(CONFIG, FUND, actuals as unknown as Transaction[])).toThrow(
        PacingInputError,
      )
    },
  )
  it.each([
    null,
    {},
    [],
    { type: Symbol('call'), date: '2024-01-01', amount: 1 },
    { type: 'call', date: '2024-01-01', amount: Number.MAX_SAFE_INTEGER + 1 },
  ])('rejects malformed transactions %s', (transaction) => {
    expect(() => reproject(CONFIG, FUND, [transaction] as Transaction[])).toThrow(PacingInputError)
  })
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid commitment %s',
    (commitment) => {
      expect(() => project(CONFIG, { ...FUND, commitment })).toThrow(PacingInputError)
    },
  )
  it('rejects non-string dates without coercion and prevents output dates beyond year 9999', () => {
    for (const startDate of [Symbol('date'), { toString: () => '2024-01-01' }, 20240101]) {
      expect(() => project(CONFIG, { ...FUND, startDate } as unknown as FundTerms)).toThrow(
        PacingInputError,
      )
    }
    expect(() => project(CONFIG, { ...FUND, startDate: '9999-12-31' })).toThrow(
      expect.objectContaining({ code: 'DATE_RANGE_EXCEEDED' }),
    )
  })
  it('returns useful issues for invalid scalar and schedule shapes', () => {
    const cases = [
      { periodsPerYear: 12 },
      { growthRate: NaN },
      { growthRate: -1 },
      { yieldRate: NaN },
      { yieldRate: -1 },
      { bowFactor: 0 },
      { terminalLiquidation: 'yes' },
      { termExtensionYears: -1 },
      { termExtensionYears: NaN },
      { callSchedule: { basis: 'other', rates: 'bad' } },
      { callSchedule: { basis: 'unfunded', rates: [NaN, 0, 0, 0, 0] } },
      { distributionSchedule: { basis: 'commitment', rates: [1, 1] } },
    ]
    for (const change of cases)
      expect(validateConfig({ ...CONFIG, ...change } as ModelConfig).ok).toBe(false)
  })
  it('produces schema output directly assignable to the core config with optional fields omitted', () => {
    const { distributionSchedule: _removed, ...input } = CONFIG
    const parsed: ModelConfig = ModelConfigSchema.parse({
      ...input,
      distributionSchedule: undefined,
    })
    expect(Object.hasOwn(parsed, 'distributionSchedule')).toBe(false)
    expect(() => project(parsed, FUND)).not.toThrow()
    expect(ModelConfigSchema.parse(CONFIG).distributionSchedule).toEqual(
      CONFIG.distributionSchedule,
    )
  })
  it('does not mutate frozen configurations, fund terms, or actuals', () => {
    const config = Object.freeze({
      ...CONFIG,
      callSchedule: Object.freeze({
        ...CONFIG.callSchedule,
        rates: Object.freeze([...CONFIG.callSchedule.rates]),
      }),
    })
    const fund = Object.freeze({ ...FUND })
    const actuals = Object.freeze([
      Object.freeze({ date: '2024-03-31', type: 'call' as const, amount: 1000 }),
    ])
    expect(() => buildSchedule(config)).not.toThrow()
    expect(() => project(config, fund)).not.toThrow()
    expect(() => reproject(config, fund, actuals)).not.toThrow()
  })
})
