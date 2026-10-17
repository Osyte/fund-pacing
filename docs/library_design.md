# Pacing Model Library — Technical Design

**Status:** Draft for review
**Date:** 2026-08-09
**Last updated:** 2026-10-17
**Companion to:** `library_spec.md` (product spec — read that first)

This document covers *how* the library is built: module structure, dependency choices, build and test strategy. It follows the recorded decisions in the spec's §6.

---

## 1. Two structural decisions that do most of the work

Nearly every defect listed in spec §7 traces to one of two root causes. Two design choices eliminate both classes outright.

### The recurrence exists exactly once

The Python has the TA step written out in four places (`run_ta_model_new_investment` deterministic loop, its Monte Carlo loop, `run_ta_model_existing_investment` forecast loop, plus the archive). They drifted — which is how the deterministic and simulated paths ended up using different call schedules, and how the off-by-one entered one copy but not the others.

Here, `engine/recurrence.ts` exports a single step function, shared by curve and
investment calculations:

```ts
stepPeriod(prev: PeriodState, input: StepInput): StepResult
```

It is unit-agnostic — it does not know whether it is working in fractions or in
cents. Curve and investment calculations use it with different units:

| Purpose | Instantiated with | Arithmetic |
|---|---|---|
| Curves — `buildSchedule` | `commitment = 1.0` | float |
| Investment forecasts — `project` / `reproject` | `commitment` in minor units | integer, rounded per period |

One implementation, two instantiations. There is no second copy to drift.

### A new-investment forecast is a reprojection without actuals

Spec invariant #3 asserts `reproject(c, f, [])` equals `project(c, f)`. Rather than test that two implementations agree, implement one:

```ts
export function project(config, fund) {
  return reproject(config, fund, []).revised;
}
```

The invariant becomes true by construction. This also guarantees the actual/forecast splice boundary is exercised by every single `project` test.

---

## 2. Module structure

```
src/
  index.ts                 public surface — re-exports only, no logic
  types.ts                 all public types; no imports from ./internal
  errors.ts                PacingError hierarchy

  engine/
    recurrence.ts          ← the single TA step function
    schedule.ts            curves and assumption exploration: buildSchedule
    reproject.ts           investment forecasts: reproject and project
    rates.ts               resolves callSchedule/distributionSchedule → per-period rates

  internal/
    calendar.ts            civil-date arithmetic; period-end generation
    money.ts               minor-unit rounding, proportional allocation
    metrics.ts             dpi / rvpi / tvpi
    guards.ts              validateConfig + assertion helpers
    term.ts                fund life in years → derived period count

  schema/
    index.ts               optional zod schemas — separate entry point
```

Calculation dependencies flow `index → engine → internal`. `types.ts` has no
runtime imports. The optional schema also uses the internal duration calculation.
`validateConfig` is explicitly re-exported from `internal/guards.ts`; other
internal helpers are not public exports.

`internal/term.ts` derives the period count from `fund_life * periodsPerYear`.
Guards reject durations that do not produce a positive safe integer before any
projection runs. Schedule generation, call-rate resolution, reprojection, and
the optional schema use that same conversion. This avoids a separate public
period count becoming a second source of truth.

### Two rules that keep the arithmetic honest

**Derived quantities are computed, never accumulated.** `unfunded` is `commitment − calledCumulative`, not a running subtraction. `dpi`/`rvpi`/`tvpi` are computed per period from cumulatives. Only genuinely additive quantities (`calledCumulative`, `distributedCumulative`) accumulate. This makes spec invariant #4 exact by construction rather than by luck, and stops rounding error from compounding across 40+ periods.

**Money rounding is centralized.** `money.ts` rounds half-away-from-zero to whole
minor units. Resolved calls, grown NAV, and distributions use this rounding;
closing NAV is then derived from those values. Commitment allocation assigns
the residual to the final nonzero weight so parts sum to the allocated total.

---

## 3. Runtime dependencies: zero

The spec's constraint holds, and nothing in the design pressures it.

| Temptation | Why it is not needed |
|---|---|
| `decimal.js` / `dinero.js` | Money is integer minor units. Exact through 2^53 (~$90tn in cents). The only real logic is rounding + residual allocation — about 30 lines in `money.ts` |
| `date-fns` / `luxon` / `dayjs` | We need quarter-end, half-year-end, year-end, and add-N-periods on **civil dates**. ~60 lines in `calendar.ts` |
| `zod` in the core | Shipped as an optional separate entry point instead — see §4 |

