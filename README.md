# @osyte/fund-pacing

[![CI](https://github.com/osyte/fund-pacing/actions/workflows/ci.yml/badge.svg)](https://github.com/osyte/fund-pacing/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@osyte/fund-pacing)](https://www.npmjs.com/package/@osyte/fund-pacing)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> **Status: pre-1.0.** The three layers are implemented and tested. The API may still shift before the first stable release. Accepted v0.x conventions and future design questions are recorded in [docs/known_issues.md](docs/known_issues.md).

Takahashi–Alexander pacing model for private fund cash flows. Stateless, isomorphic, zero runtime dependencies.

Answers three questions, in increasing order of specificity:

| | Question | Function | Needs |
|---|---|---|---|
| 1 | What does the cash-flow curve look like? | `buildSchedule` | model parameters only |
| 2 | What are the actual dates and amounts? | `project` | + commitment and start date |
| 3 | Given what has happened, what now? | `reproject` | + observed transactions |

These are imported library functions. A consuming application calls them directly;
there is no HTTP server to start. `buildSchedule` is an optional preview: you can
call `project` or `reproject` directly without building a schedule first.

## Install

```bash
npm install @osyte/fund-pacing
```

Node 20+ and modern browsers. Ships ESM and CJS with type declarations.

## Usage

### Layer 1 — periods and percentages

```ts
import { buildSchedule, type ModelConfig } from '@osyte/fund-pacing'

const config = {
  periodsPerYear: 4,
  fund_life: 10,           // years; 10 × 4 = 40 quarterly periods
  growthRate: 0.15,         // per annum
  yieldRate: 0,
  bowFactor: 2.5,
  callSchedule: {
    basis: 'unfunded',
    rates: [0.25, 0.30, 0.40, 0.20, ...Array(36).fill(0)],
  },
  terminalLiquidation: true,
  termExtensionYears: 3,
} satisfies ModelConfig

buildSchedule(config)
// [{ index: 0, callRate: 0.25, calledFraction: 0.25, ... },
//  { index: 1, callRate: 0.30, calledFraction: 0.475, ... }, ...]
```

Dimensionless: no money, no dates. Cheap enough to run on every keystroke.

### Layer 2 — dates and amounts

```ts
import { project } from '@osyte/fund-pacing'

const fund = {
  commitment: 10_000_000_00,   // $10m in cents
  startDate: '2024-01-15',
}

const rows = project(config, fund)

rows[0]
// { index: 0, periodEnd: '2024-03-31', source: 'forecast',
//   called: 250000000, distributed: 0, unfunded: 750000000,
//   nav: 250000000, dpi: 0, rvpi: 1, tvpi: 1, ... }
```

### Layer 3 — revised forecast from actuals

```ts
import { reproject } from '@osyte/fund-pacing'

const actuals = [
  { date: '2024-03-31', type: 'call',         amount: 2_000_000_00 },
  { date: '2024-09-30', type: 'call',         amount: 1_500_000_00 },
  { date: '2025-03-31', type: 'distribution', amount:   400_000_00 },
  { date: '2025-03-31', type: 'nav',          amount: 3_600_000_00 },
] satisfies import('@osyte/fund-pacing').Transaction[]

const result = reproject(config, fund, actuals)
const { baseline, revised, variance, asOf } = result
```

`actuals` is the **complete** transaction set, not a delta — so add, edit, and delete are all the same call, and the function stays pure. The persistence layer owns the list.

- Periods up to the last transaction are `source: 'actual'`. Calls and distributions are summed per period; the latest NAV by date wins, with input order breaking ties.
- Missing calls and distributions in those periods are zero; missing NAV is modeled from prior NAV, growth, and supplied flows. Forecast flows are not substituted for missing actuals.
- A reported `nav` overrides the modelled one and becomes the base for everything forward.
- The forecast resumes at the fund's actual age, from actual unfunded, NAV, and PIC.
- Commitment-basis call forecasts are rescaled across remaining scheduled calls to reach commitment. If no positive scheduled calls remain, no new call periods are invented. If actual calls already exceed commitment, future calls are zero.
- `baseline` is the untouched T=0 forecast, so forecast-accuracy tracking is a first-class output rather than something you reconstruct.

`asOf` is the **end of the period** containing the latest transaction of any type,
not necessarily the transaction date. Missing historical activity means zero,
not unknown: a NAV-only input does not infer previous paid-in capital.

### Configuration reference

All fields are required except `distributionSchedule`. The engine supplies no
default fund duration, growth, yield, bow factor, or liquidation setting.

| Field | Unit and constraint |
|---|---|
| `fund_life` | Years, finite and > 0; multiplied by frequency it must produce a positive safe integer period count |
| `periodsPerYear` | `1` annual, `2` semiannual, or `4` quarterly |
| `growthRate` | Annual decimal, finite and > -1; negative growth and values above 1 are permitted |
| `yieldRate` | Annual decimal, finite and >= 0 |
| `bowFactor` | Finite and > 0; calibrated for the selected frequency |
| `callSchedule` | Explicit `commitment` or `unfunded` basis; one decimal rate per derived period |
| `distributionSchedule` | Optional `commitment` or `nav` basis; replaces the bow/yield distribution curve |
| `terminalLiquidation` | Boolean; `true` distributes remaining assets in the final forecast period |
| `termExtensionYears` | Finite years >= 0; extra forecast duration after actuals outlive the original term |

### Reading the output

`called`, `distributed`, `netCashFlow`, `nav`, `unfunded`, and the cumulative
amounts are integer minor units. From the investor's perspective,
`netCashFlow = distributed - called`. Multiples are dimensionless:

| Multiple | Calculation |
|---|---|
| DPI | Cumulative distributions / cumulative calls |
| RVPI | NAV / cumulative calls |
| TVPI | DPI + RVPI |

All three multiples are zero when cumulative calls are zero. They are not
annualized returns. `source: 'actual'` describes the historical period; its NAV
can still be modeled when no NAV observation was supplied.

## Conventions

These are enforced, not assumed. Getting them wrong is the single largest source of defects in this domain.

| Concept | Representation |
|---|---|
| Dates | ISO `YYYY-MM-DD` strings. Never `Date` objects |
| Money | Integer **minor units** (cents) as `number` |
| Schedule rates | Decimals in `[0, 1]` — `0.25` is 25%; annual growth/yield use the constraints above |
| Periods | Zero-indexed; period 0 is the first modeled cash-flow period |

**Schedule basis is explicit and never inferred.** A rate can mean two different things, and conflating them silently under-calls by a third:

```text
callSchedule: { basis: 'commitment', rates: [...] }  // shares of total commitment; must sum to 1
callSchedule: { basis: 'unfunded',   rates: [...] }  // rate on remaining unfunded

distributionSchedule: { basis: 'commitment', rates: [...] }  // share of commitment
distributionSchedule: { basis: 'nav',        rates: [...] }  // fraction of prevailing NAV
```

**Fund life is supplied in years.** The library derives the number of periods as
`fund_life * periodsPerYear`: 10 years produces 10 annual, 20 semiannual, or 40
quarterly periods. Fractional years are allowed when they produce a positive
safe integer number of periods (for example, 2.5 years quarterly is 10 periods).
Partial periods are rejected rather than rounded.

`callSchedule.rates` must contain exactly `fund_life * periodsPerYear` entries.
Use explicit `0` rates for periods with no calls. Commitment-basis call schedules
must sum to `1`. To migrate from `termPeriods`, set
`fund_life = termPeriods / periodsPerYear` and remove `termPeriods`.

For example, the previous `{ termPeriods: 16, periodsPerYear: 4 }` becomes
`{ fund_life: 4, periodsPerYear: 4 }`; keep the same 16 schedule entries.
A 2.5-year quarterly fund has 10 entries. A 2.5-year annual fund is rejected
because the model does not create half an annual period.

Explicit distribution schedules do not require full-term length: missing entries
resolve to zero, and entries beyond the modeled horizon are unused. Each rate
must be in `[0, 1]`; commitment-basis distribution rates must sum to at most 1.
This differs from the exact length and full-commitment rules for **call** schedules.
Terminal liquidation, when enabled, overrides the scheduled final distribution.

Note that an `unfunded`-basis schedule generally does *not* call 100% — a `[0.30, 0.35, 0.40, 0.35, 0.20]` profile leaves 14.2% permanently uncalled. That is intended and tested.

**Annual rates convert geometrically**: `(1 + annual)^(1/periodsPerYear) − 1`. Four quarterly periods compound back to the stated annual rate.

**Calls may exceed commitment.** Recallable capital is normal, so `unfunded` is permitted to go negative and `overcalled` flags it. Conservation (`unfunded + calledCumulative === commitment`) holds exactly in every period.

### Accepted v0.x conventions

- **K1 — Bow is calibrated per frequency.** `bowFactor` applies at the selected
  annual, semiannual, or quarterly frequency; it is not automatically normalized
  when frequency changes. Growth and yield still convert geometrically from
  annual rates. Recalibrate bow when changing frequency. An explicit
  `distributionSchedule` overrides bow and yield.
- **K5 — Pre-start transactions enter period 0.** Calls and distributions are
  summed; the latest NAV by date wins, with input order breaking equal-date ties.
  These transactions can make period 0 actual. The engine does not emit warnings.
  A consuming application should flag dates before `startDate` for review:

  ```ts
  const preStartTransactions = actuals.filter(tx => tx.date < fund.startDate)
  // Surface these in the application's validation UI before calling reproject.
  // Dates must first be validated ISO YYYY-MM-DD strings for this comparison.
  ```

- **K7 — Schema success is not full engine validation.** Zod checks date format;
  the engine checks calendar validity and enforces the calculation constraints.
  Handle engine validation errors even after a successful schema parse.
- **K8 — Empty actuals may share output arrays.** `baseline` and `revised` may be
  the same readonly array. `asOf` is `null` and variance has zero-delta rows.
  Readonly is a TypeScript contract, not runtime freezing. Copy arrays and rows
  before editing them, for example `result.revised.map(row => ({ ...row }))`.
- **K9 — Variance stops at the baseline horizon.** Actuals can extend `revised`,
  but `baseline` retains its original length. Variance is `revised - baseline`
  over their shared periods. Extended periods have no variance rows, rather than
  a zero baseline or zero variance.

See [the recorded decisions](docs/library_spec.md#6-recorded-decisions-and-v0x-conventions)
for rationale and [known issues](docs/known_issues.md) for post-v0.1 questions.

## Validation

Two modes, so you can pick per context:

```ts
import { PacingConfigError, PacingInputError, validateConfig } from '@osyte/fund-pacing'

const invalidConfig = { ...config, fund_life: 0 }
const validation = validateConfig(invalidConfig) // non-throwing config checks
if (!validation.ok) console.log(validation.issues)
// [{ path: 'fund_life', code: 'INVALID_FUND_LIFE', message: '...' }]

try {
  project(invalidConfig, fund)
} catch (error) {
  if (error instanceof PacingConfigError) console.log(error.issues)
  else if (error instanceof PacingInputError) console.log(error.code, error.path)
  else throw error
}
```

Engine functions fail fast — silently coercing bad input is exactly how the ambiguities this library exists to fix arose in the first place.

### Optional zod schemas

For validating untrusted request bodies or driving form validation:

```ts
import { ModelConfigSchema, TransactionsSchema } from '@osyte/fund-pacing/schema'

const schemaValidation = ModelConfigSchema.safeParse(config)
if (!schemaValidation.success) throw schemaValidation.error
const parsedActuals = TransactionsSchema.parse(actuals)
const schemaCheckedResult = reproject(config, fund, parsedActuals)
```

`zod` is an **optional peer dependency**. The core entry point never resolves it, so a frontend importing only `buildSchedule` pays nothing for it.

For example, `2023-02-29` has the correct shape and passes the date schemas, but
`project` or `reproject` rejects it with `PacingInputError` (`INVALID_DATE`).
`validateConfig` checks model configuration only; it does not validate fund or
transaction dates. Engine entry points validate their inputs before calculating.

The example keeps the explicitly typed `config`. If you construct a `ModelConfig`
from a schema result with TypeScript's `exactOptionalPropertyTypes` enabled, omit
an absent `distributionSchedule` property rather than retaining an explicit
`undefined`: the schema's inferred optional type is wider than the core type.

## What this library does not do

No persistence, no I/O, no state. It does not read files, call APIs, touch a database, or hold module-level variables. Storage, caching, portfolio rollups, auth, scheduling, CSV parsing, and charting belong to the application above it.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security reports go through [SECURITY.md](SECURITY.md).

## Development

```bash
npm run typecheck     # tsc --noEmit
npm test              # vitest, node + jsdom projects
npm run lint          # biome
npm run build         # tsdown -> dist/ (ESM + CJS + .d.ts)
npm run check:package # publint + arethetypeswrong
npm run verify        # all of the above
```

### Tests are the specification

The prior Python implementation and its documentation disagree on units,
defaults, and curve shape. `docs/library_spec.md` §5 states nine invariants:
eight are covered by generated properties in `tests/invariants.test.ts`, and #7
by the determinism suite. Config generators include fractional fund lives that
align to whole periods. Named regression examples cover the release fixes and
accepted conventions.

`tests/determinism.test.ts` runs under Node and jsdom against shared snapshots.
Integers are exact; floating outputs are canonicalized at `1e-8` for comparison.
jsdom supplies browser-like globals, rather than a separate browser engine.

## Documentation

- [`docs/library_spec.md`](docs/library_spec.md) — product spec: purpose, domain model, API, the nine invariants, and the logged decisions
- [`docs/library_design.md`](docs/library_design.md) — technical design: module structure, dependency rationale, toolchain
- [`docs/known_issues.md`](docs/known_issues.md) — accepted v0.x conventions, resolved issues, and post-v0.1 questions, numbered K1–K9
- [`fixtures/`](fixtures/) — schedule examples and a synthetic transaction history, for regression fixtures
