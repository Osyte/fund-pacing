# Pacing Model Library — Product Spec

**Status:** Draft for review
**Date:** 2026-08-04
**Replaces:** an earlier internal Python implementation and its documentation, referenced below by file name. Neither is included in this repository; the citations record where each carried-forward or dropped behaviour came from.

---

## 1. Purpose

A **stateless, isomorphic TypeScript library** that implements the Takahashi–Alexander (TA) pacing model for private fund cash flows.

It answers three questions, in increasing order of specificity:

| # | Question | Needs |
|---|---|---|
| 1 | *What does the cash-flow curve look like?* | Model parameters only |
| 2 | *What are the actual dates and dollar amounts?* | \+ commitment amount and date |
| 3 | *Given what has actually happened, what now?* | \+ observed calls / distributions / NAVs |

Each is a pure function. Each builds on the previous one. Layer 1 is usable on its own — a UI can render a pacing curve from a strategy picker with no commitment entered yet.

### What this library is not

It has **no persistence, no I/O, and no state**. It does not read files, call APIs, touch a database, or hold module-level variables. Storage, caching, multi-fund portfolio rollups, auth, and scheduling are the responsibility of the application built on top of it.

Charting is also out of scope. The library returns plain data structures; the consuming app renders them.

---

## 2. Design principles

**Stateless and pure.** Same inputs → same outputs, always. No hidden state between calls, no singletons, no mutation of arguments. This is what makes the library safe to run in a React render, a Node request handler, a Lambda, and a test — identically.

**Explicit over default.** *This is a hard requirement.* The calculation engine accepts a fully-resolved config in which every parameter is present and explicit. It has no fallbacks and no knowledge that "defaults" exist. 

**JSON-serializable in and out.** Every input and output is plain JSON — so the persistence layer above can store a config or a result verbatim, and a server can compute a forecast and ship it to a browser with `JSON.stringify`. Concretely: dates are ISO `YYYY-MM-DD` strings, never `Date` objects; money is integer minor units as `number`, never `bigint` or a class instance.

**Zero runtime dependencies.** Required for clean bundling and tree-shaking in a React app. Date arithmetic (quarter-end, year-end) is ~20 lines and does not justify a dependency.

**Deterministic.** Including simulation — any stochastic feature takes an explicit seed, so a frontend preview and a backend recompute of the same scenario agree exactly.

**Dual build.** ESM + CJS, with type declarations. Node 20+ and modern browsers.

---

## 3. Domain model

### Units and conventions

These are non-negotiable and enforced at the type level.

| Concept | Representation | Rationale |
|---|---|---|
| Dates | ISO `YYYY-MM-DD` string | JSON-safe; no timezone drift |
| Money | Integer **minor units** (cents) as `number` | Exact to ~$90 trillion; JSON-safe; avoids float drift over 40+ compounding periods |
| Rates & fractions | `number`, decimal (`0.25` = 25%) | Never percent-valued. Values > 1 are rejected, not coerced |
| Periods | Zero-indexed integer; period 0 is the first modeled cash-flow period containing `startDate` | — |

**Rate inputs are decimals, full stop.** The current Python coerces with `r/100 if r > 1 else r`, which is ambiguous at exactly `1.0` (100%? or 1%?). The library rejects out-of-range values with a clear error instead of guessing.

**Rounding.** Money is rounded once, at the period boundary, half-away-from-zero. Where a total is allocated across periods, the residual is assigned to the final period so components always sum to the total exactly.

### Schedule basis — the critical distinction

A rate can mean one of two things, and conflating them is the single largest defect in the current implementation (a `[25%, 25%, 25%, 25%]` call schedule intended to call 100% actually calls 68.4%). Calls and distributions each carry an explicit basis, and the two are symmetric (D6).

```ts
type CallSchedule =
  | { basis: 'commitment'; rates: number[] }  // share of total commitment
  | { basis: 'unfunded';   rates: number[] }  // rate applied to remaining unfunded

type DistributionSchedule =
  | { basis: 'commitment'; rates: number[] }  // share of total commitment
  | { basis: 'nav';        rates: number[] }  // fraction of prevailing NAV
```

- **Call `commitment`** — `rates` sum to exactly 1.0. Natural for user-uploaded schedules ("25% per quarter for a year").
- **Call `unfunded`** — each rate applies to what is left uncalled. Note that such a schedule generally does **not** call 100%: a `[0.30, 0.35, 0.40, 0.35, 0.20]` profile leaves 14.2% permanently uncalled. That is defensible — funds rarely call everything — but it is an explicit, tested property, not an accident.
- **Distribution `commitment`** — share of commitment, independent of fund performance.
- **Distribution `nav`** — fraction of prevailing NAV. This is the convention the bow curve produces, so an explicit `nav` schedule and the modelled default are directly comparable.

