import { PacingConfigError, PacingInputError } from '../errors.js'
import type {
  FundTerms,
  ModelConfig,
  Transaction,
  ValidationIssue,
  ValidationResult,
} from '../types.js'
import { parseISO } from './calendar.js'

const RATE_SUM_EPSILON = 1e-9

function isInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n)
}

function isFinitePositive(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0
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

  if (config.periodsPerYear !== 1 && config.periodsPerYear !== 2 && config.periodsPerYear !== 4) {
    add('periodsPerYear', 'INVALID_FREQUENCY', 'must be 1, 2, or 4')
  }
  if (!isInt(config.termPeriods) || config.termPeriods < 1) {
    add('termPeriods', 'INVALID_TERM', 'must be an integer >= 1')
  }
  if (!isInt(config.callablePeriods) || config.callablePeriods < 0) {
    add('callablePeriods', 'INVALID_CALLABLE_PERIOD', 'must be an integer >= 0')
  } else if (isInt(config.termPeriods) && config.callablePeriods > config.termPeriods) {
    add('callablePeriods', 'INVALID_CALLABLE_PERIOD', 'cannot exceed termPeriods')
  }
  if (typeof config.growthRate !== 'number' || !Number.isFinite(config.growthRate)) {
    add('growthRate', 'INVALID_RATE', 'must be a finite number')
  } else if (config.growthRate <= -1) {
    add('growthRate', 'RATE_OUT_OF_RANGE', 'must be greater than -1')
  }
  if (typeof config.yieldRate !== 'number' || !Number.isFinite(config.yieldRate)) {
    add('yieldRate', 'INVALID_RATE', 'must be a finite number')
  } else if (config.yieldRate < 0) {
    add('yieldRate', 'RATE_OUT_OF_RANGE', 'must be >= 0')
  }
  if (!isFinitePositive(config.bowFactor)) {
    add('bowFactor', 'INVALID_BOW_FACTOR', 'must be a finite number > 0')
  }
  if (typeof config.terminalLiquidation !== 'boolean') {
    add('terminalLiquidation', 'INVALID_FLAG', 'must be a boolean')
  }
  if (
    typeof config.termExtensionYears !== 'number' ||
    !Number.isFinite(config.termExtensionYears) ||
    config.termExtensionYears < 0
  ) {
    add('termExtensionYears', 'INVALID_TERM_EXTENSION', 'must be a finite number >= 0')
  }

  validateSchedule(config.callSchedule, 'callSchedule', ['commitment', 'unfunded'], add)
  if (config.distributionSchedule) {
    validateSchedule(
      config.distributionSchedule,
      'distributionSchedule',
      ['commitment', 'nav'],
      add,
    )
  }

  return issues.length === 0 ? { ok: true } : { ok: false, issues }
}

function validateSchedule(
  schedule: { basis: string; rates: readonly number[] },
  path: string,
  allowed: readonly string[],
  add: (path: string, code: string, message: string) => void,
): void {
  if (!allowed.includes(schedule.basis)) {
    add(`${path}.basis`, 'INVALID_BASIS', `must be one of ${allowed.join(' | ')}`)
  }
  if (!Array.isArray(schedule.rates)) {
    add(`${path}.rates`, 'INVALID_RATES', 'must be an array of numbers')
    return
  }

  let sum = 0
  schedule.rates.forEach((rate, i) => {
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

  if (schedule.basis === 'commitment' && sum > 1 + RATE_SUM_EPSILON) {
    add(
      `${path}.rates`,
      'RATE_SUM_EXCEEDS_COMMITMENT',
      `commitment-basis rates sum to ${sum}, which exceeds 1`,
    )
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
