/** Reviewed arithmetic examples. Expectations are literal inputs/outputs, not engine helpers. */
import { describe, expect, it } from 'vitest'
import {
  buildSchedule,
  type CashFlowPeriod,
  type ModelConfig,
  project,
  reproject,
  type Transaction,
} from '../src/index.js'

const annual: ModelConfig = {
  fund_life: 4,
  periodsPerYear: 1,
  growthRate: 0.1,
  yieldRate: 0,
  bowFactor: 2,
  callSchedule: { basis: 'commitment', rates: [0.4, 0.3, 0.2, 0.1] },
  distributionSchedule: { basis: 'nav', rates: [0, 0.25, 0.5, 1] },
  terminalLiquidation: true,
  termExtensionYears: 0.5,
}
const quarterly: ModelConfig = {
  ...annual,
  fund_life: 1,
  periodsPerYear: 4,
  growthRate: 0,
  callSchedule: { basis: 'commitment', rates: [0.25, 0.25, 0.25, 0.25] },
  distributionSchedule: { basis: 'nav', rates: [0, 0, 0, 0] },
  terminalLiquidation: false,
}
const fund = { commitment: 10000, startDate: '2024-01-15' }

function conservation(rows: readonly CashFlowPeriod[]) {
  for (const row of rows) {
    expect(row.unfunded + row.calledCumulative).toBe(fund.commitment)
    expect(row.netCashFlow).toBe(row.distributed - row.called)
    expect(row.nav).toBeGreaterThanOrEqual(0)
    expect(row.dpi).toBe(
      row.calledCumulative ? row.distributedCumulative / row.calledCumulative : 0,
    )
    expect(row.rvpi).toBe(row.calledCumulative ? row.nav / row.calledCumulative : 0)
    expect(row.tvpi).toBeCloseTo(row.dpi + row.rvpi, 14)
  }
}

