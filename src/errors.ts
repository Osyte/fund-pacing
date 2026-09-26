import type { ValidationIssue } from './types.js'

/** Base class for every error this library throws. */
export class PacingError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'PacingError'
    this.code = code
  }
}

/** Thrown by engine functions given a config that fails validation. */
export class PacingConfigError extends PacingError {
  readonly issues: readonly ValidationIssue[]

  constructor(issues: readonly ValidationIssue[]) {
    const summary = issues.map((i) => `${i.path}: ${i.message}`).join('; ')
    super('INVALID_CONFIG', `Invalid ModelConfig — ${summary}`)
    this.name = 'PacingConfigError'
    this.issues = issues
  }
}

/** Thrown for malformed fund terms or transactions. */
export class PacingInputError extends PacingError {
  readonly path: string

  constructor(code: string, path: string, message: string) {
    super(code, `${path}: ${message}`)
    this.name = 'PacingInputError'
    this.path = path
  }
}
