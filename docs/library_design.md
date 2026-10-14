# Pacing Model Library — Technical Design

**Status:** Draft for review
**Date:** 2026-08-09
**Companion to:** `library_spec.md` (product spec — read that first)

This document covers *how* the library is built: module structure, dependency choices, build and test strategy. It assumes the spec's decisions (D1–D5) as settled.

---

## 1. Two structural decisions that do most of the work

Nearly every defect listed in spec §7 traces to one of two root causes. Two design choices eliminate both classes outright.

### The recurrence exists exactly once

The Python has the TA step written out in four places (`run_ta_model_new_investment` deterministic loop, its Monte Carlo loop, `run_ta_model_existing_investment` forecast loop, plus the archive). They drifted — which is how the deterministic and simulated paths ended up using different call schedules, and how the off-by-one entered one copy but not the others.

Here, `engine/recurrence.ts` exports a single step function, and all layers drive it:

```ts
stepPeriod(state: PeriodState, rates: PeriodRates, params: StepParams): PeriodState
```

It is unit-agnostic — it does not know whether it is working in fractions or in cents. That is what lets Layer 1 and Layers 2/3 share it:

| Layer | Instantiated with | Arithmetic |
|---|---|---|
| 1 — `buildSchedule` | `commitment = 1.0` | float |
| 2/3 — `project` / `reproject` | `commitment` in minor units | integer, rounded per period |

One implementation, two instantiations. There is no second copy to drift.

### Layer 2 is a special case of Layer 3

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
    schedule.ts            Layer 1: buildSchedule
    reproject.ts           Layer 3: reproject (and project, as a wrapper)
    rates.ts               resolves callSchedule/distributionSchedule → per-period rates

  internal/
    calendar.ts            civil-date arithmetic; period-end generation
    money.ts               minor-unit rounding, proportional allocation
    metrics.ts             dpi / rvpi / tvpi
    guards.ts              validateConfig + assertion helpers

  schema/
    index.ts               optional zod schemas — separate entry point
```

Dependency direction is strictly one-way: `index → engine → internal`. `types.ts` is a leaf. No cycles, and `internal/` is never re-exported, so it stays free to change without a major version.

### Two rules that keep the arithmetic honest

**Derived quantities are computed, never accumulated.** `unfunded` is `commitment − calledCumulative`, not a running subtraction. `dpi`/`rvpi`/`tvpi` are computed per period from cumulatives. Only genuinely additive quantities (`calledCumulative`, `distributedCumulative`) accumulate. This makes spec invariant #4 exact by construction rather than by luck, and stops rounding error from compounding across 40+ periods.

**Rounding happens once, at the period boundary.** `money.ts` owns it: round half-away-from-zero to whole minor units, and where a total is split across periods, assign the residual to the final period so parts always sum to the whole.

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
import { buildSchedule } from '@osyte/fund-pacing';          // zero deps, ~4kB
import { ModelConfigSchema } from '@osyte/fund-pacing/schema'; // opt-in, needs zod
```

`zod` is an **optional peer dependency**. A React app importing only the core never resolves it and never pays for it. A Node service that wants schema validation installs it explicitly.

If you would rather not maintain the surface, drop `src/schema/` — nothing in the core depends on it.

---

## 5. Toolchain

All of these are dev-time only and contribute nothing to consumer bundles.

| Concern | Choice | Why |
|---|---|---|
| Language | **TypeScript 5.x**, strict | — |
| Build | **tsdown** | Rolldown-based successor to tsup; dual ESM/CJS + `.d.ts` in one pass. Swap to `tsup` if you want the more conservative option — config shape is near-identical |
| Test | **Vitest** | Native ESM + TS, no transform config, runs the same suite under Node and browser environments |
| Property tests | **fast-check** | Spec §5 lists eight *properties*, not examples. See §6 |
| Lint + format | **Biome** | One tool, one config, replaces ESLint + Prettier |
| Package correctness | **publint** + **@arethetypeswrong/cli** | Dual ESM/CJS `exports` maps are easy to get subtly wrong; these catch it in CI before publish |
| Bundle size guard | **size-limit** | Turns "zero dependencies" from an intention into a CI failure |
| Releases | **changesets** | Standard changelog + version workflow for npm libraries |
| Hooks | **simple-git-hooks** + **lint-staged** | Lighter than husky |

### tsconfig flags worth setting explicitly

```jsonc
{
  "strict": true,
  "noUncheckedIndexedAccess": true,  // rates[i] is T | undefined — the off-by-one class, caught at compile time
  "exactOptionalPropertyTypes": true,
  "isolatedDeclarations": true,      // forces explicit return types on exports; fast, portable .d.ts
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
  "files": ["dist"],
  "exports": {
    ".":            { "types": "./dist/index.d.ts",  "import": "./dist/index.js",  "require": "./dist/index.cjs" },
    "./schema":     { "types": "./dist/schema/index.d.ts", "import": "./dist/schema/index.js", "require": "./dist/schema/index.cjs" },
    "./package.json": "./package.json"
  },
  "peerDependencies":     { "zod": "^4" },
  "peerDependenciesMeta": { "zod": { "optional": true } },
  "dependencies": {}
}
```

`sideEffects: false` is what lets bundlers drop unused exports. `engines: node >=20` — Node 18 reached end-of-life in April 2025.

---

## 6. Testing strategy

Because the spec establishes that the test suite *is* the specification, tests are structured in four distinct layers rather than one undifferentiated folder.

**Property tests (`fast-check`) — the eight invariants.** Spec §5 is written as universally-quantified statements, so they should be verified that way. Generate arbitrary valid configs and assert conservation, non-negative NAV, one-to-one schedule indexing, and so on across thousands of cases. This is where the real assurance comes from — example tests would only confirm the cases we already thought of.

**Golden fixtures — the corrected examples.** The `data/` CSVs, with expected values derived from corrected math. Spec §7 is explicit that matching current Python output would mean failure; these fixtures are the guard against accidentally reintroducing a ported bug.

**Unit tests — the fiddly internals.** `calendar.ts` (leap years, month-end, Q1 boundaries) and `money.ts` (rounding at `.5`, residual allocation, negative amounts) carry disproportionate bug risk for their size.

**Cross-environment determinism — invariant #7.** A Vitest workspace with two projects (`node` and `jsdom`) running the same suite, comparing `JSON.stringify` output byte-for-byte. This is what would have caught the `Date`-timezone trap described in §3.

CI runs the matrix on Node 20/22/24, then `publint` and `attw` against the built artifact.

---

## 7. Error contract

Two distinct modes, so callers can pick per context:

```ts
validateConfig(config): { ok: true } | { ok: false; issues: ValidationIssue[] }  // never throws
buildSchedule(config)                                                            // throws PacingConfigError
```

`validateConfig` is non-throwing, for form validation and API boundaries where you want to collect and display every problem. The engine functions fail fast on invalid input — they are documented as requiring a valid config, and silently coercing bad input is precisely how the original `r/100 if r > 1 else r` ambiguity arose.

Errors carry a machine-readable `code` (`INVALID_RATE`, `SCHEDULE_TOO_LONG`, `NEGATIVE_COMMITMENT`) so the UI can map them to messages without string matching.

All public function parameters are `readonly` / `Readonly<T>`. The library never mutates an argument.

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

## 9. Note on the strategy profiles

With defaults removed from the library (spec §7), the eleven profiles in `strategy_defaults.py` still have value as seed data for whatever owns them downstream. Suggest keeping them in the repo as `seed/strategy-profiles.json` — versioned, not exported, not part of the published package. The library stays pure; the data does not get lost.
