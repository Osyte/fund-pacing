/**
 * Resolves schedule bases and annualised rates into plain per-period numbers.
 *
 * Everything convention-shaped lives here so that `recurrence.ts` consumes
 * only per-period rates and stays the single, convention-free source of truth
 * for the model arithmetic.
 */

import { allocate, type RoundFn } from '../internal/money.js'
import type { DistributionSchedule, Frequency, ModelConfig } from '../types.js'

/**
 * Annual to per-period, geometrically (spec D7).
 *
 * `(1 + annual)^(1/periodsPerYear) - 1` is the only conversion under which the
 * periods compound back to the stated annual rate.
 */
export function perPeriodRate(annual: number, periodsPerYear: Frequency): number {
  if (periodsPerYear === 1) return annual
  return (1 + annual) ** (1 / periodsPerYear) - 1
}

/**
 * Call rate for a zero-based period index.
 *
 * Period 0 consumes `rates[0]`. Periods with no calls must be represented by
 * explicit zero rates in the schedule.
 */
export function callRateAt(config: ModelConfig, index: number): number {
  if (index < 0 || index >= config.termPeriods) return 0
  return config.callSchedule.rates[index] ?? 0
}

/**
 * Commitment-basis calls are allocated in one pass so the parts sum to the
 * target exactly. Rounding each period independently drifts by a minor unit.
 *
 * Returns `undefined` for unfunded-basis schedules, which depend on running
 * state and cannot be precomputed.
 */
export function precomputeCommitmentCalls(
  config: ModelConfig,
  commitment: number,
  round: RoundFn,
): number[] | undefined {
  if (config.callSchedule.basis !== 'commitment') return undefined
  const rates = config.callSchedule.rates
  const sum = rates.reduce((a, b) => a + b, 0)
  return allocate(round(commitment * sum), rates, round)
}

/**
 * After actuals, commitment-basis forecasts preserve the full commitment by
 * scaling the remaining original forecast calls to the remaining commitment.
 */
export function rescaleCommitmentCallsAfterActuals(
  config: ModelConfig,
  commitment: number,
  actualCalledCumulative: number,
  firstForecastIndex: number,
  precomputed: readonly number[] | undefined,
  round: RoundFn,
): readonly number[] | undefined {
  if (config.callSchedule.basis !== 'commitment' || !precomputed || firstForecastIndex <= 0) {
    return precomputed
  }

  const adjusted = [...precomputed]
  const start = Math.max(0, firstForecastIndex)
  const weights = adjusted.slice(start)
  const remainingForecastTotal = weights.reduce((a, b) => a + b, 0)

  for (let i = start; i < adjusted.length; i++) {
    adjusted[i] = 0
  }
  if (remainingForecastTotal === 0) return adjusted

  const remainingCommitment = Math.max(0, commitment - actualCalledCumulative)
  const scaled = allocate(remainingCommitment, weights, round)
  for (let i = 0; i < scaled.length; i++) {
    adjusted[start + i] = scaled[i] ?? 0
  }

  return adjusted
}

/**
 * Capital called in a zero-based period.
 *
 * For unfunded basis the remaining commitment is floored at zero: once a fund
 * is overcalled (spec D8) there is nothing left to draw, and an unclamped
 * negative base would produce a negative call and, downstream, a negative NAV.
 */
export function callAmountAt(
  config: ModelConfig,
  index: number,
  commitment: number,
  calledCumulative: number,
  precomputed: readonly number[] | undefined,
  round: RoundFn,
): number {
  if (index < 0 || index >= config.termPeriods) return 0
  if (precomputed) return precomputed[index] ?? 0

  const rate = config.callSchedule.rates[index] ?? 0
  return round(rate * Math.max(0, commitment - calledCumulative))
}

export interface ResolvedDistribution {
  readonly rate: number
  readonly basis: 'commitment' | 'nav'
}

/**
 * Distribution rate for a zero-based period index.
 *
 * With no explicit schedule this is the TA bow curve — `max(yield, (t/T)^B)`,
 * a NAV-basis rate that ramps toward the end of the term.
 */
export function distributionAt(
  config: ModelConfig,
  index: number,
  effectiveTermPeriods: number,
): ResolvedDistribution {
  const schedule: DistributionSchedule | undefined = config.distributionSchedule
  if (schedule) {
    return { rate: schedule.rates[index] ?? 0, basis: schedule.basis }
  }
  if (index < 0 || effectiveTermPeriods <= 0) return { rate: 0, basis: 'nav' }

  const yieldPerPeriod = perPeriodRate(config.yieldRate, config.periodsPerYear)
  const elapsedPeriods = Math.min(index + 1, effectiveTermPeriods)
  const bow = (elapsedPeriods / effectiveTermPeriods) ** config.bowFactor
  return { rate: Math.max(yieldPerPeriod, bow), basis: 'nav' }
}