describe('hand-calculated public-library outputs', () => {
  it('matches every field of a four-year forecast, including half-cent rounding and liquidation', () => {
    const rows = project(annual, fund)
    const expected: CashFlowPeriod[] = [
      {
        index: 0,
        periodEnd: '2024-12-31',
        source: 'forecast',
        called: 4000,
        distributed: 0,
        netCashFlow: -4000,
        calledCumulative: 4000,
        distributedCumulative: 0,
        unfunded: 6000,
        overcalled: false,
        nav: 4000,
        dpi: 0,
        rvpi: 1,
        tvpi: 1,
      },
      {
        index: 1,
        periodEnd: '2025-12-31',
        source: 'forecast',
        called: 3000,
        distributed: 1100,
        netCashFlow: -1900,
        calledCumulative: 7000,
        distributedCumulative: 1100,
        unfunded: 3000,
        overcalled: false,
        nav: 6300,
        dpi: 1100 / 7000,
        rvpi: 6300 / 7000,
        tvpi: 7400 / 7000,
      },
      {
        index: 2,
        periodEnd: '2026-12-31',
        source: 'forecast',
        called: 2000,
        distributed: 3465,
        netCashFlow: 1465,
        calledCumulative: 9000,
        distributedCumulative: 4565,
        unfunded: 1000,
        overcalled: false,
        nav: 5465,
        dpi: 4565 / 9000,
        rvpi: 5465 / 9000,
        tvpi: 10030 / 9000,
      },
      {
        index: 3,
        periodEnd: '2027-12-31',
        source: 'forecast',
        called: 1000,
        distributed: 7012,
        netCashFlow: 6012,
        calledCumulative: 10000,
        distributedCumulative: 11577,
        unfunded: 0,
        overcalled: false,
        nav: 0,
        dpi: 1.1577,
        rvpi: 0,
        tvpi: 1.1577,
      },
    ]
    expect(rows).toEqual(
      expected.map((row) => ({
        ...row,
        dpi: expect.closeTo(row.dpi, 14),
        rvpi: expect.closeTo(row.rvpi, 14),
        tvpi: expect.closeTo(row.tvpi, 14),
      })),
    )
    conservation(rows)
    expect(project({ ...annual, terminalLiquidation: false }, fund).at(-1)).toMatchObject({
      distributed: 6012,
      nav: 1000,
      distributedCumulative: 10577,
      tvpi: expect.closeTo(1.1577, 14),
    })
    const empty = reproject(annual, fund, [])
    expect(empty.baseline).toEqual(rows)
    expect(empty.revised).toEqual(rows)
    expect(empty.asOf).toBeNull()
    expect(
      empty.variance.every(
        (r) =>
          r.calledDelta === 0 && r.distributedDelta === 0 && r.navDelta === 0 && r.tvpiDelta === 0,
      ),
    ).toBe(true)
  })

  it('matches fractional curves without introducing money or calendar inputs', () => {
    const rows = buildSchedule(annual)
    const expected = [
      [0.4, 0, 0.6, 0.4],
      [0.7, 0.11, 0.3, 0.63],
      [0.9, 0.4565, 0.1, 0.5465],
      [1, 1.15765, 0, 0],
    ]
    rows.forEach((row, i) => {
      for (const [j, field] of [
        'calledFraction',
        'distributedFraction',
        'unfundedFraction',
        'navFraction',
      ].entries()) {
        expect(row[field as keyof typeof row]).toBeCloseTo(expected[i]?.[j] ?? NaN, 14)
      }
      expect(Object.hasOwn(row, 'periodEnd')).toBe(false)
    })
    const before = JSON.stringify(rows)
    project(annual, { commitment: 3, startDate: '2023-02-28' })
    project(annual, { commitment: 100000000, startDate: '2024-02-29' })
    expect(JSON.stringify(buildSchedule(annual))).toBe(before)
  })

  it('aggregates actuals, selects the latest NAV, rescales calls, and computes variance', () => {
    const actuals: Transaction[] = [
      { date: '2024-06-30', type: 'nav', amount: 3600 },
      { date: '2023-12-01', type: 'call', amount: 1000 },
      { date: '2024-03-31', type: 'call', amount: 2000 },
      { date: '2024-03-31', type: 'distribution', amount: 100 },
      { date: '2024-03-31', type: 'nav', amount: 2800 },
      { date: '2024-03-31', type: 'nav', amount: 2900 },
      { date: '2024-06-01', type: 'nav', amount: 3300 },
    ]
    const result = reproject(quarterly, fund, actuals)
    expect(result.asOf).toBe('2024-06-30')
    expect(
      result.revised.map((r) => [r.source, r.called, r.distributed, r.nav, r.unfunded]),
    ).toEqual([
      ['actual', 3000, 100, 2900, 7000],
      ['actual', 0, 0, 3600, 7000],
      ['forecast', 3500, 0, 7100, 3500],
      ['forecast', 3500, 0, 10600, 0],
    ])
    expect(result.variance.map((r) => [r.calledDelta, r.distributedDelta, r.navDelta])).toEqual([
      [500, 100, 400],
      [-2500, 0, -1400],
      [1000, 0, -400],
      [1000, 0, 600],
    ])
    const tvpiDeltas = [0, 3700 / 3000 - 1, 7200 / 6500 - 1, 0.07]
    result.variance.forEach((r, i) => {
      expect(r.tvpiDelta).toBeCloseTo(tvpiDeltas[i] ?? NaN, 14)
    })
    conservation(result.baseline)
    conservation(result.revised)
  })

  it('checks all eight combinations of supplied/missing calls, distributions, and NAV', () => {
    for (let mask = 0; mask < 8; mask++) {
      const actuals: Transaction[] = [
        { date: '2024-03-31', type: 'call', amount: 1000 },
        { date: '2024-09-30', type: 'nav', amount: 0 },
      ]
      if (mask & 1) actuals.push({ date: '2024-06-30', type: 'call', amount: 700 })
      if (mask & 2) actuals.push({ date: '2024-06-30', type: 'distribution', amount: 200 })
      if (mask & 4) actuals.push({ date: '2024-06-30', type: 'nav', amount: 900 })
      const rows = reproject(quarterly, fund, actuals).revised
      expect(rows[1]).toMatchObject({
        source: mask & 4 ? 'actual' : 'forecast',
        called: mask & 1 ? 700 : 0,
        distributed: mask & 2 ? 200 : 0,
        nav: mask & 4 ? 900 : 1000 + (mask & 1 ? 700 : 0) - (mask & 2 ? 200 : 0),
      })
      expect(rows[2]).toMatchObject({ source: 'actual', nav: 0 })
      conservation(rows)
    }
  })

  it('preserves overcalling without producing negative future calls', () => {
    const rows = reproject(quarterly, fund, [
      { date: '2024-03-31', type: 'call', amount: 12000 },
    ]).revised
    expect(rows.map((r) => r.called)).toEqual([12000, 0, 0, 0])
    expect(rows.every((r) => r.unfunded === -2000 && r.overcalled)).toBe(true)
    conservation(rows)
  })

  it('extends only the revised forecast and leaves variance at the baseline horizon', () => {
    const result = reproject(quarterly, fund, [{ date: '2025-03-31', type: 'nav', amount: 5000 }])
    expect(result.baseline).toHaveLength(4)
    expect(result.variance).toHaveLength(4)
    expect(result.revised.map((r) => r.periodEnd)).toEqual([
      '2024-03-31',
      '2024-06-30',
      '2024-09-30',
      '2024-12-31',
      '2025-03-31',
      '2025-06-30',
      '2025-09-30',
    ])
    expect(result.asOf).toBe('2025-03-31')
    expect(result.revised.slice(4).map((r) => [r.called, r.distributed, r.nav])).toEqual([
      [0, 0, 5000],
      [0, 0, 5000],
      [0, 0, 5000],
    ])
    conservation(result.revised)
  })

  it('applies unfunded calls to the remaining balance and caps commitment distributions', () => {
    const unfunded = project(
      {
        ...quarterly,
        callSchedule: { basis: 'unfunded', rates: [0.5, 0.5, 0.5, 0.5] },
      },
      fund,
    )
    expect(unfunded.map((r) => r.called)).toEqual([5000, 2500, 1250, 625])
    expect(unfunded.at(-1)?.unfunded).toBe(625)
    const capped = project(
      {
        ...quarterly,
        distributionSchedule: { basis: 'commitment', rates: [0.8, 0.2] },
      },
      fund,
    )
    expect(capped.map((r) => [r.distributed, r.nav])).toEqual([
      [2500, 0],
      [2000, 500],
      [0, 3000],
      [0, 5500],
    ])
    conservation(unfunded)
    conservation(capped)
  })

  it('produces the same quarterly per-period amounts for an annual rate that compounds to 10% per quarter', () => {
    const rows = project(
      {
        ...annual,
        periodsPerYear: 4,
        fund_life: 1,
        growthRate: 1.1 ** 4 - 1,
      },
      fund,
    )
    const yearly = project(annual, fund)
    expect(rows.map((r) => [r.called, r.distributed, r.nav])).toEqual(
      yearly.map((r) => [r.called, r.distributed, r.nav]),
    )
  })
})
