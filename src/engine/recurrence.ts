/**
 * The Takahashi-Alexander step. This is the only place the model arithmetic
 * is written down.
 *
 *   navGrown = nav[t-1] * (1 + g)
 *   dist     = distRate * (commitment | navGrown)      capped at navGrown + call
 *   nav[t]   = navGrown + call - dist
 *
 * The call amount arrives already resolved: schedule basis, allocation, and
 * annualisation are conventions, and they live in `rates.ts` so that this
 * function stays convention-free.
 *
 * Distributions are a rate on the *grown prior* NAV and exclude the current
 * period's call, per the original TA formulation: capital called this period
 * has not yet had time to be realised. (The Python had it both ways in
 * different files.)
 *
 * The function is unit-agnostic. Layer 1 drives it with `commitment = 1` and
 * identity rounding; layers 2 and 3 drive it with minor units and integer
 * rounding. There is no second copy to drift.
 */

import type { RoundFn } from '../internal/money.js'

export interface PeriodState {
  readonly calledCumulative: number
  readonly distributedCumulative: number
  readonly nav: number
}

export interface StepInput {
  readonly commitment: number
  /** Already resolved by `rates.ts` — basis and allocation live there. */
  readonly called: number
  readonly distributionRate: number
  readonly distributionBasis: 'commitment' | 'nav'
  readonly growthPerPeriod: number
  readonly isTerminal: boolean
  readonly terminalLiquidation: boolean
  readonly round: RoundFn
}

export interface StepResult {
  readonly state: PeriodState
  readonly called: number
  readonly distributed: number
}

export const ZERO_STATE: PeriodState = {
  calledCumulative: 0,
  distributedCumulative: 0,
  nav: 0,
}

export function stepPeriod(prev: PeriodState, input: StepInput): StepResult {
  const { commitment, called, round } = input

  const navGrown = round(prev.nav * (1 + input.growthPerPeriod))

  // Total assets available to distribute this period.
  const available = navGrown + called

  let distributed: number
  if (input.isTerminal && input.terminalLiquidation) {
    distributed = available
  } else {
    const distBase = input.distributionBasis === 'commitment' ? commitment : navGrown
    distributed = round(input.distributionRate * distBase)
  }

  // Cannot distribute more than exists, and never negative. This is what
  // guarantees NAV stays non-negative in every period.
  distributed = Math.max(0, Math.min(distributed, available))

  return {
    called,
    distributed,
    state: {
      calledCumulative: prev.calledCumulative + called,
      distributedCumulative: prev.distributedCumulative + distributed,
      nav: available - distributed,
    },
  }
}
