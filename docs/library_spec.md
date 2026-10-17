# Pacing Model Library — Product Spec

**Status:** v1.0.0 release reference
**Date:** 2026-08-04
**Last updated:** 2026-10-17
**Replaces:** an earlier internal Python implementation and its documentation, referenced below by file name. Neither is included in this repository; the citations record where each carried-forward or dropped behaviour came from.

---

## 1. Purpose

A **stateless, isomorphic TypeScript library** that implements the Takahashi–Alexander (TA) pacing model for private fund cash flows.

It exposes four functions for these purposes:

| Function | Purpose | Needs |
|---|---|---|
| `buildSchedule` | Create curves and explore assumptions | Config |
| `project` | Forecast a prospective or new investment | Config, commitment, start date |
| `reproject` | Update a forecast using investment history | Config, fund terms, observed calls / distributions / NAVs |
| `validateConfig` | Reuse model validation rules in an application | Config |

Each is a pure function exposed through imports. Callers do not need to run them
in sequence. `buildSchedule` lets a UI explore curves before a commitment is
entered, while `project` can forecast a new investment directly. `validateConfig`
returns structured issues for applications without duplicating validation rules.

For practical examples, start with the [user guide](user-guide.md). Understanding
the [configuration](configuration.md), particularly periodicity and schedule
bases, is essential to interpreting the model's results.

### What this library is not

It has **no persistence, no I/O, and no state**. It does not read files, call APIs, touch a database, or hold module-level variables. Storage, caching, multi-fund portfolio rollups, auth, and scheduling are the responsibility of the application built on top of it.

Charting is also out of scope. The library returns plain data structures; the consuming app renders them.

---

## 2. Design principles

**Stateless and pure.** Same inputs → same outputs, always. No hidden state between calls, no singletons, no mutation of arguments. This is what makes the library safe to run in a React render, a Node request handler, a Lambda, and a test — identically.

**Explicit over default.** The calculation engine requires every `ModelConfig`
field except the optional `distributionSchedule`. Omit that schedule to use the
TA bow/yield curve. No duration, rate, liquidation, or extension defaults are
supplied by the library.

**JSON-serializable in and out.** Every input and output is plain JSON — so the persistence layer above can store a config or a result verbatim, and a server can compute a forecast and ship it to a browser with `JSON.stringify`. Concretely: dates are ISO `YYYY-MM-DD` strings, never `Date` objects; money is integer minor units as `number`, never `bigint` or a class instance.

**Zero runtime dependencies in the core.** Civil-date arithmetic is implemented
internally. Zod is an optional peer dependency of the separate `/schema` entry.

**Deterministic.** Identical inputs produce the same calculation within a runtime.
There is no random simulation in the public surface. Cross-environment tests
require exact monetary values and canonicalized floating-point outputs (§5.7).

**Dual build.** ESM + CJS, with type declarations. Node 20+ and modern browsers.

---

## 3. Domain model

### Units and conventions

These are part of the public contract. Types describe the shapes; engine guards
enforce numeric constraints and real calendar dates at runtime.

| Concept | Representation | Rationale |
|---|---|---|
| Dates | ISO `YYYY-MM-DD` string | JSON-safe; no timezone drift |
| Money | Integer **minor units** (cents) as `number` | Exact to ~$90 trillion; JSON-safe; avoids float drift over 40+ compounding periods |
| Schedule rates | Decimal `number` in `[0, 1]` (`0.25` = 25%) | Never percent-valued or coerced |
| Annual growth / yield | Finite decimals; growth > -1, yield >= 0 | Converted geometrically; values above 1 are permitted |
| Fund life | Finite years > 0; `fund_life * periodsPerYear` is a positive safe integer | Duration is supplied in years; partial periods are rejected |
| Periods | Zero-indexed integer; period 0 is the first modeled cash-flow period containing `startDate` | — |

