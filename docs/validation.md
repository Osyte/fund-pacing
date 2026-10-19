# Validation and errors

[Configuration](configuration.md) · [User guide](user-guide.md) · [Results](results.md)

## Reuse the model's config validation

Use `validateConfig` to display structured issues in your application rather than
duplicating the engine's rules. It returns `{ ok: true }` or
`{ ok: false, issues }` and defensively handles malformed runtime config shapes.
Each issue has a field `path`, a machine-readable `code`, and a `message`.

This complete example deliberately has an invalid duration:

```ts
import {
  validateConfig,
  project,
  PacingConfigError,
  PacingInputError,
  type ModelConfig,
} from '@osyte/fund-pacing'

const config: ModelConfig = {
  fund_life: 0,
  periodsPerYear: 4,
  growthRate: 0.15,
  yieldRate: 0,
  bowFactor: 2.5,
  callSchedule: { basis: 'commitment', rates: [1] },
  terminalLiquidation: true,
  termExtensionYears: 3,
}

const validation = validateConfig(config)
if (!validation.ok) {
  console.log(validation.issues[0]?.path) // 'fund_life'
  console.log(validation.issues[0]?.code) // 'INVALID_FUND_LIFE'
}
```

The public TypeScript parameter is `ModelConfig`; the runtime guards also handle
structurally incomplete objects arriving through JavaScript or untyped boundaries.
The function does not coerce strings, percent-valued rates, or missing fields.

## Engine validation happens automatically

You can call `buildSchedule`, `project`, or `reproject` directly. They check config
before calculating and throw `PacingConfigError` for invalid config. `project`
and `reproject` also validate fund terms; `reproject` validates transactions.

```ts
try {
  project(config, { commitment: 1_000_000_000, startDate: '2024-01-15' })
} catch (error) {
  if (error instanceof PacingConfigError) {
    console.log(error.issues) // Structured configuration issues
  } else if (error instanceof PacingInputError) {
    console.log(error.code, error.path) // A fund or transaction input error
  } else {
    throw error
  }
}
```

| Error | What to inspect |
|---|---|
| `PacingConfigError` | Top-level code `INVALID_CONFIG`; individual codes, paths, and messages in `issues`. |
| `PacingInputError` | Its own `code` and `path`, such as `INVALID_DATE` at `actuals[0].date` or `INVALID_COMMITMENT` at `commitment`. |
| `PacingError` | Shared base class for the library's errors. |

Examples of config issue codes are `INVALID_FUND_LIFE`, `INVALID_FREQUENCY`,
`RATE_OUT_OF_RANGE`, `SCHEDULE_TOO_SHORT`, `SCHEDULE_TOO_LONG`,
`RATE_SUM_BELOW_COMMITMENT`, and `RATE_SUM_EXCEEDS_COMMITMENT`.
Use codes and paths for application logic; avoid matching error-message text.

`validateConfig` does not receive fund terms or transactions, so it cannot check
their dates or flag pre-start activity. Fund commitment must be a positive safe
integer in minor units. Transaction amounts must be non-negative safe integers. Dates must be
real ISO calendar dates, such as `2024-02-29` rather than `2023-02-29`.

Malformed fund or transaction containers produce `PacingInputError`, including
`INVALID_FUND_TERMS`, `INVALID_TRANSACTIONS`, and `INVALID_TRANSACTION`. Sparse
schedule and transaction arrays are rejected. The engine throws `NUMERIC_OVERFLOW`
instead of returning non-finite or unsafe monetary results, and
`DATE_RANGE_EXCEEDED` if a projection would produce dates after year 9999.

## Optional Zod schemas

Install the [optional Zod peer dependency](installation.md#optional-zod-schemas)
before importing `/schema`. These exports can help validate input at an
application boundary or drive forms:

```ts
import { ModelConfigSchema, TransactionsSchema } from '@osyte/fund-pacing/schema'

const schemaValidation = ModelConfigSchema.safeParse(config)
console.log(schemaValidation.success) // false: the example's fund_life is 0

const parsedActuals = TransactionsSchema.parse([
  { date: '2024-03-31', type: 'call', amount: 100_000_000 },
])
```

There are also `FundTermsSchema`, `TransactionSchema`, and individual schedule
schemas. `.parse` throws a Zod error on schema failure; `.safeParse` returns a
success/failure result. These are separate from the library's engine errors.

**Schema success does not guarantee engine validity.** Date schemas check the
`YYYY-MM-DD` shape only. An impossible date such as `2023-02-29` passes the schema
but engine entry points reject it with `PacingInputError` (`INVALID_DATE`). Some
cross-field checks also remain engine-authoritative; see [K7](known_issues.md#k7--accepted-date-schemas-check-shape-engine-checks-calendar-validity).

`ModelConfigSchema` normalizes an absent or explicitly undefined
`distributionSchedule` by omitting that property from the output. Parsed configs
are directly assignable to `ModelConfig`, including under TypeScript's
`exactOptionalPropertyTypes`. A successful parse still does not replace the
engine's semantic validation contract.

## Warnings in consuming applications

The engine does not log or return warnings. Pre-start transactions are accepted
into period 0. Applications should flag these dates for review; see the
[user-guide example](user-guide.md#pre-start-transactions). Missing historical
calls and distributions are accepted as zero, not automatically diagnosed as
incomplete data. Applications own completeness checks for the history they supply.