All four are supported. None is inferred. The `basis` field is required.

`callSchedule.rates` must contain exactly one rate per modeled term period. Periods with no forecast calls are represented by explicit `0` rates rather than a separate callable-window field. Commitment-basis call schedules must sum to 1.0.

### Rate conversion

Annual rates convert to per-period **geometrically** (D7): `perPeriod = (1 + annual)^(1/periodsPerYear) − 1`. This is the only convention under which the periods actually compound to the stated annual rate. It applies to both `growthRate` and `yieldRate`.

### Core types

```ts
/** Fully resolved. Every field required. The engine sees only this. */
interface ModelConfig {
  periodsPerYear: 1 | 2 | 4;
  termPeriods: number;             // total periods modelled (fund life × periodsPerYear)
  growthRate: number;              // per annum, decimal — converted geometrically (D7)
  yieldRate: number;               // per annum, decimal — converted geometrically (D7)
  bowFactor: number;               // distribution curve shape; any value > 0 (D1)
  callSchedule: CallSchedule;
  distributionSchedule?: DistributionSchedule;  // optional override of the bow curve
  terminalLiquidation: boolean;    // distribute all residual NAV in the final period
  termExtensionYears: number;      // term extension when actuals outlive the term (D5)
}

/** Layer 1 output — dimensionless. Independent of commitment and calendar. */
interface SchedulePeriod {
  index: number;
  callRate: number;
  distributionRate: number;
  calledFraction: number;          // cumulative, of commitment
  distributedFraction: number;     // cumulative, of commitment
  unfundedFraction: number;
  navFraction: number;
}

/** Layer 2 & 3 output — dated, denominated, in minor units. */
interface CashFlowPeriod {
  index: number;
  periodEnd: string;               // ISO date
  source: 'actual' | 'forecast';
  called: number;
  distributed: number;
  netCashFlow: number;
  calledCumulative: number;        // PIC
  distributedCumulative: number;
  unfunded: number;                // may be negative when overcalled (D8)
  overcalled: boolean;             // calledCumulative > commitment
  nav: number;
  dpi: number;
  rvpi: number;
  tvpi: number;
}

/** Layer 3 input. */
interface Transaction {
  date: string;                    // ISO
  type: 'call' | 'distribution' | 'nav';
  amount: number;                  // minor units, always positive
}

/** Layer 3 output — baseline vs revised, per period. */
interface VariancePeriod {
  index: number;
  periodEnd: string;
  calledDelta: number;             // revised − baseline, minor units
  distributedDelta: number;
  navDelta: number;
  tvpiDelta: number;
}

/** Non-throwing validation result. */
type ValidationResult =
  | { ok: true }
  | { ok: false; issues: ValidationIssue[] };

interface ValidationIssue {
  path: string;                    // e.g. 'callSchedule.rates[3]'
  code: string;                    // machine-readable, e.g. 'RATE_OUT_OF_RANGE'
  message: string;
}
```

---

## 4. API

### Layer 1 — periods and percentages

```ts
buildSchedule(config: ModelConfig): SchedulePeriod[]
```

Pure model math. No commitment, no dates, no money. Deterministic and fast enough to run on every keystroke in a parameter-tuning UI.

### Layer 2 — dates and amounts

```ts
project(
  config: ModelConfig,
  fund: { commitment: number; startDate: string }
): CashFlowPeriod[]
```

Applies a calendar and a scale to Layer 1. Period end dates are true quarter/half/year ends derived from `startDate`.

### Layer 3 — revised forecast from actuals

```ts
reproject(
  config: ModelConfig,
  fund: { commitment: number; startDate: string },
  actuals: Transaction[]
): {
  baseline: CashFlowPeriod[];   // the original T=0 forecast, unchanged
  revised:  CashFlowPeriod[];   // actuals spliced in, remainder re-forecast
  variance: VariancePeriod[];   // per-period baseline vs revised
  asOf: string;                 // boundary date between actual and forecast
}
```

`actuals` is the **complete** transaction set, not a delta. This makes add, edit, and delete a single operation, and keeps the function pure — the persistence layer owns the transaction list and passes the current state of it.

