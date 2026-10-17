/**
 * Rounding for minor-unit (integer) arithmetic.
 *
 * Half away from zero. `Math.round` alone rounds half toward +Infinity, so
 * -0.5 would become -0 rather than -1; the sign is handled explicitly.
 */
export function roundMinor(x: number): number {
  return x < 0 ? -Math.round(-x) : Math.round(x)
}

/** Identity rounding, for the dimensionless (fractional) instantiation. */
export function noRound(x: number): number {
  return x
}

export type RoundFn = (x: number) => number

/**
 * Split `total` across `weights` so the parts sum to `total` exactly.
 * Any rounding residual is assigned to the final non-zero weight.
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

  const parts = weights.map((w) => round((total * w) / sum))
  const residual = total - parts.reduce((a, b) => a + b, 0)

  for (let i = parts.length - 1; i >= 0; i--) {
    if ((weights[i] ?? 0) !== 0) {
      parts[i] = (parts[i] ?? 0) + residual
      break
    }
  }
  return parts
}
