import { compareISO, periodEndDates, periodIndexOf } from '../internal/calendar.js'
import {
  assertValidConfig,
  assertValidFundTerms,
  assertValidTransactions,
} from '../internal/guards.js'
import { multiples } from '../internal/metrics.js'
import { roundMinor } from '../internal/money.js'
import type {
  CashFlowPeriod,
  FundTerms,
  ModelConfig,
  ReprojectResult,
  Transaction,
  VariancePeriod,
} from '../types.js'
import { callAmountAt, distributionAt, perPeriodRate, precomputeCommitmentCalls } from './rates.js'
import { type PeriodState, stepPeriod, ZERO_STATE } from './recurrence.js'

interface Bucket {
  called: number
  distributed: number
  nav: number | undefined
}

/**
 * Group transactions by period index.
 *
 * Where a period carries more than one NAV observation the last by date wins,
 * ties broken by input order.
 */
function bucketTransactions(
  transactions: readonly Transaction[],
  fund: FundTerms,
  config: ModelConfig,
): { buckets: Map<number, Bucket>; lastActualIndex: number } {
  const buckets = new Map<number, Bucket>()
  let lastActualIndex = -1

  const indexed = transactions.map((tx, order) => ({
    tx,
    order,
    index: periodIndexOf(tx.date, fund.startDate, config.periodsPerYear, 'actuals[].date'),
  }))

  // Stable sort by date, then by input order — so "last NAV wins" is deterministic.
  indexed.sort((a, b) => compareISO(a.tx.date, b.tx.date) || a.order - b.order)

  for (const { tx, index } of indexed) {
    let bucket = buckets.get(index)
    if (!bucket) {
      bucket = { called: 0, distributed: 0, nav: undefined }
      buckets.set(index, bucket)
    }
    if (tx.type === 'call') bucket.called += tx.amount
    else if (tx.type === 'distribution') bucket.distributed += tx.amount
    else bucket.nav = tx.amount

    if (index > lastActualIndex) lastActualIndex = index
  }

  return { buckets, lastActualIndex }
}

function row(
  index: number,
  periodEnd: string,
  source: 'actual' | 'forecast',
  called: number,
  distributed: number,
  state: PeriodState,
  commitment: number,
): CashFlowPeriod {
  const { dpi, rvpi, tvpi } = multiples(
    state.calledCumulative,
    state.distributedCumulative,
    state.nav,
  )
  return {
    index,
    periodEnd,
    source,
    called,
    distributed,
    netCashFlow: distributed - called,
    calledCumulative: state.calledCumulative,
    distributedCumulative: state.distributedCumulative,
    // Derived, never accumulated: conservation is exact by construction and
    // overcalling represents naturally as a negative value.
    unfunded: commitment - state.calledCumulative,
    overcalled: state.calledCumulative > commitment,
    nav: state.nav,
    dpi,
    rvpi,
    tvpi,
  }
}

/**
 * The single projection driver. `baseline` and `revised` are both produced by
 * this, so they cannot diverge in anything but the actuals supplied.
 */
function runProjection(
  config: ModelConfig,
  fund: FundTerms,
  buckets: Map<number, Bucket>,
  lastActualIndex: number,
  effectiveTermPeriods: number,
): CashFlowPeriod[] {
  const growth = perPeriodRate(config.growthRate, config.periodsPerYear)
  const periodEnds = periodEndDates(fund.startDate, config.periodsPerYear, effectiveTermPeriods)
  const precomputedCalls = precomputeCommitmentCalls(config, fund.commitment, roundMinor)

  const out: CashFlowPeriod[] = []
  let state: PeriodState = ZERO_STATE

  for (let t = 0; t < effectiveTermPeriods; t++) {
    const periodEnd = periodEnds[t] ?? ''
    const isActual = t <= lastActualIndex

    if (isActual) {
      const bucket = buckets.get(t)
      const called = bucket?.called ?? 0
      const distributed = bucket?.distributed ?? 0
      const navGrown = t === 0 ? 0 : roundMinor(state.nav * (1 + growth))
      // A reported NAV overrides the modelled one and becomes the base for
      // everything forward. Actual amounts are reproduced verbatim.
      const nav = bucket?.nav ?? Math.max(0, navGrown + called - distributed)

      state = {
        calledCumulative: state.calledCumulative + called,
        distributedCumulative: state.distributedCumulative + distributed,
        nav,
      }
      out.push(row(t, periodEnd, 'actual', called, distributed, state, fund.commitment))
      continue
    }

    const distribution = distributionAt(config, t, effectiveTermPeriods)
    const result = stepPeriod(state, {
      commitment: fund.commitment,
      called: callAmountAt(
        config,
        t,
        fund.commitment,
        state.calledCumulative,
        precomputedCalls,
        roundMinor,
      ),
      distributionRate: distribution.rate,
      distributionBasis: distribution.basis,
      growthPerPeriod: growth,
      isTerminal: t === effectiveTermPeriods - 1,
      terminalLiquidation: config.terminalLiquidation,
      round: roundMinor,
    })
    state = result.state
    out.push(
      row(t, periodEnd, 'forecast', result.called, result.distributed, state, fund.commitment),
    )
  }

  return out
}

/**
 * Layer 3 — revised forecast from actuals.
 *
 * `actuals` is the complete transaction set, not a delta: add, edit, and
 * delete are all the same call. The forecast resumes at the fund's actual age
 * (spec D2), from actual unfunded, NAV, and PIC.
 */
export function reproject(
  config: ModelConfig,
  fund: FundTerms,
  actuals: readonly Transaction[] = [],
): ReprojectResult {
  assertValidConfig(config)
  assertValidFundTerms(fund)
  assertValidTransactions(actuals)

  const { buckets, lastActualIndex } = bucketTransactions(actuals, fund, config)

  // Term extension: only actuals can outlive the term (spec D5).
  const extension = Math.round(config.termExtensionYears * config.periodsPerYear)
  const effectiveTermPeriods =
    lastActualIndex >= config.termPeriods ? lastActualIndex + 1 + extension : config.termPeriods

  const baseline = runProjection(config, fund, new Map(), -1, config.termPeriods)
  const revised =
    lastActualIndex < 0
      ? baseline
      : runProjection(config, fund, buckets, lastActualIndex, effectiveTermPeriods)

  const overlap = Math.min(baseline.length, revised.length)
  const variance: VariancePeriod[] = []
  for (let i = 0; i < overlap; i++) {
    const b = baseline[i]
    const r = revised[i]
    if (!b || !r) continue
    variance.push({
      index: i,
      periodEnd: r.periodEnd,
      calledDelta: r.called - b.called,
      distributedDelta: r.distributed - b.distributed,
      navDelta: r.nav - b.nav,
      tvpiDelta: r.tvpi - b.tvpi,
    })
  }

  return {
    baseline,
    revised,
    variance,
    asOf: lastActualIndex >= 0 ? (revised[lastActualIndex]?.periodEnd ?? null) : null,
  }
}

/**
 * Layer 2 — dates and amounts.
 *
 * Implemented as the zero-actuals case of `reproject`, which makes the
 * "empty actuals is a no-op" invariant true by construction rather than by
 * test, and means every `project` call exercises the same splice code path.
 */
export function project(config: ModelConfig, fund: FundTerms): readonly CashFlowPeriod[] {
  return reproject(config, fund, []).revised
}
