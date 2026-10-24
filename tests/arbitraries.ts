import fc from 'fast-check'
import type { Frequency, ModelConfig, Transaction } from '../src/index.js'

const frequency = fc.constantFrom<Frequency>(1, 2, 4)

/** Rates that satisfy the commitment-basis full-commitment sum constraint. */
function ratesSumOne(length: number): fc.Arbitrary<number[]> {
  return fc
    .array(fc.integer({ min: 0, max: 1000 }), { minLength: length, maxLength: length })
    .map((weights) => {
      const total = weights.reduce((a, b) => a + b, 0)
      if (total === 0) return weights.map((_, i) => (i === 0 ? 1 : 0))
      return weights.map((w) => w / total)
    })
}

export const arbConfig: fc.Arbitrary<ModelConfig> = fc
  .record({
    periodsPerYear: frequency,
    termPeriods: fc.integer({ min: 1, max: 48 }),
    growthRate: fc.double({ min: -0.5, max: 0.5, noNaN: true }),
    yieldRate: fc.double({ min: 0, max: 0.15, noNaN: true }),
    bowFactor: fc.double({ min: 0.2, max: 4, noNaN: true }),
    callBasis: fc.constantFrom('commitment' as const, 'unfunded' as const),
    terminalLiquidation: fc.boolean(),
    termExtensionYears: fc.option(fc.integer({ min: 0, max: 5 }), { nil: undefined }),
  })
  .chain((base) => {
    const termPeriods = base.termPeriods
    return ratesSumOne(termPeriods).map((rates) => ({
      periodsPerYear: base.periodsPerYear,
      fund_life: termPeriods / base.periodsPerYear,
      growthRate: base.growthRate,
      yieldRate: base.yieldRate,
      bowFactor: base.bowFactor,
      callSchedule: { basis: base.callBasis, rates },
      terminalLiquidation: base.terminalLiquidation,
      ...(base.termExtensionYears === undefined
        ? {}
        : { termExtensionYears: base.termExtensionYears }),
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
  .map(({ y, m, d }) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`)

export const arbTransactions: fc.Arbitrary<Transaction[]> = fc.array(
  fc.record({
    date: arbStartDate,
    type: fc.constantFrom<Transaction['type']>('call', 'distribution', 'nav'),
    amount: fc.integer({ min: 0, max: 5_000_000_00 }),
  }),
  { maxLength: 12 },
)
