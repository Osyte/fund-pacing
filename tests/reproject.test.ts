import { describe, expect, it } from 'vitest'
import { type ModelConfig, project, reproject, validateConfig } from '../src/index.js'

const CONFIG: ModelConfig = {
  periodsPerYear: 4,
  termPeriods: 20,
  growthRate: 0.15,
  yieldRate: 0,
  bowFactor: 2.5,
  callSchedule: {
    basis: 'unfunded',
    rates: [0.25, 0.25, 0.25, 0.25, 0.2, 0.2, 0.2, 0.2, ...Array(12).fill(0)],
  },
  terminalLiquidation: true,
  termExtensionYears: 3,
}

const FUND = { commitment: 5_000_000_00, startDate: '2024-01-15' }

describe('reproject', () => {
  it('marks periods up to the last transaction as actual', () => {
    const { revised, asOf } = reproject(CONFIG, FUND, [
      { date: '2024-03-31', type: 'call', amount: 1_000_000_00 },
      { date: '2024-09-30', type: 'call', amount: 500_000_00 },
    ])
    // startDate 2024-01-15 puts period 0 at 2024-03-31, so the last
    // transaction (2024-09-30) lands at index 2.
    expect(asOf).toBe('2024-09-30')
    expect(revised.filter((p) => p.source === 'actual')).toHaveLength(3) // indices 0..2
    expect(revised[2]?.source).toBe('actual')
    expect(revised[3]?.source).toBe('forecast')
  })

  it('resumes the rate schedule at fund age, not index 0 (spec D2)', () => {
    const actuals = [{ date: '2024-12-31', type: 'call' as const, amount: 1_000_000_00 }]
    const { revised } = reproject(CONFIG, FUND, actuals)

    // Actuals end at index 3, so the next forecast period is 4 and must use
    // rates[4] — resuming at fund age, not restarting at rates[0].
    const next = revised[4]
    const unfundedBefore = revised[3]?.unfunded ?? 0
    expect(next?.called).toBe(Math.round(0.2 * unfundedBefore))

    // Restarting would have applied rates[0] to a materially different base.
    const restarted = revised[4]?.called === Math.round(0.25 * 5_000_000_00)
    expect(restarted).toBe(false)
  })

  it('lets a reported NAV override the modelled one', () => {
    const { revised } = reproject(CONFIG, FUND, [
      { date: '2024-03-31', type: 'call', amount: 1_000_000_00 },
      { date: '2024-03-31', type: 'nav', amount: 900_000_00 },
    ])
    expect(revised[0]?.nav).toBe(900_000_00)
  })

  it('takes the last NAV when a period has several', () => {
    const { revised } = reproject(CONFIG, FUND, [
      { date: '2024-01-31', type: 'nav', amount: 100_00 },
      { date: '2024-02-28', type: 'nav', amount: 200_00 },
      { date: '2024-03-31', type: 'nav', amount: 300_00 },
    ])
    expect(revised[0]?.nav).toBe(300_00)
  })

  it('extends the term when actuals outlive it (spec D5)', () => {
    const baselineLength = project(CONFIG, FUND).length
    const { revised, baseline } = reproject(CONFIG, FUND, [
      { date: '2030-03-31', type: 'call', amount: 100_00 },
    ])
    expect(baseline).toHaveLength(baselineLength)
    // Actuals reach index 24, beyond termPeriods=20, so the term extends by
    // termExtensionYears (3) x periodsPerYear (4) = 12 periods.
    expect(revised.length).toBe(24 + 12 + 1)
  })

  it('reports variance against the untouched baseline', () => {
    const result = reproject(CONFIG, FUND, [
      { date: '2024-03-31', type: 'call', amount: 4_000_000_00 },
    ])
    const v = result.variance[0]
    expect(v?.calledDelta).toBe(4_000_000_00 - (result.baseline[0]?.called ?? 0))
    expect(result.baseline).toEqual(project(CONFIG, FUND))
  })

  it('is insensitive to transaction input order', () => {
    const txs = [
      { date: '2024-09-30', type: 'call' as const, amount: 500_000_00 },
      { date: '2024-03-31', type: 'call' as const, amount: 1_000_000_00 },
    ]
    const a = reproject(CONFIG, FUND, txs)
    const b = reproject(CONFIG, FUND, [...txs].reverse())
    expect(a.revised).toEqual(b.revised)
  })
})

describe('validation', () => {
  it('rejects percent-valued rates rather than coercing them', () => {
    const result = validateConfig({
      ...CONFIG,
      callSchedule: { basis: 'commitment', rates: [25, 25, ...Array(18).fill(0)] },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues[0]?.code).toBe('RATE_OUT_OF_RANGE')
      expect(result.issues[0]?.path).toBe('callSchedule.rates[0]')
    }
  })

  it('rejects commitment-basis rates summing above 1', () => {
    const result = validateConfig({
      ...CONFIG,
      callSchedule: { basis: 'commitment', rates: [0.6, 0.6, ...Array(18).fill(0)] },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues.some((i) => i.code === 'RATE_SUM_EXCEEDS_COMMITMENT')).toBe(true)
    }
  })

  it('rejects call schedules that do not cover exactly the modeled term', () => {
    const tooLong = validateConfig({
      ...CONFIG,
      callSchedule: { basis: 'commitment', rates: [0.5, ...Array(20).fill(0)] },
    })
    expect(tooLong.ok).toBe(false)
    if (!tooLong.ok) {
      expect(tooLong.issues.some((i) => i.code === 'SCHEDULE_TOO_LONG')).toBe(true)
    }

    const tooShort = validateConfig({
      ...CONFIG,
      callSchedule: { basis: 'commitment', rates: [0.5, ...Array(18).fill(0)] },
    })
    expect(tooShort.ok).toBe(false)
    if (!tooShort.ok) {
      expect(tooShort.issues.some((i) => i.code === 'SCHEDULE_TOO_SHORT')).toBe(true)
    }
  })

  it('collects every issue rather than stopping at the first', () => {
    const result = validateConfig({
      ...CONFIG,
      termPeriods: 0,
      bowFactor: 0,
      yieldRate: -1,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues.length).toBeGreaterThanOrEqual(3)
  })

  it('throws from engine functions given an invalid config', () => {
    expect(() => project({ ...CONFIG, bowFactor: -1 }, FUND)).toThrow(/Invalid ModelConfig/)
  })

  it('rejects non-integer commitments', () => {
    expect(() => project(CONFIG, { ...FUND, commitment: 1.5 })).toThrow(/minor units/)
  })
})
