import fc from 'fast-check'
import type { Frequency, ModelConfig, Transaction } from '../src/index.js'

const frequency = fc.constantFrom<Frequency>(1, 2, 4)

/** Rates that always satisfy the commitment-basis sum constraint. */
function ratesUpToOne(maxLength: number): fc.Arbitrary<number[]> {
  return fc
    .array(fc.integer({ min: 0, max: 1000 }), { minLength: 1, maxLength })
    .map((weights) => {
      const total = weights.reduce((a, b) => a + b, 0)
      if (total === 0) return weights.map(() => 0)
      return weights.map((w) => w / total)
    })
}

export const arbConfig: fc.Arbitrary<ModelConfig> = fc
  .record({
    periodsPerYear: frequency,
    termYears: fc.integer({ min: 1, max: 12 }),
    callableFraction: fc.double({ min: 0.1, max: 1, noNaN: true }),
    growthRate: fc.double({ min: -0.5, max: 0.5, noNaN: true }),
    yieldRate: fc.double({ min: 0, max: 0.15, noNaN: true }),
    bowFactor: fc.double({ min: 0.2, max: 4, noNaN: true }),
    callBasis: fc.constantFrom('commitment' as const, 'unfunded' as const),
    terminalLiquidation: fc.boolean(),
    termExtensionYears: fc.integer({ min: 0, max: 5 }),
  })
  .chain((base) => {
    const termPeriods = base.termYears * base.periodsPerYear
    const callablePeriods = Math.max(1, Math.round(termPeriods * base.callableFraction))
    return ratesUpToOne(callablePeriods).map((rates) => ({
      periodsPerYear: base.periodsPerYear,
      termPeriods,
      callablePeriods,
      growthRate: base.growthRate,
      yieldRate: base.yieldRate,
      bowFactor: base.bowFactor,
      callSchedule: { basis: base.callBasis, rates },
      terminalLiquidation: base.terminalLiquidation,
      termExtensionYears: base.termExtensionYears,
    }))
  })

export const arbCommitment: fc.Arbitrary<number> = fc.integer({
  min: 100_00,
  max: 10_000_000_00,
})

export const arbStartDate: fc.Arbitrary<string> = fc
  .record({
    y: fc.integer({ min: 1990, max: 2040 }),
    m: fc.integer({ min: 1, max: 12 }),
    d: fc.integer({ min: 1, max: 28 }),
  })
  .map(
    ({ y, m, d }) =>
      `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
  )

export const arbTransactions: fc.Arbitrary<Transaction[]> = fc.array(
  fc.record({
    date: arbStartDate,
    type: fc.constantFrom<Transaction['type']>('call', 'distribution', 'nav'),
    amount: fc.integer({ min: 0, max: 5_000_000_00 }),
  }),
  { maxLength: 12 },
)
