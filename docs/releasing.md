# Releasing v1.0.0

This is the maintainer checklist for publishing `@osyte/fund-pacing`. Consumer
setup is in [Installation](installation.md). These commands do not run
publication automatically; the publish step is a separate maintainer action.

## What release verification checks

Run from a clean checkout of the exact release commit:

```sh
npm ci
npm run verify
```

`verify` runs lint, type checking, tests with coverage thresholds, a clean build,
executable documentation checks, and packed-package consumer checks.

| Check | Evidence |
|---|---|
| Unit tests | Calendar/money helpers, recurrence, rate resolution, multiples, and validation boundaries. |
| Property tests | Eight model invariants plus generated small/maximum-safe allocations and near-100% schedules. |
| Regression examples | Period-0 calls, full-term schedules, rescaling after actuals, malformed configs, fund life, and accepted K1/K5/K7/K8/K9 behavior. |
| Determinism | Shared snapshots under Node and jsdom, exact monetary values and floating outputs canonicalized at `1e-8`. |
| Coverage gate | At least 95% statements, 95% lines, 90% branches, and 100% functions across executable source. |
| Docs | Type-check and execute the consumer examples, assert documented values, and resolve local links and anchors. |
| Actual npm artifact | Build and pack, install the tarball offline into an isolated consumer, and verify the file list and package exports. |
| Imports and optional peer | Exercise ESM and CommonJS without Zod, then exercise `/schema` with Zod installed. |
| Consumer types | Compile `.mts` and `.cts` consumers under NodeNext, strict mode, and exact optional properties. |
| Browser target | Bundle the packed core for a browser target with no external imports, then compare its VM result with Node. |
| Package tooling | Run publint and Are the Types Wrong? against the packed artifact. |

The browser bundle check and jsdom cover bundling and browser-like globals.
They are not a test matrix of real browser engines. CI runs the full verification
command on Node 22 and 24 and uploads coverage reports.

`npm run test:coverage` writes `coverage/index.html` and `coverage/coverage-summary.json`.
Type-only declarations are excluded from the percentage. Snapshot output should
not be regenerated unless calculation changes are intentional and reviewed.

See the [arithmetic and invariant review](release-verification.md) for how coverage
is measured, hand-calculated outputs, and an independent exact-fraction check.

## Inspect package contents

The package includes built ESM/CJS files, both declaration formats, source maps,
README, license, changelog, contribution/security guidance, and the linked docs.
It excludes source directories, test suites, scripts, fixtures, local graph-demo
code, coverage output, credentials, and development dependencies.

`npm run check:package` performs a fresh build and checks those boundaries against
an actual tarball. It cleans up its isolated consumer afterwards. For a tarball
to inspect or retain yourself:

```sh
npm pack --dry-run
npm pack
```

`prepack` rebuilds `dist` before packing. `prepublishOnly` runs full verification
before a normal publish from this checkout. No install hook runs tests for
package consumers. Avoid `--ignore-scripts` when publishing from the checkout.

## Before publishing

1. Review and merge the release changes, including the original stacked blocker
   PRs and the subsequent fund-life, documentation, and hardening work. Publish
   from the reviewed commit; green checks on an older PR do not cover later work.
2. Confirm the four public functions, `fund_life` input, missing-actuals behavior,
   and [accepted conventions](known_issues.md) are the intended v1 contract.
3. Confirm `package.json`, root lockfile metadata, and the changelog agree on
   `1.0.0`, and that there are no uncommitted changes or real client inputs.
4. Run `npm ci` and `npm run verify` and require CI to pass for the release commit.
5. Refresh dependency advisories with `npm audit`. The core has no runtime
   dependencies; development-tool vulnerabilities still need review. Audit
   results are time-sensitive and are separate from the offline verification.
6. Authenticate to the intended npm registry with an account authorized to publish
   under the `@osyte` scope. Complete the applicable account/organization 2FA or
   approved publishing authentication requirements.

```sh
npm login --registry=https://registry.npmjs.org
npm whoami --registry=https://registry.npmjs.org
npm view @osyte/fund-pacing@1.0.0 version --registry=https://registry.npmjs.org
```

For an initial publication, the version lookup should not find an existing
`1.0.0`. A lookup failure alone is not proof of publishing permission. Confirm
scope access with the organization owner. npm cannot overwrite an already
published package name/version pair.

See npm's [scoped-public-package guide](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/)
and [publish command reference](https://docs.npmjs.com/cli/v11/commands/npm-publish/).

## Publish when ready

First preview the publish. This runs lifecycle checks but does not upload:

```sh
npm publish --dry-run --access public --registry=https://registry.npmjs.org
```

Then publish the same reviewed checkout:

```sh
npm publish --access public --registry=https://registry.npmjs.org
```

After successful publication, check the registry and install in a fresh consumer
project. Confirm both the normal entry point and optional schema entry if used:

```sh
npm view @osyte/fund-pacing@1.0.0 version dist.integrity --registry=https://registry.npmjs.org
```

Create the `v1.0.0` Git tag and GitHub release for that same commit, using the
changelog as release notes. Push Git changes using the repository's SSH remote.
The README version badge tracks the published npm version automatically.

## Local cache permissions

If your local npm cache is not writable, point npm at a writable temporary cache
for verification instead of changing ownership of unrelated directories:

```sh
npm_config_cache=/tmp/fund-pacing-npm-cache npm run verify
```

Use your platform's temporary-directory equivalent when needed.
