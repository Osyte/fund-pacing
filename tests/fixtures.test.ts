/**
 * Golden fixtures — the documented examples, with corrected expected values.
 *
 * Spec §7 is explicit that matching the Python's current output would mean
 * failure. The four-year case below is the headline example from the Dec 2024
 * documentation ("Calls = 100% in Year 1, 25% each quarter"), which the Python
 * evaluates to 68.4% because it applies commitment-basis percentages against
 * unfunded commitment.
 */

import { describe, expect, it } from 'vitest'
import { buildSchedule, project, type ModelConfig } from '../src/index.js'

const FOUR_YEAR: ModelConfig = {
  periodsPerYear: 4,
  termPeriods: 16,
  callablePeriods: 4,
  growthRate: 0.15,
  yieldRate: 0,
  bowFactor: 2.5,
  callSchedule: { basis: 'commitment', rates: [0.25, 0.25, 0.25, 0.25] },
  terminalLiquidation: true,
  termExtensionYears: 3,
}

const COMMITMENT = 10_000_000_00 // $10m in cents

describe('4-year quarterly example (documentation §"Examples and Test Cases")', () => {
  const rows = project(FOUR_YEAR, { commitment: COMMITMENT, startDate: '2024-03-31' })

  it('calls exactly 100% of commitment, not 68.4%', () => {
    const last = rows[rows.length - 1]
    expect(last?.calledCumulative).toBe(COMMITMENT)
  })

  it('calls 25% in each of the first four quarters', () => {
    for (let i = 1; i <= 4; i++) {
      expect(rows[i]?.called).toBe(COMMITMENT / 4)
    }
    expect(rows[5]?.called).toBe(0)
  })

  it('applies rates[0] in period 1 — the off-by-one is gone', () => {
    const schedule = buildSchedule(FOUR_YEAR)
    expect(schedule[1]?.callRate).toBe(0.25)
    expect(schedule[0]?.callRate).toBe(0)
  })

  it('generates true quarter-end dates', () => {
    expect(rows[0]?.periodEnd).toBe('2024-03-31')
    expect(rows[1]?.periodEnd).toBe('2024-06-30')
    expect(rows[2]?.periodEnd).toBe('2024-09-30')
    expect(rows[3]?.periodEnd).toBe('2024-12-31')
  })

  it('liquidates to zero NAV at term end', () => {
    const last = rows[rows.length - 1]
    expect(last?.nav).toBe(0)
    expect(last?.rvpi).toBe(0)
  })
})

describe('unfunded basis leaves a residual, by design', () => {
  it('a [0.30, 0.35, 0.40, 0.35, 0.20] profile calls 85.8%', () => {
    const config: ModelConfig = {
      ...FOUR_YEAR,
      periodsPerYear: 1,
      termPeriods: 12,
      callablePeriods: 5,
      callSchedule: { basis: 'unfunded', rates: [0.3, 0.35, 0.4, 0.35, 0.2] },
    }
    const schedule = buildSchedule(config)
    const called = schedule[5]?.calledFraction ?? 0
    // 1 - (0.70 x 0.65 x 0.60 x 0.65 x 0.80)
    expect(called).toBeCloseTo(0.85804, 5)
  })
})

describe('geometric compounding (spec D7)', () => {
  const config: ModelConfig = {
    periodsPerYear: 4,
    termPeriods: 4,
    callablePeriods: 1,
    growthRate: 0.2,
    yieldRate: 0,
    bowFactor: 2.5,
    callSchedule: { basis: 'commitment', rates: [1] },
    // Explicit zero distributions, so NAV growth is observable in isolation.
    distributionSchedule: { basis: 'nav', rates: [0, 0, 0, 0] },
    terminalLiquidation: false,
    termExtensionYears: 0,
  }

  it('NAV compounds at the geometric per-period rate, not annual/4', () => {
    const rows = project(config, { commitment: COMMITMENT, startDate: '2024-03-31' })

    // The full commitment lands in period 1 and then grows for periods 2-4.
    const expected = COMMITMENT * 1.2 ** (3 / 4)
    expect(rows[4]?.nav).toBeCloseTo(expected, -2)

    // Simple division would have compounded to a materially higher figure.
    const simple = COMMITMENT * (1 + 0.2 / 4) ** 3
    expect(simple).toBeGreaterThan(expected)
  })

  it('four periods compound back to the stated annual rate', () => {
    const geometric = 1.2 ** (1 / 4) - 1
    expect((1 + geometric) ** 4).toBeCloseTo(1.2, 10)
    expect((1 + 0.2 / 4) ** 4).toBeCloseTo(1.21550625, 8)
  })
})
