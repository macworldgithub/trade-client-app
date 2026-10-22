# Additive Pentana extraction — 22 October 2026

This folder supplements `pentana-extraction-v3-2026-10-21`; it does not replace it. Entity 50: Dandenong Mitsubishi & Hyundai. STORE03 excluded. No source business records were saved or orders submitted.

## What was searched

Entity Maintenance > Entity Search (F3), Customer & Prospect, all six visible customer type options selected, Search Name 1 `AUTO`, Suburb `DANDENONG`. All 48 pages reconciled to 425 unique IDs. A name-only AUTO search exceeded the portal's 1,000-result limit. The '*' search did not provide an unrestricted account listing. Search partitions require count reconciliation and an independent full-book total before claiming book completeness.

The result set includes customer and prospect records. `PROS` means prospect and is excluded from receivable candidate selection; it must not be treated as an R receivable marker. The remaining 56 rows containing R are candidates for financial screen capture, not a declaration that all are active approved trade customers. Screen IDs are verified separately for each account.

## Files

- `entity_search.json/csv`: all 425 search rows; not all have enriched contact details.
- `search_evidence.json`: filter state and per-page rows, counts and page numbers.
- `contact_details.json/csv`: full contact fields for accounts whose related screens were captured.
- `trade_accounts.json/csv`: captured receivable values, aged balances and separate YTD measures.
- `account_pricing_rules.json/csv`: account price-level/payment settings, not part-specific unit prices.
- `account_warnings.json/csv`: exact warning notes; these are not normalized hold flags.
- `account_screens_batch_*.json`, `account_screens_raw.json`: raw contact and financial field evidence.
- `pending_accounts.json/csv`: candidate IDs not yet fully captured; consult latest summary for completion.
- `capture_summary.json`: counts, overlap with v3 and explicit scope completeness flags.
- `repository_csv_inventory.json`: inventory of pre-existing CSV files across overlapping snapshots; do not sum these as distinct source records.
- `automation/`: read-only authenticated-page Playwright routines. Account runner starts from Entity Maintenance and verifies entity 50. Search reader processes at most 12 pages per invocation and advances to the next page; combine batches and reconcile totals before import.

## Import rules

IDs and source numbers remain strings to preserve leading zeros. Values are source strings; empty is not automatically zero. Use JSON to preserve null versus blank. Account business names are source business-name values, not an independently verified legal registry match. Source entity 50 is the capture context, not a verified home site. Home site, credit_hold and overdue_flag remain null. Credit-code labels and warning text are preserved without inferred classifications. Purchase YTD and financial-year parts sales are distinct measures; the FY label is retained.

No current parts stock, bins, catalogue, purchase-order lines, transfer lines, current account-specific part prices or discount percentages are populated by this extraction. The prior posted invoice line does not verify available quantity or bin. A previously circulated report's quantity 8/bin A-14-02 claims are not supported by the captured evidence.

These files contain confidential contact and financial information. The archive manifest lists file checksums and capture status. A successful archive validation establishes consistency of captured files, not completeness of Pentana's full book or current stock.

## Completed query totals

All 56 receivable candidates have contact details and three related account screens captured. No candidates remain pending in this query. Together with the prior snapshot: 610 unique discovered contact IDs, 241 fully detailed contacts, and 90 captured accounts. This remains query-specific; 369 new search contacts have search-level details only.
