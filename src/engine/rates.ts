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
 * Call rate for a 1-based period index.
 *
 * Period 1 consumes `rates[0]`. The original Python shifted the array on build
 * and then read it shifted again, dropping `rates[0]` entirely; the indexing
 * here is deliberate and covered by a golden fixture.
 */
export function callRateAt(config: ModelConfig, index: number): number {
  if (index < 1 || index > config.callablePeriods) return 0
  return config.callSchedule.rates[index - 1] ?? 0
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
  const rates = config.callSchedule.rates.slice(0, config.callablePeriods)
  const sum = rates.reduce((a, b) => a + b, 0)
  return allocate(round(commitment * sum), rates, round)
}

/**
 * Capital called in a 1-based period.
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
  if (index < 1 || index > config.callablePeriods) return 0
  if (precomputed) return precomputed[index - 1] ?? 0

  const rate = config.callSchedule.rates[index - 1] ?? 0
  return round(rate * Math.max(0, commitment - calledCumulative))
}

export interface ResolvedDistribution {
  readonly rate: number
  readonly basis: 'commitment' | 'nav'
}

/**
 * Distribution rate for a 1-based period index.
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
    return { rate: schedule.rates[index - 1] ?? 0, basis: schedule.basis }
  }
  if (index < 1 || effectiveTermPeriods <= 0) return { rate: 0, basis: 'nav' }

  const yieldPerPeriod = perPeriodRate(config.yieldRate, config.periodsPerYear)
  const bow = (Math.min(index, effectiveTermPeriods) / effectiveTermPeriods) ** config.bowFactor
  return { rate: Math.max(yieldPerPeriod, bow), basis: 'nav' }
}
