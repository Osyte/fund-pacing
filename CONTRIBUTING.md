# Contributing

Thanks for taking an interest. This is a small library with a narrow job, so contributions are easiest to land when they keep it that way.

## Setup

```bash
npm ci
npm run verify   # lint, typecheck, test, build, package checks
```

Node 20 or later. The test suite runs under both Node and jsdom; both must pass.

## What the tests mean

The test suite is the specification. `docs/library_spec.md` §5 states eight invariants and `tests/invariants.test.ts` checks them as properties over generated configs with fast-check. If you change model behaviour:

- Update or add a property test. An example-based test alone is not enough for a change to the recurrence, rate resolution, or bucketing.
- If the change alters a convention (schedule basis, compounding, period alignment, curve shape), record the decision in `docs/library_spec.md` §6 so it has a number and a rationale.
- Update the determinism snapshots in `tests/__snapshots__/` only when the output is meant to change, and say so in the PR.

## Adding a fixture

Fixtures are inputs, never expected outputs. Put the input file in `fixtures/`, describe it in `fixtures/README.md`, and derive the expected values from the corrected math in the spec. Do not commit real fund or client data; the synthetic transaction file shows the shape to follow.

## Conventions

- Dates are ISO `YYYY-MM-DD` strings. Never construct a `Date`.
- Money is integer minor units. Round once, at the period boundary.
- Rates are decimals in `[0, 1]`. Reject, never coerce.
- The Takahashi–Alexander step lives in `src/engine/recurrence.ts` and nowhere else.
- No runtime dependencies. `zod` stays behind the optional `./schema` entry point.

## Reporting a problem

Open an issue with a minimal reproduction: the config, fund terms, and actuals as JSON, plus the output you got and the output you expected.