**Rate inputs are decimals, full stop.** The current Python coerces with `r/100 if r > 1 else r`, which is ambiguous at exactly `1.0` (100%? or 1%?). The library rejects out-of-range values with a clear error instead of guessing.

**Rounding.** Resolved monetary amounts and grown NAV are rounded to minor units,
half-away-from-zero. Closing NAV is grown NAV plus calls minus distributions.
When commitment calls are allocated across periods, each rounded share is capped
at the remaining budget, then any residual goes to the final nonzero weight.
This preserves the total without negative allocations even for tiny commitments
(D18).
`buildSchedule` uses fractional arithmetic without monetary rounding.

### Schedule basis — the critical distinction

A rate can mean one of two things. The earlier Python implementation applied
commitment percentages to unfunded capital, so a `[25%, 25%, 25%, 25%]` schedule
intended to call 100% called about 68.4%. Calls and distributions now carry an
explicit basis (D6).

```ts
type CallSchedule =
  | { readonly basis: 'commitment'; readonly rates: readonly number[] }
  | { readonly basis: 'unfunded'; readonly rates: readonly number[] }

type DistributionSchedule =
  | { readonly basis: 'commitment'; readonly rates: readonly number[] }
  | { readonly basis: 'nav'; readonly rates: readonly number[] }
```

- **Call `commitment`** — `rates` sum to 1.0 within an absolute validation tolerance of `1e-9`. Natural for user-uploaded schedules ("25% per quarter for a year").
- **Call `unfunded`** — each rate applies to what is left uncalled. Note that such a schedule generally does **not** call 100%: a `[0.30, 0.35, 0.40, 0.35, 0.20]` profile leaves 14.2% permanently uncalled. That is defensible — funds rarely call everything — but it is an explicit, tested property, not an accident.
- **Distribution `commitment`** — share of commitment, independent of fund performance.
- **Distribution `nav`** — fraction of grown prior NAV, excluding the current period's call. This is the basis the bow curve uses.

All four are supported. None is inferred. The `basis` field is required.

`callSchedule.rates` must contain exactly one rate per modeled term period. Periods with no forecast calls are represented by explicit `0` rates rather than a separate callable-window field. Commitment-basis call schedules must sum to 1.0.

Distribution schedule length is not constrained to the fund term: missing entries
resolve to zero and entries after the horizon are unused. Commitment-basis
distribution rates must sum to at most 1 (with the same `1e-9` tolerance).
Forecast distributions are capped at available assets. Terminal liquidation
overrides the scheduled distribution in the final forecast period.

### Rate conversion

Annual rates convert to per-period **geometrically** (D7): `perPeriod = (1 + annual)^(1/periodsPerYear) − 1`. This is the only convention under which the periods actually compound to the stated annual rate. It applies to both `growthRate` and `yieldRate`.

### Core types

