/** Periods per year. Quarterly, semi-annual, or annual. */
export type Frequency = 1 | 2 | 4

/** Rates expressed as a share of total commitment. */
export interface CommitmentBasisSchedule {
  readonly basis: 'commitment'
  readonly rates: readonly number[]
}

/** Rates applied to remaining unfunded commitment. */
export interface UnfundedBasisSchedule {
  readonly basis: 'unfunded'
  readonly rates: readonly number[]
}

/** Rates applied to prevailing (grown) NAV. */
export interface NavBasisSchedule {
  readonly basis: 'nav'
  readonly rates: readonly number[]
}

export type CallSchedule = CommitmentBasisSchedule | UnfundedBasisSchedule
export type DistributionSchedule = CommitmentBasisSchedule | NavBasisSchedule

/**
 * Fully resolved model configuration. Every field is required; the engine
 * applies no defaults and has no knowledge that defaults exist.
 */
export interface ModelConfig {
  readonly periodsPerYear: Frequency
  /** Total modeled cash-flow periods. Output indices run from 0 to termPeriods - 1. */
  readonly termPeriods: number
  /** Per annum, decimal. Converted to per-period geometrically. */
  readonly growthRate: number
  /** Per annum, decimal. Converted to per-period geometrically. */
  readonly yieldRate: number
  /** Distribution curve shape. Any value > 0. */
  readonly bowFactor: number
  readonly callSchedule: CallSchedule
  /** Optional explicit override of the modelled bow curve. */
  readonly distributionSchedule?: DistributionSchedule
  /** Distribute all residual NAV in the final period. */
  readonly terminalLiquidation: boolean
  /** Term extension when actuals outlive the term. Only affects `reproject`. */
  readonly termExtensionYears: number
}

/** Layer 1 output. Dimensionless: independent of commitment and calendar. */
export interface SchedulePeriod {
  readonly index: number
  readonly callRate: number
  readonly distributionRate: number
  readonly calledFraction: number
  readonly distributedFraction: number
  readonly unfundedFraction: number
  readonly navFraction: number
}

export interface FundTerms {
  /** Minor units (e.g. cents). Must be a positive integer. */
  readonly commitment: number
  /** ISO `YYYY-MM-DD`. */
  readonly startDate: string
}

export type FlowSource = 'actual' | 'forecast'

/** Layer 2/3 output. Dated and denominated in minor units. */
export interface CashFlowPeriod {
  readonly index: number
  readonly periodEnd: string
  readonly source: FlowSource
  readonly called: number
  readonly distributed: number
  readonly netCashFlow: number
  readonly calledCumulative: number
  readonly distributedCumulative: number
  /** May be negative when calls exceed commitment. */
  readonly unfunded: number
  readonly overcalled: boolean
  readonly nav: number
  readonly dpi: number
  readonly rvpi: number
  readonly tvpi: number
}

export type TransactionType = 'call' | 'distribution' | 'nav'

export interface Transaction {
  /** ISO `YYYY-MM-DD`. */
  readonly date: string
  readonly type: TransactionType
  /** Minor units, always positive. */
  readonly amount: number
}

export interface VariancePeriod {
  readonly index: number
  readonly periodEnd: string
  readonly calledDelta: number
  readonly distributedDelta: number
  readonly navDelta: number
  readonly tvpiDelta: number
}

export interface ReprojectResult {
  /** The original T=0 forecast, unchanged. */
  readonly baseline: readonly CashFlowPeriod[]
  /** Actuals spliced in, remainder re-forecast. */
  readonly revised: readonly CashFlowPeriod[]
  readonly variance: readonly VariancePeriod[]
  /** Boundary between actual and forecast. `null` when there are no actuals. */
  readonly asOf: string | null
}

export interface ValidationIssue {
  /** e.g. `callSchedule.rates[3]` */
  readonly path: string
  /** Machine-readable, e.g. `RATE_OUT_OF_RANGE` */
  readonly code: string
  readonly message: string
}

export type ValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] }
