/**
 * Rounding for minor-unit (integer) arithmetic.
 *
 * Half away from zero. `Math.round` alone rounds half toward +Infinity, so
 * -0.5 would become -0 rather than -1; the sign is handled explicitly.
 */
import { PacingInputError } from '../errors.js'

export function assertSafeMoney(value: number): number {
  if (!Number.isSafeInteger(value)) {
    throw new PacingInputError(
      'NUMERIC_OVERFLOW',
      'calculation',
      'amount exceeds safe integer minor-unit precision',
    )
  }
  return value
}

export function roundMinor(x: number): number {
  return assertSafeMoney(x < 0 ? -Math.round(-x) : Math.round(x))
}

/** Identity rounding, for the dimensionless (fractional) instantiation. */
export function noRound(x: number): number {
  if (!Number.isFinite(x)) {
    throw new PacingInputError('NUMERIC_OVERFLOW', 'calculation', 'model result is not finite')
  }
  return x
}

export type RoundFn = (x: number) => number

/**
 * Split `total` across `weights` so the parts sum to `total` exactly.
 * Each rounded share is capped at the unallocated total. Any positive residual
 * goes to the final nonzero weight, so even tiny totals have no negative shares.
 *
 * Rounding four equal calls against 10001 cents independently totals 10000;
 * residual allocation preserves the intended 10001-cent total.
 */
export function allocate(
  total: number,
  weights: readonly number[],
  round: RoundFn = roundMinor,
): number[] {
  const sum = weights.reduce((a, b) => a + b, 0)
  if (sum === 0) return weights.map(() => 0)

  let residual = total
  const parts = weights.map((w) => {
    const part = Math.min(residual, round(total * (w / sum)))
    residual -= part
    return part
  })

  for (let i = parts.length - 1; i >= 0; i--) {
    if ((weights[i] ?? 0) !== 0) {
      parts[i] = (parts[i] ?? 0) + residual
      break
    }
  }
  return parts
}
