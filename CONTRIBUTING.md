# Contributing

Found a bug or something you'd like to change? Excellent!

Worked out a fix? Even better!

Want to tell us about it? We'd love to hear from you.

Questions, suggestions, documentation improvements, and reports from real usage
are welcome. You do not need to have a fix before opening an issue. Describe
what you tried, what happened, and what would make the library more useful.

For usage questions, start with the [user guide](docs/user-guide.md) and
[configuration guide](docs/configuration.md). For a proposed model change, check
the [recorded decisions](docs/library_spec.md#6-recorded-decisions-and-v1-conventions)
and explain the convention you would change. This helps us discuss the proposal
before you invest time in an implementation.

## Setup

```bash
npm ci
npm run verify   # lint, typecheck, test, build, package checks
```

Node 22 or later. The test suite runs under both Node and jsdom; both must pass.

Individual checks are `npm run lint`, `npm run typecheck`, `npm test`,
`npm run test:coverage`, `npm run build`, `npm run check:docs`, and
`npm run check:package`. See the
[technical design](docs/library_design.md) for the module and test structure.

`npm run verify` enforces coverage thresholds and checks the actual packed
package in isolated consumers.

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

For conventions K1, K5, K7, K8, and K9, use the accepted v1 decisions in
[`docs/library_spec.md` §6](docs/library_spec.md#6-recorded-decisions-and-v1-conventions).
Keep the README, spec, and known-issues disposition consistent. A documentation
change must describe current behavior; future APIs belong under explicitly
identified design questions. Do not update snapshots for wording-only changes.

## Reporting a problem

Open an issue with a minimal reproduction: the config, fund terms, and actuals as JSON, plus the output you got and the output you expected.

## Publishing a version

Update the version in `package.json` and `package-lock.json`, add its changelog
entry, and merge the reviewed changes into `main`. Once CI passes, create and
push an annotated tag matching the package version, for example `v1.0.1`.
The **Publish to npm** workflow checks out that tag, verifies that its commit is
on `main`, and runs the full release checks before publishing through npm's
trusted publishing with provenance. No npm token secret is needed.

In the npm package's **Settings → Trusted publishing**, authorize GitHub Actions
with organization `Osyte`, repository `fund-pacing`, workflow filename
`publish.yml`, no environment name, and permission to run `npm publish`.
The filename and organization must match exactly. See
[npm's trusted publishing guide](https://docs.npmjs.com/trusted-publishers/).

To check the workflow without publishing, open **Actions → Publish to npm → Run
workflow**, enter an existing version tag, and leave **dry_run** enabled. A dry
run verifies the package but does not test the npm OIDC authorization itself.
Existing published versions are skipped on publishing runs. After a new version
is available on npm, create the GitHub release from the same tag and its
changelog entry. Version 1.0.0 was published manually; provenance applies to
future versions published by this workflow.