```ts
/** All fields required except the explicit distribution override. */
interface ModelConfig {
  readonly periodsPerYear: 1 | 2 | 4;
  readonly fund_life: number;               // years; fund_life × periodsPerYear must be a positive safe integer (D12)
  readonly growthRate: number;              // per annum, decimal — converted geometrically (D7)
  readonly yieldRate: number;               // per annum, decimal — converted geometrically (D7)
  readonly bowFactor: number;               // distribution curve shape; any value > 0, calibrated per frequency (D1, D13)
  readonly callSchedule: CallSchedule;
  readonly distributionSchedule?: DistributionSchedule;  // optional override of the bow curve
  readonly terminalLiquidation: boolean;    // distribute all residual NAV in the final period
  readonly termExtensionYears: number;      // term extension when actuals outlive the term (D5)
}

/** Curve output — dimensionless. Independent of commitment and calendar. */
interface SchedulePeriod {
  readonly index: number;
  readonly callRate: number;
  readonly distributionRate: number;
  readonly calledFraction: number;          // cumulative, of commitment
  readonly distributedFraction: number;     // cumulative, of commitment
  readonly unfundedFraction: number;
  readonly navFraction: number;
}

/** Investment cash-flow output — dated, denominated, in minor units. */
interface CashFlowPeriod {
  readonly index: number;
  readonly periodEnd: string;               // ISO date
  readonly source: 'actual' | 'forecast';
  readonly called: number;
  readonly distributed: number;
  readonly netCashFlow: number;
  readonly calledCumulative: number;        // PIC
  readonly distributedCumulative: number;
  readonly unfunded: number;                // may be negative when overcalled (D8)
  readonly overcalled: boolean;             // calledCumulative > commitment
  readonly nav: number;
  readonly dpi: number;
  readonly rvpi: number;
  readonly tvpi: number;
}

/** Observed investment history for reproject. */
interface Transaction {
  readonly date: string;                    // ISO
  readonly type: 'call' | 'distribution' | 'nav';
  readonly amount: number;                  // non-negative integer minor units; zero is valid
}

/** Reprojection variance — baseline vs revised, per period. */
interface VariancePeriod {
  readonly index: number;
  readonly periodEnd: string;
  readonly calledDelta: number;             // revised − baseline, minor units
  readonly distributedDelta: number;
  readonly navDelta: number;
  readonly tvpiDelta: number;
}

/** Non-throwing validation result. */
type ValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

interface ValidationIssue {
  readonly path: string;                    // e.g. 'callSchedule.rates[3]'
  readonly code: string;                    // machine-readable, e.g. 'RATE_OUT_OF_RANGE'
  readonly message: string;
}
```

`FundTerms` contains a positive integer `commitment` in minor units and a real ISO
`startDate`. Output money is in minor units; `dpi`, `rvpi`, and `tvpi` are
dimensionless multiples. DPI is cumulative distributions divided by cumulative
calls, RVPI is NAV divided by cumulative calls, and TVPI is their sum. All are
zero when cumulative calls are zero.

---

## 4. API

### Create curves and explore assumptions — buildSchedule

```ts
buildSchedule(config: ModelConfig): SchedulePeriod[]
```

Pure model math. No commitment, no dates, no money. Deterministic and fast enough to run on every keystroke in a parameter-tuning UI.

### Forecast a prospective or new investment — project

```ts
project(
  config: ModelConfig,
  fund: { commitment: number; startDate: string }
): readonly CashFlowPeriod[]
```

Runs the model with commitment-sized monetary amounts and a calendar. Period 0
ends at the quarter/half/year end containing `startDate`; output has exactly
`fund_life * periodsPerYear` rows. A partial starting calendar period is treated
as a full model step without prorating growth or yield.

### Update an investment with history — reproject

```ts
reproject(
  config: ModelConfig,
  fund: { commitment: number; startDate: string },
  actuals?: readonly Transaction[]
): {
  readonly baseline: readonly CashFlowPeriod[]; // original T=0 forecast
  readonly revised: readonly CashFlowPeriod[];  // actuals spliced in, remainder re-forecast
  readonly variance: readonly VariancePeriod[]; // revised − baseline over shared periods (D17)
  readonly asOf: string | null; // end of latest actual period; null with no actuals
}
```

`actuals` is the **complete** transaction set, not a delta. This makes add, edit, and delete a single operation, and keeps the function pure — the persistence layer owns the transaction list and passes the current state of it.

Behaviour:

- Transactions are bucketed into periods by date. Periods up to and including the last transaction are `source: 'actual'`; everything after is `source: 'forecast'`.
- Pre-start transactions enter period 0 (D14). In actual periods, missing calls and distributions are zero, including gaps in history. Missing NAV is `max(0, grown prior NAV + supplied calls - supplied distributions)`. No forecast flows are substituted for missing actuals.
- Reported NAV, where supplied, overrides modelled NAV for that period and becomes the base for forward projection.
- The forecast resumes from the actual state — actual unfunded, actual NAV, actual PIC.
- For `commitment`-basis call schedules, remaining original forecast calls are rescaled toward commitment (D11). If no positive forecast calls remain, no new call periods are created. If actual calls already exceed commitment, future calls are zero.
- Returning `baseline` alongside `revised` makes forecast-accuracy tracking a first-class output rather than something the caller reconstructs.

