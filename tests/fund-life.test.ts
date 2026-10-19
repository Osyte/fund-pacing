import { describe, expect, it } from 'vitest'
import {
  buildSchedule,
  type Frequency,
  type ModelConfig,
  PacingConfigError,
  project,
  reproject,
  validateConfig,
} from '../src/index.js'
import { ModelConfigSchema } from '../src/schema/index.js'

const CONFIG: ModelConfig = {
  periodsPerYear: 4,
  fund_life: 1,
  growthRate: 0,
  yieldRate: 0,
  bowFactor: 2,
  callSchedule: { basis: 'commitment', rates: [0.25, 0.25, 0.25, 0.25] },
  terminalLiquidation: true,
  termExtensionYears: 1,
}
const FUND = { commitment: 10_000, startDate: '2024-01-15' }

describe('fund life in years', () => {
  it.each<[Frequency, number, number]>([
    [1, 10, 10],
    [2, 10, 20],
    [4, 10, 40],
    [4, 2.5, 10],
    [2, 2.5, 5],
    [4, 0.25, 1],
    [2, 0.5, 1],
  ])('derives %i periods/year × %s years = %i periods', (periodsPerYear, fund_life, count) => {
    const config: ModelConfig = {
      ...CONFIG,
      periodsPerYear,
      fund_life,
      callSchedule: { basis: 'commitment', rates: [1, ...Array(count - 1).fill(0)] },
    }
    expect(validateConfig(config)).toEqual({ ok: true })
    expect(ModelConfigSchema.safeParse(config).success).toBe(true)
    expect(buildSchedule(config)).toHaveLength(count)
    const rows = project(config, FUND)
    expect(rows).toHaveLength(count)
    expect(rows.at(-1)?.index).toBe(count - 1)
    expect(rows.at(-1)?.nav).toBe(0)
    const { baseline, revised } = reproject(config, FUND, [
      { date: FUND.startDate, type: 'call', amount: FUND.commitment },
    ])
    expect(baseline).toHaveLength(count)
    expect(revised).toHaveLength(count)
  })

  it.each([undefined, null, '1', 0, -1, Number.NaN, Infinity, 0.1, 1.1, 1e-300, 1e308])(
    'rejects invalid or partial-period fund life %s in core and schema',
    (fund_life) => {
      const input = { ...CONFIG, fund_life }
      const config = input as unknown as ModelConfig
      const result = validateConfig(config)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.issues).toContainEqual(
          expect.objectContaining({ path: 'fund_life', code: 'INVALID_FUND_LIFE' }),
        )
      }
      expect(ModelConfigSchema.safeParse(input).success).toBe(false)
      expect(() => buildSchedule(config)).toThrow(PacingConfigError)
      expect(() => project(config, FUND)).toThrow(PacingConfigError)
      expect(() => reproject(config, FUND)).toThrow(PacingConfigError)
    },
  )

  it('accepts a fractional year only when it aligns with the selected frequency', () => {
    for (const periodsPerYear of [1, 2] as const) {
      const config = { ...CONFIG, fund_life: 0.25, periodsPerYear }
      expect(validateConfig(config).ok).toBe(false)
      expect(ModelConfigSchema.safeParse(config).success).toBe(false)
    }
  })

  it('rejects unsafe integer period counts', () => {
    const config = { ...CONFIG, fund_life: Number.MAX_SAFE_INTEGER }
    expect(validateConfig(config).ok).toBe(false)
    expect(ModelConfigSchema.safeParse(config).success).toBe(false)
  })

  it('requires schedules to match the derived period count', () => {
    for (const [length, code] of [
      [3, 'SCHEDULE_TOO_SHORT'],
      [5, 'SCHEDULE_TOO_LONG'],
    ] as const) {
      const config = {
        ...CONFIG,
        callSchedule: { basis: 'commitment' as const, rates: [1, ...Array(length - 1).fill(0)] },
      }
      const result = validateConfig(config)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.issues).toContainEqual(
          expect.objectContaining({ path: 'callSchedule.rates', code }),
        )
      }
      expect(ModelConfigSchema.safeParse(config).success).toBe(false)
    }
  })

  it('does not accept the removed termPeriods field as a substitute', () => {
    const { fund_life: _removed, ...rest } = CONFIG
    const legacy = { ...rest, termPeriods: 4 }
    expect(validateConfig(legacy as unknown as ModelConfig).ok).toBe(false)
    expect(ModelConfigSchema.safeParse(legacy).success).toBe(false)
  })

  it('extends only the revised horizon when actuals exceed the derived fund term', () => {
    const config = {
      ...CONFIG,
      fund_life: 0.5,
      callSchedule: { basis: 'commitment' as const, rates: [0.5, 0.5] },
    }
    const { baseline, revised, variance, asOf } = reproject(config, FUND, [
      { date: '2024-09-30', type: 'nav', amount: 5000 },
    ])
    expect(baseline).toHaveLength(2)
    expect(baseline.at(-1)?.periodEnd).toBe('2024-06-30')
    expect(asOf).toBe('2024-09-30')
    expect(revised).toHaveLength(3 + 4)
    expect(revised.at(-1)?.periodEnd).toBe('2025-09-30')
    expect(variance).toHaveLength(2)
    // K9: extension rows retain their data but have no invented comparison.
    expect(revised[2]?.nav).toBe(5000)
    expect(variance.some((row) => row.index >= 2)).toBe(false)
    for (const row of variance) {
      expect(row.navDelta).toBe((revised[row.index]?.nav ?? 0) - (baseline[row.index]?.nav ?? 0))
    }
  })
})