**On dates specifically**, `calendar.ts` never constructs a `Date`. `new Date('2025-03-31')` parses as UTC while `getFullYear()` reads local — which silently shifts the date by a day in negative-offset timezones. That would break spec invariant #7 (isomorphic determinism) in exactly the way that is hardest to reproduce: only for users west of UTC. The module parses `YYYY-MM-DD` into `{ y, m, d }` integers, does integer arithmetic, and formats back. No `Date`, no timezone, no locale.

---

## 4. The one optional dependency: zod, behind a separate entry point

`validateConfig` in the core is hand-rolled and dependency-free. But the application layer will need schemas anyway — to validate untrusted request bodies on the backend and drive form validation on the frontend. Shipping those from the library keeps them in sync with the types.

The reconciliation is a second entry point:

```ts
import { buildSchedule } from '@osyte/fund-pacing';          // dependency-free core
import { ModelConfigSchema } from '@osyte/fund-pacing/schema'; // opt-in, needs zod
```

`zod` is an **optional peer dependency**. A React app importing only the core never resolves it and never pays for it. A Node service that wants schema validation installs it explicitly.

Schema validation is an optional first stage, not a substitute for engine guards.
Dates are checked for ISO shape in Zod and calendar validity in the engine.
`validateConfig` handles model fields only. See spec D15 for the v0.x boundary.

---

## 5. Toolchain

All of these are dev-time only and contribute nothing to consumer bundles.

| Concern | Choice | Why |
|---|---|---|
| Language | **TypeScript 5.x**, strict | — |
| Build | **tsdown** | Builds ESM/CJS and matching type declarations |
| Test | **Vitest** | Runs all tests under Node and repeats the determinism suite under jsdom |
| Property tests | **fast-check** | Spec §5 lists nine *properties*, not examples. See §6 |
| Lint + format | **Biome** | One tool, one config, replaces ESLint + Prettier |
| Package correctness | **publint** + **@arethetypeswrong/cli** | Dual ESM/CJS `exports` maps are easy to get subtly wrong; these catch it in CI before publish |

No bundle-size guard, changesets release workflow, or Git hooks are currently
configured. Release verification is `npm run verify`; publishing is a separate
maintainer action. See `package.json` and `.github/workflows/ci.yml` for the
configured commands and CI steps.

### Relevant configured TypeScript flags

```jsonc
{
  "strict": true,
  "noUncheckedIndexedAccess": true,  // rates[i] is T | undefined — the off-by-one class, caught at compile time
  "exactOptionalPropertyTypes": true,
  "isolatedModules": true,
  "erasableSyntaxOnly": true,        // no enums/namespaces — types strip cleanly
  "verbatimModuleSyntax": true,
  "target": "ES2022",
  "module": "Preserve",
  "moduleResolution": "Bundler"
}
```

`noUncheckedIndexedAccess` deserves the callout: the original off-by-one bug was an unguarded `rc_rates[t-1]`. Under this flag, every schedule index access must be explicitly handled before use.

### package.json shape

```jsonc
{
  "name": "@osyte/fund-pacing",
  "type": "module",
  "sideEffects": false,
  "engines": { "node": ">=20" },
  "files": ["dist", "LICENSE", "CHANGELOG.md"],
  "exports": {
    ".": {
      "import": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
      "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" }
    },
    "./schema": {
      "import": { "types": "./dist/schema/index.d.ts", "default": "./dist/schema/index.js" },
      "require": { "types": "./dist/schema/index.d.cts", "default": "./dist/schema/index.cjs" }
    },
    "./package.json": "./package.json"
  },
  "peerDependencies":     { "zod": "^4.0.0" },
  "peerDependenciesMeta": { "zod": { "optional": true } }
}
```

This excerpt omits package metadata and development dependencies.
`sideEffects: false` lets bundlers drop unused exports. The package supports
Node 20+ and modern browser bundlers.

---

## 6. Testing strategy

Because the spec establishes that the test suite *is* the specification, tests are structured in four distinct layers rather than one undifferentiated folder.

**Property tests (`fast-check`) — eight generated invariants.**
`tests/invariants.test.ts` covers spec #1–6 and #8–9, with 300 generated cases per
property. #7 is covered by the cross-environment determinism suite below.
Generated configs exercise schedule indexing, conservation, NAV bounds,
commitment rescaling, and fractional fund lives. These catch combinations that
individual examples do not cover.

**Golden fixtures — the corrected examples.** `fixtures/` contains example CSV
inputs; `tests/fixtures.test.ts` defines equivalent model inputs and checks
expectations derived from corrected math. These tests do not parse the CSVs.
Matching the earlier Python's defective results is not the target (spec §7).