The latest transaction of any type determines the actual boundary. `asOf` is
that period's end, including when the transaction occurred earlier in the period.
A zero NAV observation is authoritative; it is not treated as missing. A NAV-only
history does not imply paid-in capital. Historical periods can have modeled NAV
even though their `source` is `'actual'`.

### Reuse configuration validation — validateConfig

```ts
validateConfig(config: ModelConfig): ValidationResult     // non-throwing model-config checks
```

Engine entry points automatically validate configuration, fund terms, and
transactions as applicable. The optional schemas do not replace this validation
(D15). The authoritative public interfaces in `src/types.ts` use readonly fields.

---

## 5. Correctness requirements

Because the prior documentation and the prior code disagree on units, defaults, and curve shape, **the test suite is the specification**. These are asserted properties, not aspirations.

1. **Commitment-basis schedules are exact.** Given `basis: 'commitment'` with rates summing to 1.0 within validation tolerance, final `calledCumulative` equals `commitment` to the cent. Accepted rate weights are normalized to the commitment, not used to change its total. The four-year fixture verifies the correction to the earlier implementation's 68.4% result.
2. **Curves are scale- and calendar-invariant.** `buildSchedule` output does not change with commitment or start date. Proves the fractional/denominated split is clean.
3. **Empty actuals is a no-op.** `reproject(c, f, [])` returns `revised` deeply equal to `project(c, f)`, and `baseline` equal to `revised`.
4. **Conservation.** For every period: `unfunded + calledCumulative === commitment`, and `netCashFlow === distributed - called`. Holds exactly, including when overcalled — `unfunded` is permitted to be negative rather than clamped (D8).
5. **NAV is non-negative** in every period, under every valid config.
6. **Actuals are preserved by aggregation.** Actual-period calls and distributions equal the sums of supplied transactions. The latest reported NAV by date wins, with input order breaking equal-date ties; the model never replaces that selected observation.
7. **Cross-environment determinism.** Node and jsdom produce matching monetary values and canonical JSON snapshots. Integer values are compared exactly; floating outputs are canonicalized at `1e-8` to tolerate last-digit runtime differences. This is browser-like environment coverage, not a test of every browser engine.
8. **Fund life determines the modeled periods.** The number of periods is `fund_life * periodsPerYear`, a positive safe integer. `callSchedule.rates.length` equals that derived count; period `i` consumes `rates[i]`, including period 0, and no-call periods are explicit zeros.
9. **Commitment-basis reprojections preserve commitment.** For `basis: 'commitment'` schedules that call 100% of commitment and have remaining forecast call periods, `reproject` rescales future forecast calls after actuals so final `calledCumulative` equals `commitment`, unless actual calls already exceed commitment.

---

## 6. Recorded decisions and v1 conventions

These decisions define the deterministic v1 contract. Historical questions are
retained with their decisions and rationale. Post-v1.0 questions are tracked in
`docs/known_issues.md`; they are not blockers for the initial release.

### D1 — Bow factor convention

Distribution rate is `max(yield, (t/L)^B)`. The prior doc's examples use `B = 0.5–0.6`; `strategy_defaults.py` uses `B = 1.8–2.5`. These are opposite curve shapes — at 25% through fund life, `B=0.5` distributes 50% of NAV and `B=2.5` distributes 3%.

**Decision:** The module will accept any bow value > 0.

### D2 — Resume vs. restart after actuals

When actuals end at fund age 5 and forecasting resumes, does the call-rate schedule continue at index 5, or restart at index 0?

The current Python **restarts** — so a 5-year-old fund that has called 80% resumes with year-1 call rates. This looks unintended but is load-bearing for requirement 3.

