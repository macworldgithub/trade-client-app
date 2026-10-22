# Pentana extraction v3 — 21 October 2026

185 unique contacts from the SMASH search in entity 50 (Dandenong Mitsubishi & Hyundai), across all 21 result pages. All 185 contact details are now captured; the remaining 27 were retrieved on 21 October. Earlier 158 contacts and 34 account financial/pricing-rule records were captured on 20 October and were not refreshed today.

This is query-specific coverage, not the entire customer book. STORE03 is excluded. Entity 52 appears in historical invoice references; this bundle is not a complete entity-52 export.

## Files for import

- business_entities.json/csv: 185 contact/business records, source IDs retained as strings.
- trade_accounts.json/csv: 34 receivable candidates with captured payment terms, credit values, YTD purchases and financial-year parts sales where exposed.
- account_pricing_rules.json/csv: 34 account pricing settings, not current quoted unit prices.
- price_level_reference.json/csv: 52 source pricing codes and labels.
- account_warnings.json/csv: source warning text; do not automatically translate notes into credit-hold flags.
- invoice_price_observations.json/csv: one historical invoice line, not a current offer.
- parts_observed.json/csv: one historically invoiced part, not a complete catalogue.
- entity_search.json/csv and pagination_evidence.json: original query evidence.
- entity_details_raw.json and account_screens_raw.json: field-level audit evidence.
- resumed_details_raw.json: the 27 contacts captured on 21 October.
- pending_details.json: empty; all contacts from this query are enriched.

## Import constraints

Preserve leading zeros in IDs, part numbers and postcodes. Empty CSV fields represent blank source values or JSON null; use JSON when the distinction matters. Account IDs are Pentana IDs, not application user IDs. Home site, explicit credit-hold and overdue flags remain null when unverified. YTD purchases and financial-year parts sales are separate measures.

Current stock per rooftop, bins, open purchase orders, stock transfers, current account-specific unit prices/discounts, full parts catalogue, franchise, fitment and category are not captured. Do not manufacture seed values for them. OEM availability, supersessions and supplier ETAs need their separate confirmed feeds.

The portal vehicle inventory and vehicle pricebook are not parts stock/catalogue. Account Parts Details > Order Details contains pricing defaults rather than open POs. No live source records were saved.

The application currently lacks complete persistent parts/stock/account models and an importer; this is a validated interchange bundle, not a complete operational seed. Review source data before seeding. Financial data and contact information are confidential.

The automation folder contains authenticated-page read-only capture routines with source entity checks. No credentials are bundled. manifest.json records counts, validation and file checksums.

Additional inspection on 21 October: Transfer Details is account transfer defaults, not a stock ledger. Credit Details is a credit-reference table, not an explicit hold flag. See the corresponding discovery JSON files.
