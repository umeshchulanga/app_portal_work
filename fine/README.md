# Fine collection app

Open `index.html` in a browser. Keep the `assets` folder alongside it. No build step or server is required. Bootstrap and Font Awesome continue to load from their existing CDN URLs.

## Preserved behavior

The existing JSON array format, browser-storage key, file-handle database, field order, paid-date filtering, record order, report defaults and Sinhala report content are retained. Day counting remains inclusive; fines double above 14 days; the vote split remains 60/40 with the original rounding.

## Reliability changes

Linked-file writes are serialized. Pending browser edits are marked in browser storage and written on reconnect rather than replaced by older file content. Import and linked-file loading normalize textual and numeric fields without recalculating stored amounts. Fractional imported IDs survive editing. Invalid or cleared calculation inputs reset the displayed amounts. Imported text is escaped, and record action handlers no longer embed IDs in HTML.

## Verification

- `node --check assets/app.js`
- `node tests/verify.cjs`: comparisons with the original fixture for calculation boundaries and all four quarterly reports, plus regression checks for imports, IDs, queued writes and reconnect.
- `tests/browser.cjs`: Playwright smoke check using installed Edge; requires Node 20+ and Playwright. Exercises entry, table rendering, report generation, a 390px mobile viewport and print PDF generation.

`tests/baseline.html` is the original application retained only as a regression fixture. Screenshots and the PDF in `tests` are generated from synthetic data. Native file-picker permission dialogs still require an interactive browser check; persistence tests use simulated file handles.
