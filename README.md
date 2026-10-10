# @osyte/fund-pacing

[![CI](https://github.com/osyte/fund-pacing/actions/workflows/ci.yml/badge.svg)](https://github.com/osyte/fund-pacing/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@osyte/fund-pacing)](https://www.npmjs.com/package/@osyte/fund-pacing)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> **Status: pre-1.0.** The three layers are implemented and tested. The API may still shift before the first stable release, and a handful of model conventions are documented as open in [docs/known_issues.md](docs/known_issues.md).

Takahashi–Alexander pacing model for private fund cash flows. Stateless, isomorphic, zero runtime dependencies.

Answers three questions, in increasing order of specificity:

| | Question | Function | Needs |
|---|---|---|---|
| 1 | What does the cash-flow curve look like? | `buildSchedule` | model parameters only |
| 2 | What are the actual dates and amounts? | `project` | + commitment and start date |
| 3 | Given what has happened, what now? | `reproject` | + observed transactions |

Each is a pure function. Each builds on the previous one, so Layer 1 is usable on its own — a UI can render a pacing curve from a parameter form before any commitment is entered.

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
  termPeriods: 40,          // 10 years, quarterly
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

const rows = project(config, {
  commitment: 10_000_000_00,   // $10m in cents
  startDate: '2024-01-15',
})

rows[0]
// { index: 0, periodEnd: '2024-03-31', source: 'forecast',
//   called: 250000000, distributed: 0, unfunded: 750000000,
//   nav: 250000000, dpi: 0, rvpi: 1, tvpi: 1, ... }
```

### Layer 3 — revised forecast from actuals

```ts
import { reproject } from '@osyte/fund-pacing'

const { baseline, revised, variance, asOf } = reproject(
  config,
  { commitment: 10_000_000_00, startDate: '2024-01-15' },
  [
    { date: '2024-03-31', type: 'call',         amount: 2_000_000_00 },
    { date: '2024-09-30', type: 'call',         amount: 1_500_000_00 },
    { date: '2025-03-31', type: 'distribution', amount:   400_000_00 },
    { date: '2025-03-31', type: 'nav',          amount: 3_600_000_00 },
  ],
)
```

`actuals` is the **complete** transaction set, not a delta — so add, edit, and delete are all the same call, and the function stays pure. The persistence layer owns the list.

- Periods up to the last transaction are `source: 'actual'` and reproduce the supplied amounts verbatim.
- A reported `nav` overrides the modelled one and becomes the base for everything forward.
- The forecast resumes at the fund's actual age, from actual unfunded, NAV, and PIC.
- Commitment-basis call forecasts are rescaled after actuals so total called capital returns to commitment, unless actual calls already exceed commitment.
- `baseline` is the untouched T=0 forecast, so forecast-accuracy tracking is a first-class output rather than something you reconstruct.

## Conventions

These are enforced, not assumed. Getting them wrong is the single largest source of defects in this domain.

| Concept | Representation |
|---|---|
| Dates | ISO `YYYY-MM-DD` strings. Never `Date` objects |
| Money | Integer **minor units** (cents) as `number` |
| Rates | Decimals — `0.25` is 25%. Values outside `[0, 1]` are rejected, never coerced |
| Periods | Zero-indexed; period 0 is the first modeled cash-flow period |

**Schedule basis is explicit and never inferred.** A rate can mean two different things, and conflating them silently under-calls by a third:

```ts
callSchedule: { basis: 'commitment', rates: [...] }  // share of total commitment
callSchedule: { basis: 'unfunded',   rates: [...] }  // rate on remaining unfunded

distributionSchedule: { basis: 'commitment', rates: [...] }  // share of commitment
distributionSchedule: { basis: 'nav',        rates: [...] }  // fraction of prevailing NAV
```

`callSchedule.rates` must contain exactly one rate per `termPeriods` period. Use explicit `0` rates for periods with no calls.

Note that an `unfunded`-basis schedule generally does *not* call 100% — a `[0.30, 0.35, 0.40, 0.35, 0.20]` profile leaves 14.2% permanently uncalled. That is intended and tested.

**Annual rates convert geometrically**: `(1 + annual)^(1/periodsPerYear) − 1`. Four quarterly periods compound back to the stated annual rate.

**Calls may exceed commitment.** Recallable capital is normal, so `unfunded` is permitted to go negative and `overcalled` flags it. Conservation (`unfunded + calledCumulative === commitment`) holds exactly in every period.

## Validation

Two modes, so you can pick per context:

```ts
import { validateConfig } from '@osyte/fund-pacing'

const result = validateConfig(config)   // never throws; collects every issue
if (!result.ok) console.log(result.issues)
// [{ path: 'callSchedule.rates[0]', code: 'RATE_OUT_OF_RANGE', message: '...' }]

project(badConfig, fund)                // throws PacingConfigError
```

Engine functions fail fast — silently coercing bad input is exactly how the ambiguities this library exists to fix arose in the first place.

### Optional zod schemas

For validating untrusted request bodies or driving form validation:

```ts
import { ModelConfigSchema, TransactionsSchema } from '@osyte/fund-pacing/schema'
```

`zod` is an **optional peer dependency**. The core entry point never resolves it, so a frontend importing only `buildSchedule` pays nothing for it.

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

The prior Python implementation and its documentation disagree on units, defaults, and curve shape, so there is no authoritative source to port from. `docs/library_spec.md` §5 states nine invariants; `tests/invariants.test.ts` verifies them as *properties* over generated configs rather than hand-picked examples. This is not incidental — the property tests caught two real bugs on their first run (per-period rounding drift, and negative calls after overcalling) that example-based tests would have missed.

`tests/determinism.test.ts` runs under both Node and jsdom against shared snapshots, so a timezone- or locale-sensitive divergence fails the build.

## Documentation

- [`docs/library_spec.md`](docs/library_spec.md) — product spec: purpose, domain model, API, the nine invariants, and the logged decisions
- [`docs/library_design.md`](docs/library_design.md) — technical design: module structure, dependency rationale, toolchain
- [`docs/known_issues.md`](docs/known_issues.md) — open model conventions and known validation gaps, numbered K1–K9
- [`fixtures/`](fixtures/) — schedule examples and a synthetic transaction history, for regression fixtures
