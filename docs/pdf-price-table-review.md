# Text PDF price-table review

Use `/items/price-imports`, select **PDF_TABLE**, then inspect the source. This is a manual deterministic review tool. It does not classify mail, run OCR, execute embedded instructions or guess a document's business rules.

## Operator flow

1. Upload the PDF and inspect its preserved text layout. Each line has its original PDF page and a global source row number. Previous/next source buttons inspect all rows, 100 at a time.
2. Enter column character ranges in increasing order. The UI uses inclusive positions starting at **1**: for example `1-20,21-30,31-50`. The server stores those as zero-based start/end-exclusive ranges. These are extraction coordinates, not example prices or business defaults. Blank ranges block mapped preview.
3. Inspect the selected PDF columns, then map their numbered cells to CRM part code, unit, exact price and any other supplied values. Explicit constants may be entered only where no source column is mapped.
4. Select the first data row. Enter any repeated page headers or footnotes as explicit excluded source row numbers separated by commas. The server rejects duplicate, invalid or nonexistent exclusions. It does not silently remove rows that resemble headers. Review the exclusion count and the retained mapping when deciding an import.
5. Complete list name, currency, date range, discounts and reason. Preview every mapped row, correct every error, and save an inactive review. The retained bytes, column ranges, exclusions, item revisions and metadata bind the plan fingerprint.
6. Follow the same configured-policy and independent-approval flow as CSV/XLSX. Changing source bytes, mapping, product units/revisions or policy requires a new review. A text extraction result is not automatic approval.

## Host capability and bounds

The existing app invokes `scripts/lib/price-pdf-table.py` as a transient CLI using `python -I`, piped bytes and JSON. It creates no upload file, listener, cloud call, scheduled worker or connector process. `scripts/lib/requirements-pdf.txt` pins the dependency tested here (`pypdf==6.14.2`). Python/pypdf must be provisioned on the target host; this task installs nothing. Missing Python or pypdf returns `PDF_EXTRACTOR_UNAVAILABLE` and leaves the review uncommitted.

Limits: 8 MiB source, 1,000 PDF pages, 20,000 source lines, 2,000 characters per line, 16 MiB extracted text, 32 MiB structured output, 100 explicit non-overlapping columns, 15,000 mapped price rows and a 30-second extraction timeout. At most two PDF extractions run concurrently in this app process; additional requests receive a retryable busy error. The child process is terminated when its timeout or output bound is exceeded. Raw parser diagnostics are discarded so failures do not log client prices or document contents.

Encrypted or damaged PDFs are refused. Image-only PDFs are refused with a message to supply readable text or a reviewed spreadsheet. Scanned, rotated or variable-layout tables may need an explicitly reviewed CSV/XLSX prepared by the operator; no extraction or price value is invented. A PDF that crosses these technical bounds must be split into reviewed source files. Host-level process memory isolation is an operator deployment concern; the extractor has time/output bounds and does not claim an OS memory sandbox.

## Verification and remaining acceptance

`test/price-pdf-table.test.js` checks explicit boundaries, repeated-header exclusions, changed fingerprints, malformed and empty PDFs, the concurrency bound, and a complete synthetic 15,000-row PDF extraction/plan without database writes. `test/price-import-workflow.test.js` adds a PDF original-byte/exact-price/independent-approval activation test inside the existing rollback harness on `mehta_electronics_local`.

No real client PDF price-list layout was supplied for acceptance of this new flow. Private Siemens/combined pricing fixtures currently cover XLSX literal extraction. Browser rendering, target-host Python provisioning and client-selected PDF mappings still need acceptance. This delivery does not complete the remaining price-level, contract-selection, supersession or stock-analysis requirements in S2.
