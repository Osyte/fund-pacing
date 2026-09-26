/**
 * @osyte/fund-pacing — Takahashi-Alexander pacing for private fund cash flows.
 *
 * Three layers, each a pure function, each building on the previous:
 *
 *   buildSchedule(config)                 periods and percentages
 *   project(config, fund)                 + dates and amounts
 *   reproject(config, fund, actuals)      + observed transactions
 *
 * Stateless and I/O-free. Every input and output is plain JSON.
 */

export { buildSchedule } from './engine/schedule.js'
export { project, reproject } from './engine/reproject.js'
export { validateConfig } from './internal/guards.js'
export { PacingConfigError, PacingError, PacingInputError } from './errors.js'

export type {
  CallSchedule,
  CashFlowPeriod,
  CommitmentBasisSchedule,
  DistributionSchedule,
  FlowSource,
  Frequency,
  FundTerms,
  ModelConfig,
  NavBasisSchedule,
  ReprojectResult,
  SchedulePeriod,
  Transaction,
  TransactionType,
  UnfundedBasisSchedule,
  ValidationIssue,
  ValidationResult,
  VariancePeriod,
} from './types.js'
