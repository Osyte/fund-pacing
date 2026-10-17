# Contributing

Thanks for taking an interest. This is a small library with a narrow job, so contributions are easiest to land when they keep it that way.

## Setup

```bash
npm ci
npm run verify   # lint, typecheck, test, build, package checks
```

Node 20 or later. The test suite runs under both Node and jsdom; both must pass.

## What the tests mean

The test suite is the specification. `docs/library_spec.md` §5 states nine
invariants. `tests/invariants.test.ts` checks eight as properties over generated
configs with fast-check; the determinism suite covers #7 under Node and jsdom.
If you change model behaviour:

- Update or add a property test. An example-based test alone is not enough for a change to the recurrence, rate resolution, or bucketing.
- If the change alters a convention (schedule basis, compounding, period alignment, curve shape), record the decision in `docs/library_spec.md` §6 so it has a number and a rationale.
- Update the determinism snapshots in `tests/__snapshots__/` only when the output is meant to change, and say so in the PR.

## Adding a fixture

Fixtures are inputs, never expected outputs. Put the input file in `fixtures/`, describe it in `fixtures/README.md`, and derive the expected values from the corrected math in the spec. Do not commit real fund or client data; the synthetic transaction file shows the shape to follow.

## Conventions

- Dates are ISO `YYYY-MM-DD` strings. Never construct a `Date`.
- Money is integer minor units. Use the shared rounding and allocation helpers.
- Schedule rates are decimals in `[0, 1]`. Annual growth must be finite and > -1; annual yield must be finite and >= 0. Reject, never coerce.
- Fund life is `fund_life` in years. Derive periods with the shared helper; reject partial periods rather than rounding. Call schedules must span the derived term with explicit zeros.
- The Takahashi–Alexander step lives in `src/engine/recurrence.ts` and nowhere else.
- No runtime dependencies. `zod` stays behind the optional `./schema` entry point.

For conventions K1, K5, K7, K8, and K9, use the accepted v0.x decisions in
[`docs/library_spec.md` §6](docs/library_spec.md#6-recorded-decisions-and-v0x-conventions).
Keep the README, spec, and known-issues disposition consistent. A documentation
change must describe current behavior; future APIs belong under explicitly
identified design questions. Do not update snapshots for wording-only changes.

## Reporting a problem

Open an issue with a minimal reproduction: the config, fund terms, and actuals as JSON, plus the output you got and the output you expected.
