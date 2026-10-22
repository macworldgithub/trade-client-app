# Pentana scope and repository audit — 22 October 2026

The supplied report was treated as a set of claims to check, not as proof of portal access or instructions to change live records. This audit concerns the local `tradie-client-microservice` checkout and captured files; no live application MongoDB database was inspected.

## Corrections to the supplied report

1. Current available quantity 8 and bin A-14-02 for part 86812N9000 are NOT supported by this repository's captured invoice. The evidence contains quantity ordered/shipped 1 and explicitly null current quantity. An invoice does not establish current stock or a bin.
2. `parts_details_discovery.json` documents customer account parts settings (`EntityParts.htm`), not a discovered catalogue/Stock tab. A systematic pass through that screen will not produce a parts master or stock ledger.
3. The 34 prior account captures cover receivable-marked rows within the SMASH query, not the full entity-50 account book. Captured fields may be blank. Prior YTD purchases are populated on 20/34 and financial-year parts sales on 9/34.
4. Source credit_hold and overdue_flag are null in the original exports. Any calculated application flags need explicit derivation/provenance; they are not scraped source booleans. Home site is also null.
5. The report names seed.ts, dashboard services, parts resolvers, PartsCheck RFQ services, rooftop seed records and MongoDB behavior that are not present in this checkout. They may describe a different project/build, but cannot be verified from this repository.
6. This checkout has Auth/Mail/Users Nest modules and Python automation helpers. `Era_power.py` raises NotImplementedError for account/part lookups. `parts_finder.py`, `Era_customer.py`, `Era_supplier.py` and `Era_quote.py` contain placeholder results. CSV captures do not make these into live integrations.
7. The previously inspected STORE50 vehicle CSV folder is not present in the current checkout. The earlier vehicle inventory findings remain separate from parts scope; vehicle stock IDs/prices cannot seed parts stock/pricing.

## Existing verified snapshot

`pentana-extraction-v3-2026-10-21` contains 185 SMASH-search contacts with detail capture, 34 related account screen captures, 34 pricing rules, 52 price-code references, 15 distinct warning notes and one historical invoice line. Contact capture dates span 20–21 October; prior financial captures are dated 20 October. Older export folders overlap this snapshot and must not be added together as distinct records.

## Scope assessment

| Requirement | Verified evidence | Remaining work |
|---|---|---|
| Catalogue part number/description | One posted invoice observation | Confirm parts-master enquiry/export and extract all source part IDs/descriptions |
| Franchise/category/fitment | Null for the observed part | Identify source fields; fitment may require an OEM feed |
| Quantity available per rooftop | None verified | Parts on-hand/allocated/available values, rooftop mapping and snapshot timestamp |
| Bin/pick location | None verified | Read warehouse bin data rather than vehicle location codes |
| Open POs | No line records | Parts purchasing report with ordered/received/outstanding quantities |
| Stock transfers | No movement records | Transfer ledger with origin/destination, part and outstanding quantity |
| Current list/account prices and discounts | Pricing rules and one historical invoice | Part-and-account enquiry/export with current effective pricing and tax basis |
| Trade identity/contact/terms | Query-specific contact/account captures | Broaden query coverage, verify active-trade criteria and business/legal-name meaning |
| Home site | Not verified | Separate source site from account home-site mapping |
| YTD spend | Separate Purchase YTD and FY parts-sales fields | Preserve both, retain FY label, verify intended business measure |
| Hold/overdue flags | Aging/code labels and notes only | Explicit source flags or documented derived rules |
| All precincts | Verified captures from entity 50 only | Verify entity-to-precinct mapping and access before further site captures |

See capture_summary.json for the exact additive 22 October counts, overlap and pending-account status. This run's AUTO + DANDENONG query is also a sample, not proof of full-book coverage. Zero current-stock coverage must not be represented as one live stock item.

## Automation required

1. Account extraction can use the authenticated-page routines included here. Search chunks must remain below the portal limit of 1,000 results, reconcile page counts, deduplicate by source context plus ID, and retain an independently verified book total before marking complete.
2. Current catalogue/stock/pricing extraction cannot be configured honestly until an actual authorized source screen, supported export or API is identified. No hidden endpoints or denied programs should be used as substitutes.
3. Confirm the entity-50 parts counter interface and obtain read-only enquiries or exports for parts master, stock/bin balances, outstanding POs, transfers, account-specific prices and the full debtor master.
4. Retain timestamps and source context; apply freshness limits to stock/pricing; retain historical invoice observations separately. Never turn missing values into available stock, clear credit or zero prices.
5. Map source store codes to approved precincts; current capture context is not proof of home site. Do not seed a synthetic rooftop/brand mapping as verified Pentana data.
6. Import into the application's actual persistent models only after its location/schema is verified. Do not claim the files are connected to MongoDB simply because exports exist.

No PartsCheck automation, write-back, settings changes or user-management changes were performed in this run.

## Final 22 October findings

The additive query completed: 425 unique search rows on 48 pages and all 56 receivable candidates captured across the three related account screens, plus contact details. No candidate remains pending. Combined with the earlier bundle: 610 discovered contact IDs, 241 full contact details and 90 account captures. This is not full-book coverage.

Entity 50 Main, Accounting, Service, Service Reports, Utilities, Printer and Showroom menus were rechecked on 22 October; raw text and timestamps are in portal_menus.json. No Parts module is displayed. Entity 52 was also opened successfully; its main menu and Accounting menu match entity 50. That is menu verification only, not a complete entity-52 data extraction. STORE03 was never selected. See entity52_menu_check.json.