**Decision:** resume by fund age (index 5). No option to restart required. 

### D3 — Explicit terminal liquidation

The earlier model forced distribution of residual NAV in the final period.

**Decision:** require an explicit `terminalLiquidation` boolean. When `true`, the
final forecast period distributes all available assets, including that period's
call, leaving zero NAV. When `false`, use the resolved distribution rate instead;
this does not guarantee positive residual NAV. Observed actual periods are not
overridden by terminal liquidation. The engine does not supply a default.

### D4 — Monte Carlo scope

Percentile NAV bands are outside the three stated deterministic requirements.

**Decision:** omit Monte Carlo functionality. There is no public `simulate`
function or committed release version for adding one.

### D5 — Explicit extension after actuals outlive the term

The earlier implementation hard-coded three additional years. The library makes
that duration an explicit `termExtensionYears` input.

**Decision:** only extend when `lastActualIndex >= fund_life * periodsPerYear`.
The revised count is `lastActualIndex + 1 + Math.round(termExtensionYears *
periodsPerYear)`. The baseline retains its original count, and variance covers
only the shared horizon (D17). Zero extension is valid and still includes the
late actual period. Extension years retain this rounding convention; unlike
`fund_life`, they need not align exactly with whole periods.

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

The number of modeled cash-flow periods is derived from `fund_life * periodsPerYear` (D12). Output indices run from `0` to that count minus one, and period 0 is the first modeled cash-flow period containing `startDate`.

**Decision:** `callSchedule.rates[0]` applies to period 0. There is no extra inception-only output row.

### D10 — Full-term call schedules

The prior `callablePeriods` field created two sources of truth: a schedule array and a separate window that could silently ignore user-provided rates.

**Decision:** remove `callablePeriods`. `callSchedule.rates` must have exactly `fund_life * periodsPerYear` entries, with explicit `0` entries for periods in which no capital is forecast to be called. Invalid lengths fail validation and engine entry points reject them.

### D11 — Commitment-basis calls after actuals

For a `commitment`-basis schedule, actual calls can be ahead of or behind the original forecast by the time `reproject` resumes forecasting.

**Decision:** commitment-basis call schedules must sum to 1.0. After actuals,
allocate `max(0, commitment - actualCalledCumulative)` across the remaining
original forecast call amounts in proportion to their weights. If their total
is zero, leave future calls at zero: do not invent new call periods or move calls
into zero-weight periods. Total capital can therefore remain below commitment
when actuals have exhausted the original call window. If actual calls exceed
commitment, preserve those calls and forecast no further commitment calls.
`unfunded`-basis schedules continue to use actual remaining unfunded commitment,
floored at zero for future calls.

### D12 — Fund life is supplied in years

Fund duration is a domain input in years; callers should not have to convert it
to periods before configuring the model.

**Decision:** replace the public `termPeriods` field with `fund_life`, in years.
The library derives `fund_life * periodsPerYear` internally for schedules,
projections, and the original reprojection horizon. Fund life must be finite and
positive, and the derived count must be a positive safe integer. Fractional years
are supported when they align with whole model periods; partial periods are
rejected rather than rounded so the library never silently changes the requested
fund duration. `validateConfig` reports `INVALID_FUND_LIFE` at `fund_life` for
invalid durations, and the optional schema enforces the same duration constraint.

Existing configs migrate with `fund_life = termPeriods / periodsPerYear`; remove
`termPeriods`. There is no legacy fallback or second source of truth. Outputs for
an equivalent duration are unchanged. `termExtensionYears` keeps its existing
meaning: additional forecast years after actuals outlive the original fund term.

### D13 — Bow calibration is specific to model frequency (K1)

**Decision:** apply `((index + 1) / effectiveTermPeriods)^bowFactor` once per
model period. Growth and yield are annual inputs converted geometrically; bow
is not frequency-normalized. Calibrate it for annual, semiannual, or quarterly
modeling. Changing frequency with the same bow factor need not preserve cash
flows. An explicit distribution schedule overrides bow and yield.

