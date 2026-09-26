export interface Multiples {
  readonly dpi: number
  readonly rvpi: number
  readonly tvpi: number
}

/**
 * Derived from cumulatives rather than accumulated, so rounding cannot drift
 * across periods. Undefined ratios (nothing called yet) report as zero.
 */
export function multiples(
  calledCumulative: number,
  distributedCumulative: number,
  nav: number,
): Multiples {
  if (calledCumulative === 0) return { dpi: 0, rvpi: 0, tvpi: 0 }
  const dpi = distributedCumulative / calledCumulative
  const rvpi = nav / calledCumulative
  return { dpi, rvpi, tvpi: dpi + rvpi }
}
