/**
 * @osyte/fund-pacing — Takahashi-Alexander pacing for private fund cash flows.
 *
 * Four pure functions for curve exploration, investment forecasts, and validation:
 *
 *   buildSchedule(config)                 periods and percentages
 *   project(config, fund)                 + dates and amounts
 *   reproject(config, fund, actuals)      + observed transactions
 *   validateConfig(config)               structured validation issues
 *
 * Stateless and I/O-free. Every input and output is plain JSON.
 */

export { project, reproject } from './engine/reproject.js'
export { buildSchedule } from './engine/schedule.js'
export { PacingConfigError, PacingError, PacingInputError } from './errors.js'
export { validateConfig } from './internal/guards.js'

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
