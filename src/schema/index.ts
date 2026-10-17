/**
 * Optional zod schemas, for validating untrusted input at an API boundary or
 * driving form validation.
 *
 * `zod` is an optional peer dependency. Importing the core entry point never
 * resolves it — only `@osyte/fund-pacing/schema` does.
 */

import { z } from 'zod'
import { termPeriodsFor } from '../internal/term.js'
import type { ModelConfig } from '../types.js'

const rate = z.number().finite().min(0).max(1)
const rates = z.array(rate)

export const CommitmentBasisScheduleSchema = z.object({
  basis: z.literal('commitment'),
  rates,
})

export const UnfundedBasisScheduleSchema = z.object({
  basis: z.literal('unfunded'),
  rates,
})

export const NavBasisScheduleSchema = z.object({
  basis: z.literal('nav'),
  rates,
})

export const CallScheduleSchema = z.discriminatedUnion('basis', [
  CommitmentBasisScheduleSchema,
  UnfundedBasisScheduleSchema,
])

export const DistributionScheduleSchema = z.discriminatedUnion('basis', [
  CommitmentBasisScheduleSchema,
  NavBasisScheduleSchema,
])

export const ModelConfigSchema = z
  .object({
    periodsPerYear: z.union([z.literal(1), z.literal(2), z.literal(4)]),
    fund_life: z.number().finite().positive(),
    growthRate: z.number().finite().gt(-1),
    yieldRate: z.number().finite().min(0),
    bowFactor: z.number().finite().positive(),
    callSchedule: CallScheduleSchema,
    distributionSchedule: DistributionScheduleSchema.optional(),
    terminalLiquidation: z.boolean(),
    termExtensionYears: z.number().finite().min(0),
  })
  .refine((c) => Number.isSafeInteger(termPeriodsFor(c)) && termPeriodsFor(c) >= 1, {
    message:
      'fund_life * periodsPerYear must be a positive safe integer; partial periods are not rounded',
    path: ['fund_life'],
  })
  .refine((c) => c.callSchedule.rates.length === termPeriodsFor(c), {
    message: 'callSchedule.rates must contain exactly one rate per term period',
    path: ['callSchedule', 'rates'],
  })
  .refine(
    (c) =>
      c.callSchedule.basis !== 'commitment' ||
      Math.abs(c.callSchedule.rates.reduce((a, b) => a + b, 0) - 1) <= 1e-9,
    {
      message: 'commitment-basis callSchedule.rates must sum to 1',
      path: ['callSchedule', 'rates'],
    },
  )
  .transform((config): ModelConfig => {
    const { distributionSchedule, ...required } = config
    return distributionSchedule === undefined ? required : { ...required, distributionSchedule }
  })

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')

export const FundTermsSchema = z.object({
  commitment: z.number().int().positive(),
  startDate: isoDate,
})

export const TransactionSchema = z.object({
  date: isoDate,
  type: z.enum(['call', 'distribution', 'nav']),
  amount: z.number().int().min(0),
})

export const TransactionsSchema = z.array(TransactionSchema)
