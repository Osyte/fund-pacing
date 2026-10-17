import { assertValidConfig } from '../internal/guards.js'
import { noRound } from '../internal/money.js'
import { termPeriodsFor } from '../internal/term.js'
import type { ModelConfig, SchedulePeriod } from '../types.js'
import {
  callAmountAt,
  callRateAt,
  distributionAt,
  perPeriodRate,
  precomputeCommitmentCalls,
} from './rates.js'
import { type PeriodState, stepPeriod, ZERO_STATE } from './recurrence.js'

/**
 * Layer 1 — periods and percentages.
 *
 * Dimensionless: driven with `commitment = 1` and identity rounding, so the
 * output is independent of both commitment size and calendar. Cheap enough to
 * run on every keystroke in a parameter-tuning UI.
 */
export function buildSchedule(config: ModelConfig): SchedulePeriod[] {
  assertValidConfig(config)

  const growth = perPeriodRate(config.growthRate, config.periodsPerYear)
  const term = termPeriodsFor(config)

  const out: SchedulePeriod[] = []
  let state: PeriodState = ZERO_STATE
  const precomputedCalls = precomputeCommitmentCalls(config, 1, noRound)

  for (let t = 0; t < term; t++) {
    const callRate = callRateAt(config, t)
    const distribution = distributionAt(config, t, term)

    const result = stepPeriod(state, {
      commitment: 1,
      called: callAmountAt(config, t, 1, state.calledCumulative, precomputedCalls, noRound),
      distributionRate: distribution.rate,
      distributionBasis: distribution.basis,
      growthPerPeriod: growth,
      isTerminal: t === term - 1,
      terminalLiquidation: config.terminalLiquidation,
      round: noRound,
    })
    state = result.state

    out.push({
      index: t,
      callRate,
      distributionRate: distribution.rate,
      calledFraction: state.calledCumulative,
      distributedFraction: state.distributedCumulative,
      unfundedFraction: 1 - state.calledCumulative,
      navFraction: state.nav,
    })
  }

  return out
}
