# Interactive fund-pacing example

[Open the live notebook](https://observablehq.com/@dentrassi/osyte-fund-pacing)
to explore a synthetic $50 million commitment, change model assumptions, enter
transaction history, and compare the original forecast with the reprojection.
Share that URL with customers; they can use the example without installing the
library. The root README also links to it, including when the README is shown
on npm after publication.

## Source and library version

[fund-pacing.html](fund-pacing.html) contains the notebook's editable source in
the open [Observable Notebook Kit format](https://observablehq.github.io/notebook-kit/kit#the-notebook-file-format).
It is notebook source, rather than a compiled web page; opening the file directly
in a browser will not run its cells. Use the live link or the optional preview
below.

The source was exported from Rohit Mathur's
[notebook revision 113](https://observablehq.com/@dentrassi/osyte-fund-pacing@113)
on October 24, 2026. It imports **`@osyte/fund-pacing@1.0.0`** explicitly.
All 16 cells are included; there are no file attachments. The JavaScript cells
use the modern `module` cell type, correcting the older export tool's legacy
cell-type mapping.

The repository copy uses `result.asOf` for historical shading and the next-two-year
summary. This keeps the transaction cutoff correct when historical rows have
modeled NAV and `source: 'forecast'`. Individual row labels still come directly
from the library. This local adjustment does not update the live notebook;
its owner must apply it there when updating the example.

The default example uses annual periods and compares the shared baseline and
revised horizon. See the [user guide](../../docs/user-guide.md) for quarterly and
semiannual configurations, term extension, and the meanings of `source` and
`asOf`. Amounts entered as dollars in millions are converted to integer cents
before calling the library.

## How it stays separate from the library

The notebook is a consumer of `@osyte/fund-pacing`. Observable and its charting
tools are used only to present the example. The core library imports none of
them, and its normal installation, build, tests, and publishing require no
Observable account or service.

Optional preview tooling has its own private `package.json` in this folder.
No Observable dependencies or scripts are added to the root package. The
package's existing `files` allowlist excludes `examples/`, so notebook source
and preview assets are not shipped to npm or GitHub Packages.

## Optional local preview

From the repository root, using Node 24, install the example's optional tooling
and start its preview:

```sh
npm ci --prefix examples/observable
npm run preview --prefix examples/observable
```

Open the local URL printed by the command and select `fund-pacing.html`.
These commands install tooling only in `examples/observable/node_modules`,
without changing the library's root `package.json` or lockfile. Internet access
is needed for the tool and the example's published library and visualization imports. The
notebook continues to use version 1.0.0; it does not automatically use this
checkout's source.

For a static build using the same optional tooling:

```sh
npm run build --prefix examples/observable
```

Generated files under `.observablehq/` or `.observable/` are ignored locally.
Building locally does not deploy or update the live notebook.

## Updating examples for future releases

1. Choose the released library version the example should demonstrate. Update
   the notebook's `npm:@osyte/fund-pacing@1.0.0` import to that exact version;
   keep it pinned so a future release cannot silently change the example.
2. Add or revise cells to explain the release's features, using synthetic data.
   Keep calculation logic in the library and presentation logic in the notebook.
   Use `asOf` for the transaction cutoff and `source` for individual row labels.
3. Check the default example, changed assumptions, empty transaction history,
   and calls or distributions without NAV. Check invalid inputs display useful
   errors, and verify charts and summaries against the library's returned rows.
4. When authorized to update the live notebook, its owner can use Observable's
   Share panel to export HTML. Save that source as `fund-pacing.html` and review
   the diff. Include all input and calculation cells, not just rendered charts
   or the older compiled JavaScript export. Preserve the `asOf` adjustment if
   it has not yet been applied upstream.
5. Update this README's version, revision, and export date. Keep the root README
   and user-guide links pointing to the customer-facing notebook. Run
   `npm run check:docs` and `npm run check:package` after building the library;
   optionally preview or build the notebook using the commands above.

The Git copy and live notebook are maintained separately; editing one does not
update the other. Notebook publication and library release are explicit steps.
