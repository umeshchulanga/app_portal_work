# ACT vehicle ownership transfers

Open `index.html` in your browser, or serve this folder using your existing static hosting. Keep the `assets` folder beside `index.html`. There is no application build step, framework, or backend.

## Preserved behavior

- Same eight record fields, required form fields, Sinhala vehicle categories and category order.
- Add, edit, cancel, confirmed delete, and inclusive date filtering. The table shows newest transfer dates first, retaining insertion order for equal dates. Storage and report order remain unchanged. Records without transfer dates remain excluded from the table and reports, as before.
- Same local storage key (`vehicle_transfer_data`), JSON array structure, and backup filename (`vehicle_transfer_records_backup.json`). JSON backups include all records regardless of filters. Import replaces the current dataset.
- Browser file-picker import links a JSON file for subsequent writes when supported. Other browsers retain ordinary file import. A linked file must be selected again after a page reload, as before.
- DOCX exports use the current filtered records. All original placeholder names (including legacy spellings), category groupings, zero-value placeholders, and receipt values are retained. Totals use Amount 2 only. Unit prices average only positive Amount 2 values. The filename and report year/month use the current date, as before.
- The date input retains its original UTC-derived default. Amount parsing remains unchanged; no new monetary restrictions are imposed.

## Improvements

The interface has consistent spacing, clearer editing and storage states, sticky table headings, keyboard-accessible controls, associated labels, and empty states. Record text is rendered through DOM text nodes. Edits track their record even after earlier rows are deleted. Import validates the complete candidate before replacing records or the active file link. File writes run sequentially, and failed browser/file saves remain visible instead of reporting success.

Validation preserves numeric amount values, optional legacy fields, unknown vehicle category strings, and extra JSON properties during import/export. It rejects malformed record structures with a record-specific error; it does not silently repair or discard rows. Editing still saves the original eight form fields.

## Source layout

- `index.html`: accessible page structure and existing pinned CDN dependencies.
- `assets/styles.css`: presentation and responsive layout.
- `assets/defaults.js`: original sample records.
- `assets/report.js`: shared vehicle categories and existing DOCX payload calculations.
- `assets/app.js`: record workflows, persistence, table rendering, import/export, and event bindings.

The existing Bootstrap, Font Awesome, PizZip, Docxtemplater and FileSaver dependencies still load from their original CDN URLs. Document export reports a clear error if its dependencies are unavailable.

## Verification

Run `node tests/verify.cjs` with Node 20 or later and Playwright/Chromium available. The script defaults to the bundled Codex Playwright and locally installed Chromium paths. Set `PLAYWRIGHT_PACKAGE` and `CHROMIUM_PATH` to use another installation. Internet access is required for the original CDN dependencies.

`tests/baseline.html` is the untouched pre-change app, retained only as a compatibility fixture. Tests use isolated browser profiles and synthetic file handles; they do not read or modify your browser records or linked files.

The checks compare 23 report datasets against the original calculations, including every category and edge-case fee values. Browser checks cover record workflows, filtering, persistence, JSON downloads and both import paths, rejected/cancelled imports, save failures/recovery, text safety, direct file opening, and mobile overflow. A generated DOCX fixture exercises every placeholder through both production export paths with identical date filters, then compares every unzipped document part for content/layout equality. Screenshots are saved under `tests/artifacts`.

No user-supplied DOCX template was present; compatibility was verified with the generated fixture and unchanged payload contract. Actual operating-system file permission prompts are represented by simulated handles in the automated checks.