**Rationale:** preserve a deterministic convention and existing calibrations
without assuming a frequency-independent parameterization. A future alternative
requires an explicit migration decision.

### D14 — Pre-start transactions enter period 0; applications flag them (K5)

**Decision:** bucket transactions dated before `startDate` into period 0. Use the
normal aggregation rules: sum calls and distributions, take the latest NAV by
date, and break equal-date NAV ties by input order. Such transactions participate
in actuals and can make period 0 actual. Do not discard them or change their dates.

The engine currently has no warning result or logging side effect. Consuming
applications should flag dates before the fund start for review, comparing
validated ISO strings. A structured library diagnostics API is a post-v1.0 design
question, not an existing feature.

**Rationale:** retain supplied activity deterministically while keeping the core
pure and avoiding a warning API introduced without an agreed contract.

### D15 — Engine validation is authoritative (K7)

**Decision:** optional Zod date schemas check `YYYY-MM-DD` format. Engine guards
check calendar validity and reject impossible fund or transaction dates with
`PacingInputError` (`INVALID_DATE`), even if the schema accepted them.
`validateConfig` only validates model configuration, not dates. Consumers must
handle engine validation errors after schema parsing.

**Rationale:** date shape checks are sufficient for the optional schemas in v1;
every calculation still validates its inputs. Schema success is not a guarantee
that all engine constraints have passed. Expanding schema parity is future work.

### D16 — Empty-actuals results may share readonly arrays (K8)

**Decision:** with omitted or empty actuals, `baseline` and `revised` may share one
readonly array. `asOf` is `null`; variance has one zero-delta row per baseline
period. Consumers must not mutate results or rely on distinct references.
Readonly is a TypeScript contract rather than runtime freezing; consumers that
need editable data must copy arrays and rows. Reference identity itself is not
a stable public guarantee.

**Rationale:** avoid unnecessary allocation when the projections have identical
values while retaining the existing readonly API.

### D17 — Variance is limited to the baseline horizon (K9)

**Decision:** compute each variance delta as `revised - baseline` over shared
periods. Keep the baseline at the original derived fund term when actuals extend
the revised horizon. Extended periods have no variance rows: the comparison is
undefined rather than zero.

**Rationale:** the original forecast supplies no reference values after its term.
Inventing a zero or extrapolated baseline would imply a modeling decision that
v1 does not make. Extended comparisons require a future reference convention.

---

### D18 — Nonnegative allocation and exact commitment totals

**Decision:** allocate the full commitment across accepted commitment schedule
weights, including weights whose sum differs from 1 within validation tolerance.
Do not scale the target amount by that small difference. Round each share, cap
it at the remaining unallocated amount, and put any positive residual into the
last nonzero-weight period. Apply the same allocator to rescaled future calls.

**Rationale:** rounding three cents across five equal periods must not create a
negative call. Accepted tolerance must not add or remove cents from commitment.
Normal forecasts retain their existing values; no determinism snapshot changes
are required for these edge-case corrections.

### D19 — Reject unrepresentable results and malformed runtime inputs

**Decision:** monetary inputs must be safe integers; every produced monetary
amount and cumulative must remain a safe integer. Reject unsafe or non-finite
calculations with `PacingInputError` (`NUMERIC_OVERFLOW`) before returning a
result. Fractional curves must remain finite. Projection dates must stay within
the four-digit ISO calendar range; exceeding year 9999 raises
`DATE_RANGE_EXCEEDED`. Reject malformed fund/transaction containers and sparse
arrays with structured validation or input errors.

**Rationale:** valid shapes and finite rate inputs alone do not guarantee that a
long or rapidly growing projection can represent every cent. Successful
projections obey the invariants; precision overflows are explicit errors rather
than silent corruption. Property tests for conservation and NAV use representable
histories, with separate overflow regression tests.

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