Behaviour:
- Transactions are bucketed into periods by date. Periods up to and including the last transaction are `source: 'actual'`; everything after is `source: 'forecast'`.
- Reported NAV, where supplied, overrides modelled NAV for that period and becomes the base for forward projection.
- The forecast resumes from the actual state — actual unfunded, actual NAV, actual PIC.
- For `commitment`-basis call schedules, forecast calls after actuals are rescaled across the remaining original forecast calls so total called capital returns to 100% of commitment, unless actual calls already exceed commitment.
- Returning `baseline` alongside `revised` makes forecast-accuracy tracking a first-class output rather than something the caller reconstructs.

### Supporting exports

```ts
validateConfig(config: ModelConfig): ValidationResult     // explicit, never implicit
```

---

## 5. Correctness requirements

Because the prior documentation and the prior code disagree on units, defaults, and curve shape, **the test suite is the specification**. These are asserted properties, not aspirations.

1. **Commitment-basis schedules are exact.** Given `basis: 'commitment'` with rates summing to 1.0, final `calledCumulative` equals `commitment` to the cent. *(The documented 4-year example; currently produces 68.4%.)*
2. **Layer 1 is scale- and calendar-invariant.** `buildSchedule` output does not change with commitment or start date. Proves the fractional/denominated split is clean.
3. **Empty actuals is a no-op.** `reproject(c, f, [])` returns `revised` deeply equal to `project(c, f)`, and `baseline` equal to `revised`.
4. **Conservation.** For every period: `unfunded + calledCumulative === commitment`, and `netCashFlow === distributed - called`. Holds exactly, including when overcalled — `unfunded` is permitted to be negative rather than clamped (D8).
5. **NAV is non-negative** in every period, under every valid config.
6. **Actuals are reproduced verbatim.** Periods marked `source: 'actual'` report exactly the transaction amounts supplied — the model never overwrites an observed figure.
7. **Isomorphic determinism.** Identical inputs produce byte-identical `JSON.stringify` output under Node and in a browser.
8. **Call schedules map one-to-one onto modeled periods.** `callSchedule.rates.length === termPeriods`; period `i` consumes `rates[i]`, including period 0, and no-call periods are explicit zeros.
9. **Commitment-basis reprojections preserve commitment.** For `basis: 'commitment'` schedules that call 100% of commitment and have remaining forecast call periods, `reproject` rescales future forecast calls after actuals so final `calledCumulative` equals `commitment`, unless actual calls already exceed commitment.

---

## 6. Open decisions

Two require a product answer before implementation. The rest are recorded with a recommended default.

### D1 — Bow factor convention **(blocking)**

Distribution rate is `max(yield, (t/L)^B)`. The prior doc's examples use `B = 0.5–0.6`; `strategy_defaults.py` uses `B = 1.8–2.5`. These are opposite curve shapes — at 25% through fund life, `B=0.5` distributes 50% of NAV and `B=2.5` distributes 3%.

**Decision:** The module will accept any bow value > 0.

### D2 — Resume vs. restart after actuals **(blocking)**

When actuals end at fund age 5 and forecasting resumes, does the call-rate schedule continue at index 5, or restart at index 0?

The current Python **restarts** — so a 5-year-old fund that has called 80% resumes with year-1 call rates. This looks unintended but is load-bearing for requirement 3.

**Recommendation:** resume by fund age (index 5), with restart available as an explicit option if a real use case exists.

**Decision:** resume by fund age (index 5). No option to restart required. 

### D3 — Terminal liquidation *(default: on)*

The current model forces distribution of all residual NAV in the final period, guaranteeing NAV ends at 0. Exposed as `terminalLiquidation`, defaulting to `true` to match existing behaviour.

**Decision:** Expose as `terminalLiquidation`, with default as suggested.  

### D4 — Monte Carlo scope *(default: not in v1)*

Percentile NAV bands are valuable but orthogonal to all three stated requirements, and the two existing implementations contradict each other. Ship the deterministic core first; add `simulate(config, fund, { seed, runs })` as a separate entry point in v1.1 so it is tree-shakeable.

**Decision:** Remove all monte carlo functionality from the new module. 

### D5 — Extended fund life *(default: port as-is, parameterised)*

Current behaviour extends `L` to `actualLife + 3` years when a fund outlives its assumed term. The intent is documented; the constant `3` is not. Expose it as `termExtensionYears` rather than hard-coding it.

**Decision:** Expose `termExtensionYears` as suggested. It is carried on `ModelConfig` but only takes effect in `reproject`, since only actuals can outlive the term.

### D6 — Distribution schedule basis

The call-rate basis ambiguity (§3) applies equally to distributions, which the Python treats two ways in the same file — as a share of commitment and as a rate on NAV.

