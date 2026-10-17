import { describe, expect, it } from 'vitest'
import { callRateAt, distributionAt, perPeriodRate } from '../src/engine/rates.js'
import { type ModelConfig, reproject } from '../src/index.js'

const config: ModelConfig = {
  fund_life: 4,
  periodsPerYear: 1,
  growthRate: 0.2,
  yieldRate: 0.2,
  bowFactor: 2,
  callSchedule: { basis: 'commitment', rates: [1, 0, 0, 0] },
  terminalLiquidation: false,
  termExtensionYears: 1,
}
describe('rate resolution units', () => {
  it.each([1, 2, 4] as const)(
    'compounds %i periods back to the annual growth input',
    (frequency) => {
      const rate = perPeriodRate(0.2, frequency)
      expect((1 + rate) ** frequency).toBeCloseTo(1.2, 12)
      expect(perPeriodRate(0, frequency)).toBe(0)
    },
  )
  it('uses yield as a distribution floor and bow as the term progresses', () => {
    expect(distributionAt(config, 0, 4)).toEqual({ rate: 0.2, basis: 'nav' })
    expect(distributionAt(config, 2, 4)).toEqual({ rate: 0.5625, basis: 'nav' })
    expect(distributionAt(config, 3, 4)).toEqual({ rate: 1, basis: 'nav' })
  })
  it('lets explicit commitment distributions override bow and yield, with zeros beyond their entries', () => {
    const explicit = {
      ...config,
      distributionSchedule: { basis: 'commitment' as const, rates: [0.1, 0.2] },
    }
    expect(distributionAt(explicit, 0, 4)).toEqual({ rate: 0.1, basis: 'commitment' })
    expect(distributionAt(explicit, 2, 4)).toEqual({ rate: 0, basis: 'commitment' })
    expect(callRateAt(config, -1)).toBe(0)
    expect(callRateAt(config, 4)).toBe(0)
  })
  it('does not invent new call periods when actuals exhaust the scheduled call window', () => {
    const result = reproject(config, { commitment: 10000, startDate: '2024-01-01' }, [
      { date: '2024-06-30', type: 'call', amount: 1000 },
    ])
    expect(result.revised.map((row) => row.called)).toEqual([1000, 0, 0, 0])
    expect(result.revised.at(-1)?.unfunded).toBe(9000)
  })
  it('preserves observed zero NAV and zero distributions even when the model predicts activity', () => {
    const result = reproject(config, { commitment: 10000, startDate: '2024-01-01' }, [
      { date: '2024-06-30', type: 'call', amount: 1000 },
      { date: '2025-06-30', type: 'nav', amount: 0 },
    ])
    expect(result.revised[1]).toMatchObject({ source: 'actual', called: 0, distributed: 0, nav: 0 })
  })
})
