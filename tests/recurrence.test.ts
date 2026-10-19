import { describe, expect, it } from 'vitest'
import { type StepInput, stepPeriod } from '../src/engine/recurrence.js'
import { multiples } from '../src/internal/metrics.js'
import { roundMinor } from '../src/internal/money.js'

const prior = { nav: 10000, calledCumulative: 12000, distributedCumulative: 2000 }
const input: StepInput = {
  commitment: 20000,
  called: 3000,
  distributionRate: 0.5,
  distributionBasis: 'nav',
  growthPerPeriod: 0.1,
  isTerminal: false,
  terminalLiquidation: false,
  round: roundMinor,
}

describe('cash-flow recurrence units', () => {
  it('applies NAV distributions to grown prior NAV, excluding new calls', () => {
    const result = stepPeriod(prior, input)
    expect(result.distributed).toBe(5500)
    expect(result.state).toEqual({
      nav: 8500,
      calledCumulative: 15000,
      distributedCumulative: 7500,
    })
    expect(prior.nav).toBe(10000)
  })
  it('resolves commitment distributions against commitment and caps at available assets', () => {
    expect(stepPeriod(prior, { ...input, distributionBasis: 'commitment' }).distributed).toBe(10000)
    expect(
      stepPeriod(prior, { ...input, distributionBasis: 'commitment', distributionRate: 1 })
        .distributed,
    ).toBe(14000)
  })
  it('liquidates available assets including the final call only when enabled', () => {
    const liquidated = stepPeriod(prior, { ...input, isTerminal: true, terminalLiquidation: true })
    expect(liquidated.distributed).toBe(14000)
    expect(liquidated.state.nav).toBe(0)
    expect(stepPeriod(prior, { ...input, isTerminal: true }).state.nav).toBe(8500)
  })
  it('supports negative growth without negative NAV', () => {
    const result = stepPeriod(prior, { ...input, growthPerPeriod: -0.5 })
    expect(result.distributed).toBe(2500)
    expect(result.state.nav).toBe(5500)
  })
  it('uses paid-in capital for multiples, including zero paid-in capital', () => {
    expect(multiples(10000, 3000, 9000)).toEqual({ dpi: 0.3, rvpi: 0.9, tvpi: 1.2 })
    expect(multiples(0, 3000, 9000)).toEqual({ dpi: 0, rvpi: 0, tvpi: 0 })
  })
})
