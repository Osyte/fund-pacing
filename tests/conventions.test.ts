import { describe, expect, it } from 'vitest'
import {
  buildSchedule,
  type ModelConfig,
  PacingInputError,
  project,
  reproject,
} from '../src/index.js'
import { FundTermsSchema, TransactionsSchema } from '../src/schema/index.js'

const CONFIG: ModelConfig = {
  periodsPerYear: 4,
  fund_life: 4,
  growthRate: 0,
  yieldRate: 0,
  bowFactor: 2,
  callSchedule: { basis: 'commitment', rates: [1, ...Array(15).fill(0)] },
  terminalLiquidation: false,
  termExtensionYears: 1,
}
const FUND = { commitment: 10_000, startDate: '2024-01-15' }

describe('accepted v1 conventions', () => {
  it('K1: the same bow calibration does not preserve cash flows across frequencies', () => {
    const annual = {
      ...CONFIG,
      periodsPerYear: 1 as const,
      callSchedule: { basis: 'commitment' as const, rates: [1, 0, 0, 0] },
    }
    // Halfway through four years the bow rate is 25% in both models, but the
    // quarterly model has applied distributions more often by that point.
    expect(buildSchedule(annual)[1]?.distributionRate).toBe(0.25)
    expect(buildSchedule(CONFIG)[7]?.distributionRate).toBe(0.25)
    const annualHalfway = project(annual, FUND)[1]?.distributedCumulative ?? 0
    const quarterlyHalfway = project(CONFIG, FUND)[7]?.distributedCumulative ?? 0
    expect(annualHalfway).toBe(2500)
    expect(quarterlyHalfway).toBeGreaterThan(annualHalfway)
  })

  it('K5: pre-start activity is preserved in period 0 using normal aggregation rules', () => {
    const { revised, asOf } = reproject(CONFIG, FUND, [
      { date: '2024-01-10', type: 'nav', amount: 1700 },
      { date: '2023-12-01', type: 'call', amount: 1000 },
      { date: '2023-12-15', type: 'nav', amount: 1500 },
      { date: '2024-01-10', type: 'call', amount: 200 },
      { date: '2023-12-20', type: 'distribution', amount: 100 },
    ])
    expect(revised[0]).toMatchObject({
      periodEnd: '2024-03-31',
      source: 'actual',
      called: 1200,
      distributed: 100,
      nav: 1700,
      netCashFlow: -1100,
    })
    expect(asOf).toBe('2024-03-31')
    expect(revised[1]?.source).toBe('forecast')
  })

  it('K7: schema-valid impossible fund and transaction dates fail engine validation', () => {
    const fund = { ...FUND, startDate: '2023-02-29' }
    const actuals = [{ date: '2023-02-29', type: 'call' as const, amount: 1000 }]
    expect(FundTermsSchema.safeParse(fund).success).toBe(true)
    expect(TransactionsSchema.safeParse(actuals).success).toBe(true)
    for (const calculate of [() => project(CONFIG, fund), () => reproject(CONFIG, FUND, actuals)]) {
      expect(calculate).toThrow(PacingInputError)
      expect(calculate).toThrow(expect.objectContaining({ code: 'INVALID_DATE' }))
    }
    const leapFund = { ...FUND, startDate: '2024-02-29' }
    expect(FundTermsSchema.safeParse(leapFund).success).toBe(true)
    expect(() => project(CONFIG, leapFund)).not.toThrow()
  })

  it('K8: empty and omitted actuals share readonly projection values with zero variance', () => {
    for (const result of [reproject(CONFIG, FUND), reproject(CONFIG, FUND, [])]) {
      expect(result.baseline).toBe(result.revised)
      expect(result.asOf).toBeNull()
      expect(result.variance).toHaveLength(result.baseline.length)
      for (const row of result.variance) {
        expect(row).toMatchObject({
          calledDelta: 0,
          distributedDelta: 0,
          navDelta: 0,
          tvpiDelta: 0,
        })
      }
      // A consumer can safely edit its own copy of the arrays and their rows.
      const editable = result.revised.map((row) => ({ ...row }))
      const first = editable[0]
      if (first) first.nav = -1
      editable.pop()
      expect(result.baseline[0]?.nav).toBe(FUND.commitment)
      expect(result.revised).toHaveLength(CONFIG.fund_life * CONFIG.periodsPerYear)
    }
  })
})