**Unit tests — the fiddly internals.** `calendar.ts` (leap years, month-end, Q1 boundaries) and `money.ts` (rounding at `.5`, residual allocation, negative amounts) carry disproportionate bug risk for their size.

**Cross-environment determinism — invariant #7.** The determinism suite runs in
both `node` and `jsdom`. Shared JSON snapshots retain exact integers and
canonicalize floating outputs at `1e-8`, avoiding failures from last-digit V8
differences. The other suites run under Node. jsdom provides browser-like globals;
it does not run a separate browser JavaScript engine.

`tests/fund-life.test.ts` covers duration conversion, invalid and fractional
durations, schema agreement, schedule length, and extension boundaries.
`tests/conventions.test.ts` covers K1, K5, K7, and K8; the extension example in
`tests/fund-life.test.ts` also covers K9. These tests lock the documented behavior
without changing the recurrence. Config generators include fractional years
aligned to the chosen frequency.

CI runs the matrix on Node 20/22/24, then `publint` and `attw` against the built artifact.

---

## 7. Error contract

Two distinct modes, so callers can pick per context:

```ts
validateConfig(config): { ok: true } | { ok: false; issues: ValidationIssue[] }  // never throws
buildSchedule(config)                                                            // throws PacingConfigError
```

`validateConfig` is non-throwing, for form validation and API boundaries where you want to collect and display every problem. The engine functions fail fast on invalid input — they are documented as requiring a valid config, and silently coercing bad input is precisely how the original `r/100 if r > 1 else r` ambiguity arose.

`PacingConfigError` has code `INVALID_CONFIG` and an `issues` array with paths and
individual codes such as `INVALID_FUND_LIFE`, `RATE_OUT_OF_RANGE`, and
`SCHEDULE_TOO_LONG`. `PacingInputError` carries its own code and path, such as
`INVALID_DATE` at `actuals[0].date` or `INVALID_COMMITMENT` at `commitment`.
Consumers can map these to messages without matching error text.

Public model fields and input transaction arrays are readonly. The library never
mutates inputs. Output rows are readonly; `project` and `reproject` also expose
readonly arrays. These are TypeScript guarantees, not runtime freezing. Empty
actuals currently reuse the baseline array as revised (spec D16).

---

## 8. Resolved spec gaps

Working through the implementation surfaced items the spec did not settle. All are now decided and recorded in `library_spec.md`; the implementation consequences are noted here.

| Gap | Decision | Where it lands in the code |
|---|---|---|
| **G1** — `distributionSchedule` had no basis | Symmetric with `CallSchedule`: `basis: 'commitment' \| 'nav'` (spec D6) | `engine/rates.ts` resolves all four basis combinations to per-period rates before the recurrence runs |
| **G2** — compounding convention unspecified | Geometric: `(1 + annual)^(1/periodsPerYear) − 1` (spec D7) | `engine/rates.ts`, applied once to `growthRate` and `yieldRate`. The recurrence only ever sees per-period rates |
| **G3** — can calls exceed commitment | Yes; `unfunded` goes negative, `overcalled` flags it (spec D8) | No clamp in `recurrence.ts`. `unfunded` stays derived, so conservation (§5.4) is exact by construction |

G1 and G2 both land in `engine/rates.ts` rather than in the recurrence itself. That is deliberate: the recurrence consumes a plain per-period rate array and knows nothing about bases or annualisation, which keeps the single-source-of-truth property from §1 intact as conventions evolve.

G3 is the reason `unfunded` must be derived rather than accumulated. A clamped running subtraction cannot represent overcalling; `commitment − calledCumulative` represents it for free.

### Editorial items applied

- `VariancePeriod`, `ValidationResult`, and `ValidationIssue` are now defined in spec §3.
- `termExtensionYears` added to `ModelConfig`; it takes effect only in `reproject`, since only actuals can outlive the term.
- Field name is `terminalLiquidation` (D3 had a typo).
- Node 20+ throughout (18 is EOL).
- **Multiple NAV observations in one period:** the last by date wins, ties broken by input order. Deterministic and matches the Python's `.iloc[-1]`.

---

## 9. Strategy profiles belong to the consuming application

The earlier Python's `strategy_defaults.py` is not included in this repository.
There is no exported strategy catalog or config-resolution module. Applications
can own strategy presets and pass a fully resolved `ModelConfig` to the library.
Adding reference profiles as repository data remains separate future work.
