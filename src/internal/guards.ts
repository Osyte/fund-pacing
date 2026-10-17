import { PacingConfigError, PacingInputError } from '../errors.js'
import type {
  FundTerms,
  ModelConfig,
  Transaction,
  ValidationIssue,
  ValidationResult,
} from '../types.js'
import { parseISO } from './calendar.js'
import { termPeriodsFor } from './term.js'

const RATE_SUM_EPSILON = 1e-9

interface ScheduleValidationOptions {
  readonly expectedLength?: number
  readonly requireCommitmentSumOne?: boolean
}

function isInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n)
}

function isFinitePositive(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Non-throwing. Collects every problem rather than failing on the first, so a
 * form can display them all at once.
 */
export function validateConfig(config: ModelConfig): ValidationResult {
  const issues: ValidationIssue[] = []
  const add = (path: string, code: string, message: string): void => {
    issues.push({ path, code, message })
  }

  const input: unknown = config
  if (!isRecord(input)) {
    add('config', 'INVALID_CONFIG', 'must be an object')
    return { ok: false, issues }
  }

  const frequency = input.periodsPerYear
  const fundLife = input.fund_life
  const validFrequency = frequency === 1 || frequency === 2 || frequency === 4
  const termPeriods =
    isFinitePositive(fundLife) && validFrequency
      ? termPeriodsFor({ fund_life: fundLife, periodsPerYear: frequency })
      : undefined

  if (!validFrequency) {
    add('periodsPerYear', 'INVALID_FREQUENCY', 'must be 1, 2, or 4')
  }
  if (!isFinitePositive(fundLife)) {
    add('fund_life', 'INVALID_FUND_LIFE', 'must be a finite number > 0, in years')
  } else if (termPeriods !== undefined && (!Number.isSafeInteger(termPeriods) || termPeriods < 1)) {
    add(
      'fund_life',
      'INVALID_FUND_LIFE',
      'fund_life * periodsPerYear must be a positive safe integer; partial periods are not rounded',
    )
  }
  if (typeof input.growthRate !== 'number' || !Number.isFinite(input.growthRate)) {
    add('growthRate', 'INVALID_RATE', 'must be a finite number')
  } else if (input.growthRate <= -1) {
    add('growthRate', 'RATE_OUT_OF_RANGE', 'must be greater than -1')
  }
  if (typeof input.yieldRate !== 'number' || !Number.isFinite(input.yieldRate)) {
    add('yieldRate', 'INVALID_RATE', 'must be a finite number')
  } else if (input.yieldRate < 0) {
    add('yieldRate', 'RATE_OUT_OF_RANGE', 'must be >= 0')
  }
  if (!isFinitePositive(input.bowFactor)) {
    add('bowFactor', 'INVALID_BOW_FACTOR', 'must be a finite number > 0')
  }
  if (typeof input.terminalLiquidation !== 'boolean') {
    add('terminalLiquidation', 'INVALID_FLAG', 'must be a boolean')
  }
  if (
    typeof input.termExtensionYears !== 'number' ||
    !Number.isFinite(input.termExtensionYears) ||
    input.termExtensionYears < 0
  ) {
    add('termExtensionYears', 'INVALID_TERM_EXTENSION', 'must be a finite number >= 0')
  }

  const callScheduleOptions: ScheduleValidationOptions =
    typeof termPeriods === 'number' && Number.isSafeInteger(termPeriods) && termPeriods >= 1
      ? { expectedLength: termPeriods, requireCommitmentSumOne: true }
      : { requireCommitmentSumOne: true }
  validateSchedule(
    input.callSchedule,
    'callSchedule',
    ['commitment', 'unfunded'],
    add,
    callScheduleOptions,
  )
  if ('distributionSchedule' in input && input.distributionSchedule !== undefined) {
    validateSchedule(input.distributionSchedule, 'distributionSchedule', ['commitment', 'nav'], add)
  }

  return issues.length === 0 ? { ok: true } : { ok: false, issues }
}

function validateSchedule(
  schedule: unknown,
  path: string,
  allowed: readonly string[],
  add: (path: string, code: string, message: string) => void,
  options: ScheduleValidationOptions = {},
): void {
  if (!isRecord(schedule)) {
    add(path, 'INVALID_SCHEDULE', 'must be an object')
    return
  }

  const basis = schedule.basis
  const rates = schedule.rates

  if (typeof basis !== 'string' || !allowed.includes(basis)) {
    add(`${path}.basis`, 'INVALID_BASIS', `must be one of ${allowed.join(' | ')}`)
  }
  if (!Array.isArray(rates)) {
    add(`${path}.rates`, 'INVALID_RATES', 'must be an array of numbers')
    return
  }

  let sum = 0
  rates.forEach((rate, i) => {
    if (typeof rate !== 'number' || !Number.isFinite(rate)) {
      add(`${path}.rates[${i}]`, 'INVALID_RATE', 'must be a finite number')
      return
    }
    if (rate < 0 || rate > 1) {
      add(
        `${path}.rates[${i}]`,
        'RATE_OUT_OF_RANGE',
        `must be a decimal in [0, 1] — received ${rate}. Rates are never percent-valued.`,
      )
    }
    sum += rate
  })

  if (options.expectedLength !== undefined && rates.length !== options.expectedLength) {
    const code = rates.length > options.expectedLength ? 'SCHEDULE_TOO_LONG' : 'SCHEDULE_TOO_SHORT'
    add(
      `${path}.rates`,
      code,
      `must contain exactly ${options.expectedLength} rates, one for each term period`,
    )
  }

  if (basis === 'commitment') {
    if (sum > 1 + RATE_SUM_EPSILON) {
      add(
        `${path}.rates`,
        'RATE_SUM_EXCEEDS_COMMITMENT',
        `commitment-basis rates sum to ${sum}, which exceeds 1`,
      )
    } else if (options.requireCommitmentSumOne && sum < 1 - RATE_SUM_EPSILON) {
      add(
        `${path}.rates`,
        'RATE_SUM_BELOW_COMMITMENT',
        `commitment-basis rates sum to ${sum}, which is below 1`,
      )
    }
  }
}

/** Throws `PacingConfigError` unless the config is valid. */
export function assertValidConfig(config: ModelConfig): void {
  const result = validateConfig(config)
  if (!result.ok) throw new PacingConfigError(result.issues)
}

export function assertValidFundTerms(fund: FundTerms): void {
  if (!isInt(fund.commitment) || fund.commitment <= 0) {
    throw new PacingInputError(
      'INVALID_COMMITMENT',
      'commitment',
      'must be a positive integer in minor units',
    )
  }
  parseISO(fund.startDate, 'startDate')
}

export function assertValidTransactions(transactions: readonly Transaction[]): void {
  transactions.forEach((tx, i) => {
    const path = `actuals[${i}]`
    if (tx.type !== 'call' && tx.type !== 'distribution' && tx.type !== 'nav') {
      throw new PacingInputError('INVALID_TRANSACTION_TYPE', `${path}.type`, `unknown "${tx.type}"`)
    }
    if (!isInt(tx.amount) || tx.amount < 0) {
      throw new PacingInputError(
        'INVALID_AMOUNT',
        `${path}.amount`,
        'must be a non-negative integer in minor units',
      )
    }
    parseISO(tx.date, `${path}.date`)
  })
}
