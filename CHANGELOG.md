# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/). Breaking changes to the public interface require a new major version.

## Unreleased

## 1.0.1

- Require patched Zod `^4.6.6` for the optional schema entry point and update the development lockfile to address [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5). Core imports remain independent of Zod.
- Make `termExtensionYears` optional in `ModelConfig` and `ModelConfigSchema`, defaulting to zero additional extension years. Preserve late actuals and validation of supplied values. See [#22](https://github.com/Osyte/fund-pacing/issues/22).
- Add the Observable demonstration's source and maintenance instructions under `examples/observable`, with links from the README and user guide. Example tooling stays separate from the library and published package.
- Label `reproject` rows with modeled NAV as `source: 'forecast'`, while preserving supplied cash flows, the transaction cutoff, and the existing output shape. Reported NAV, including zero, keeps a row actual.
- Document and regression-test transaction bucketing to the next calendar period end and the resumption of forecast cash flows after that whole period closes.
- Add a GitHub Packages workflow that verifies and mirrors the approved npm tarball after a GitHub release, with a manual dry-run option.
- Update CI coverage artifact uploads to `actions/upload-artifact@v7`.

## 1.0.0

Initial stable release.

- Requires Node 22 or later; CI verifies Node 22 and 24.
- `buildSchedule`: dimensionless Takahashi–Alexander curves for exploring model assumptions.
- `project`: dated cash flows in minor units for prospective or new investments.
- `reproject`: revised forecasts from observed calls, distributions, and NAVs, with baseline and variance.
- `validateConfig`: reusable, non-throwing configuration validation, including malformed runtime shapes.
- Optional Zod schemas under `@osyte/fund-pacing/schema`.
- `fund_life` in years replaces the development-era `termPeriods` input. The library derives periods as `fund_life * periodsPerYear` and rejects partial periods without rounding. Migrate with `fund_life = termPeriods / periodsPerYear`.
- Full-term call schedules replace `callablePeriods`, with explicit zeros for periods without calls. Schedule lengths are validated against the derived period count.
- Period 0 is the first modeled cash-flow period and consumes `callSchedule.rates[0]`.
- Commitment-basis call schedules must sum to 1. After actuals, remaining positive forecast calls are rescaled to remaining commitment; exhausted call schedules do not create new call periods.
- Explicit schedule bases (`commitment`, `unfunded`, `nav`), geometric annual-rate conversion, and exact capital conservation including when overcalled.
- Accepted v1 conventions for frequency-specific bow calibration (K1), pre-start transaction bucketing and application warnings (K5), schema/engine validation boundaries (K7), readonly result sharing (K8), and baseline-horizon variance (K9).
- Installation, configuration, user, results, and validation guides, with a concise README and contribution guidance.
- Aligned Biome tooling and release verification across the configured Node CI versions.
- Fixed rounding for tiny commitments and normalized accepted near-100% schedules to exact commitment totals.
- Rejected sparse arrays, malformed runtime fund/transaction containers, unsafe monetary values, numeric overflow, and projection dates beyond year 9999 with structured errors.
- Made parsed config schemas directly assignable to the core TypeScript config, including strict optional-property checking.
- Added enforced coverage thresholds, recurrence/rate/allocation regression tests, executable documentation checks, and isolated tarball consumer tests for ESM/CJS, optional schemas, strict types, and browser bundling.
- Included linked documentation in the npm package, rebuilt output before packing, and required full verification before publishing. Updated vulnerable development tooling.
- Added hand-calculated end-to-end regression cases for the release invariants.
- Fixed packed-consumer verification during `npm publish --dry-run` and added a CI regression check for inherited dry-run configuration.