**Decision:** make it symmetric with `CallSchedule`. `DistributionSchedule` carries an explicit `basis` of `'commitment'` or `'nav'`. Neither is inferred.

### D7 — Compounding convention

`growthRate` and `yieldRate` are stated per annum; the two Python models disagree on how they become per-period (simple division vs. geometric). At 20% annual over ten quarterly years this is a 14% divergence in terminal NAV — 7.04× simple vs. 6.19× geometric.

**Decision:** geometric — `(1 + annual)^(1/periodsPerYear) − 1`. It is the only convention under which the periods compound to the stated annual rate.

### D8 — Overcalled capital

Recallable capital and recycling mean a real fund can report cumulative calls above its commitment, and `reproject` consumes actual transactions. Clamping `unfunded` at zero (as the Python does) would break the conservation invariant.

**Decision:** `unfunded` may go negative, which is meaningful — capital called beyond commitment. Conservation (§5.4) stays exact. `CashFlowPeriod.overcalled` flags the condition for the UI.

### D9 — Period-zero call alignment

`termPeriods` is the number of modeled cash-flow periods. Output indices run from `0` to `termPeriods - 1`, and period 0 is the first modeled cash-flow period containing `startDate`.

**Decision:** `callSchedule.rates[0]` applies to period 0. There is no extra inception-only output row.

### D10 — Full-term call schedules

The prior `callablePeriods` field created two sources of truth: a schedule array and a separate window that could silently ignore user-provided rates.

**Decision:** remove `callablePeriods`. `callSchedule.rates` must be exactly `termPeriods` long, with explicit `0` entries for periods in which no capital is forecast to be called. Invalid lengths fail validation and engine entry points reject them.

### D11 — Commitment-basis calls after actuals

For a `commitment`-basis schedule, actual calls can be ahead of or behind the original forecast by the time `reproject` resumes forecasting.

**Decision:** commitment-basis call schedules must sum to 1.0. After actuals, scale the remaining original commitment-basis forecast calls by the multiplier implied by remaining commitment divided by remaining forecast calls. If actual calls already exceed commitment, future commitment-basis calls are zero. `unfunded`-basis schedules continue to calculate from actual remaining unfunded commitment.

---

## 7. Not carried forward

Defects in the Python implementation that must not be reproduced. **Validating the port against current Python output would therefore be incorrect** — golden fixtures must be built from corrected math.

| Issue | Location |
|---|---|
| Call-rate off-by-one — `rc_rates[0]` never applied, schedule lags one period | `run_ta_model_new_investment.py:137,149` |
| Deterministic and Monte Carlo paths use different call schedules | `run_ta_model_new_investment.py:149` vs `:203` |
| Annual→quarterly conversion divides *cumulative* columns by 4 | `convert_annual_to_quarterly.py:37` |
| Manual-upload percentages fed in as unfunded-basis rates | `process_manual_upload_and_forecast.py:46` |
| `callable_period` defined for all strategies but never applied | `run_ta_model_new_investment.py:53` |
| `global persistent_data` — stateful transaction accumulation | `add_new_transaction.py:34` |
| `percentage_ta_forecast` defaults `True` in one model, `False` in the other | `run_ta_model_new_investment.py:23` vs `run_ta_model_existing_investment.py:24` |
| Ambiguous rate coercion `r/100 if r > 1 else r` | `run_ta_model_existing_investment.py:104` |
| Inferred IRR returned per-period without annualisation | `process_manual_upload.py:75` |
| In-library strategy defaults/config-resolution module | Not carried: defaults become external reference data (for example, DB-backed) that clients may use or ignore |

Also dropped: the annual→quarterly conversion step entirely. The engine models natively at the requested frequency, which removes the need for conversion rather than fixing it.

---

## 8. Carried forward

| Asset | From | Treatment |
|---|---|---|
| TA recurrence | `run_ta_model_new_investment.py:146–177` | Equations transcribed; implementation rewritten |
| Output vocabulary | `run_ta_model_new_investment.py:265–286` | Becomes `CashFlowPeriod` |
| Actual/forecast splice concept | `run_ta_model_existing_investment.py` | Reimplemented as `reproject` |
| Transaction taxonomy | `run_ta_model_existing_investment.py:123–130` | Becomes the `Transaction` union |
| Example CSVs | `data/` | Regression fixtures — with corrected expected values |

---

## 9. Out of scope

Persistence and caching · portfolio-level aggregation across funds · currency conversion · fee and carry waterfalls · charting and visualisation · authentication · scheduling and event triggers · CSV parsing *(the app supplies parsed rows; the library does no I/O)*
