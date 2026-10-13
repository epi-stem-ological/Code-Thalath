# Duty Ledger: plan for an importer-side customs control layer that grows into a trade OS

## Context

Source: the diligence report "The Operating System for Global Trade" (Oct 2026). Its conclusion: don't build a Bloomberg-style terminal, a freight marketplace or a super-app first. Build an importer-owned customs and duty control layer for US SMB and mid-market importers. Enter through entry audit and duty recovery, then grow into the importer's system of record for product classification and duty owed. Later add brokerage execution, duty finance and freight.

The user wants the best possible app that can expand into an all-purpose one-stop-shop for importers and exporters.

**Decisions made with the user:**
- Scope: narrow wedge now, with an architecture built so other modules plug in later.
- Team: solo or tiny team, shipping fast on managed services.
- This plan covers architecture and data model, MVP spec and UX, validation of the kill assumptions, and the design system.

**State of the repo:** `epi-stem-ological/Code-Thalath` is empty (one initial commit, no files). This is a greenfield build. Nothing exists to reuse. A private, empty Design System artifact exists at https://claude.ai/artifact/EjqqdyGZuso2A1K4rGKNxU.

**The tension to manage.** "One-stop-shop" is the destination. The report's evidence says products that need many parties at once stall on cold start (TradeLens, marketplaces), and products that deliver single-player ROI first become the network later. So the plan treats the OS as an architecture goal, not an MVP scope.

## Principles (strategy, not tactics)

1. **The record is the product.** The compounding asset is the importer's product master (SKU to HTS-10 to origin to evidence to outcome) and their duty history across every broker. The model and the tariff content are not the moat.
2. **Deterministic core, AI at the edges.** Tariff-stack math, deadlines and the ledger are plain tested code. AI extracts documents, proposes classifications with evidence and drafts correspondence. A human approves anything that is filed, paid, classified for duty, or admits liability.
3. **Advisory, never filing.** The app never files with CBP and never holds duty funds in v1. Corrections route to the importer's licensed broker or a partner. This keeps us outside 19 CFR Part 111 and money-transmission rules.
4. **Neutral by construction.** No freight or brokerage agenda in v1. This is the main answer to Flexport's free audit.
5. **Refunds are the hook, not the business.** Success-fee recovery acquires customers. Monitoring and pre-filing checks retain them.

## Architecture

### Stack (assumptions, flag if you disagree)
- Web app: TypeScript, Next.js, Postgres (Supabase or Neon), object storage for documents, a job queue (Inngest or Trigger.dev) for ingestion and audit runs.
- AI: hosted Claude models for extraction and classification proposals, behind one `ai/` module so it can be swapped. The current model IDs are `claude-fable-5-1`, `claude-opus-5-5`, `claude-sonnet-5-5` and `claude-haiku-5-5`. Check the `claude-api` skill before wiring.
- Auth and tenancy: row-level security with `org_id` on every table from day one. This is cheap now and very expensive to retrofit.

### Module boundaries (the "OS-ready" part)
A modular monolith. Each module owns its tables and exposes a narrow service interface. Later modules attach to the same core.

| Layer | Module | Phase |
|---|---|---|
| Core | `org`, `auth`, `documents`, `audit_log` | 1 |
| Record | `product_master`, `entries`, `duty_ledger` | 1 |
| Intelligence | `tariff_engine`, `change_monitor` | 1 |
| Workflow | `audit`, `recovery`, `broker_handoff` | 1 |
| Adjacent | `landed_cost`, `prefiling_check`, `screening` | 2 |
| Execution | `brokerage`, `bonds`, `isf` | 3 |
| Network | `broker_scorecards`, `duty_finance`, `freight` | 4 |
| Global | jurisdiction adapters (EU first) | 5 |

Rule that keeps expansion cheap: the core data model is jurisdiction-neutral. Duty authorities, rates and rules are data, and only the tariff engine knows about the US.

### Data model (core tables)
- `organization`, `user`, `importer_of_record` (IOR number, bond info)
- `broker` (name, license ref) and `broker_relationship` (a customer can have many brokers)
- `document` (type, source, storage path, extraction status, hash)
- `entry` (entry number, port, dates, liquidation status, broker) and `entry_line` (HTS-10, country of origin, value, quantity, duty by authority: MFN, 301, 232, IEEPA, 122, MPF, HMF)
- `product` (SKU, description, supplier, attributes) and `classification` (product to HTS-10, origin, confidence, evidence links, status: proposed, reviewed, accepted, disputed)
- `tariff_action` (authority, effective window, scope by HTS, rate, source citation) and `tariff_exposure` (product × action impact)
- `finding` (type: misclass, origin, valuation, stacking, refund-eligible; dollars recoverable and at-risk; confidence; evidence) and `recovery_case` (status, deadline, assigned broker or counsel, outcome)
- `audit_event` (append-only: who, what, when, before and after)

### The tariff-stack engine (highest-risk component)
- Input: HTS-10, origin, entry date, value, special programs. Output: the list of applicable authorities with rates and citations.
- Rates and effective windows live in versioned data tables with source references, not in code. Every result carries the rule version used.
- Needs a golden test set: real historical entries with known correct duties. This is the single most important test asset.
- Open data question: where the tariff rules come from (HTSUS, USITC, Federal Register, CBP CSMS). Build ingestion for public sources first. The report calls this content non-differentiating, so don't over-invest.

### AI vs deterministic split
- AI: extract invoices, 7501s and ACE reports into structured fields; propose classifications with cited rationale; flag cross-document inconsistencies; summarize tariff actions and map them to SKUs; draft broker emails, PSCs and protests.
- Deterministic: stack math, MPF/HMF, liquidation and 180-day protest deadlines, permissions, audit log.
- Human approval required: any filing, prior disclosure, classification used for payment, payment, protest, or liability-admitting message. Build the approval gate as a first-class object in v1, not an afterthought.

## MVP spec (Phase 1: "Duty Ledger")

### First 15 minutes (the design target)
1. Sign up with a work email; capture the IOR number.
2. Upload the ACE entry summary report (CSV/Excel) the importer downloads from its own ACE portal, plus 5 to 20 invoices or 7501s by drag-and-drop.
3. Within minutes see: duties paid by year and authority; estimated refund-eligible amount and status; top 10 anomalies; SKUs most exposed to the July 24, 2026 Section 301 regime.
4. One call to action: approve a review of $X potential recoveries, routed to their broker or a partner.

### Screens
1. Onboarding and upload
2. Findings dashboard (recoverable $, at-risk $, by entry and by authority)
3. Entry detail (line-by-line audit with evidence)
4. Product master (SKU table with confidence and review queue)
5. Recovery cases (status, deadlines, handoff packet)
6. Tariff change feed filtered to my SKUs
7. Audit file export (five-year retention under 19 CFR 163.4)
8. Settings (brokers, team, data-use consent)

### Explicitly out of v1
Freight booking, supplier marketplace, messaging network, eBL, filing, payments, lending.

### Pricing (v1 stance)
Free audit, then contingency on recovered duties (10 to 20%) plus a monitoring subscription. Per-entry pre-filing check arrives in Phase 2.

## Validation plan (the 5 kill assumptions, run before and during the build)

| # | Assumption | Test | Pass signal |
|---|---|---|---|
| 1 | Importers can pull ACE data and upload it fast | 20 target importers, timed | Most finish in under 10 min |
| 2 | Audits find recoverable or at-risk dollars beyond IEEPA refunds | Manually audit 50 real entry histories with consenting importers | Median finding justifies recurring fee |
| 3 | Importers pay for an independent check | Paid pilots at $1,000 to $3,000/month after a free audit | At least 40% convert |
| 4 | The product master can be built mostly automatically | Measure auto-mapping precision on real invoices plus entries | Over 95% precision on repeat SKUs |
| 5 | Brokers don't retaliate | 20 broker interviews, including CargoWise users | Most cooperate or want white-label |

Run #1, #2 and #5 as concierge tests (manual audit, spreadsheet output) before writing the full app. That is the cheapest way to avoid building on a false premise. Re-verify the report's CBP FY2024 to 2026 entry-volume figures on the live CBP page, since the report flags them as a stale snapshot.

## Design system

Use the existing Design System artifact. Direction: a sober, ledger-like, trust-first interface (finance and compliance tone, not logistics-dashboard clutter). Tokens needed: a neutral surface scale, a restrained accent, status colors for recoverable, at-risk, and resolved, and a tabular numeric text style. Components: findings table, evidence panel, confidence badge, deadline chip, approval gate, KPI tile. Text contrast 4.5:1 in light and dark themes. No brand or logo exists yet, so tokens start as a small starter set, labeled as such.

## Build sequence

1. **Week 0 to 2:** concierge validation (#1, #2, #5), repo scaffold, auth and tenancy, schema, design system tokens.
2. **Week 2 to 6:** ACE report and invoice ingestion, entry and line normalization, tariff-stack engine with golden tests, findings dashboard.
3. **Week 6 to 10:** product master and classification proposals with evidence, tariff change monitor, recovery case handoff packet, audit export.
4. **Week 10 to 14:** paid pilots, instrument time-to-first-insight and dollars found, decide the Phase 2 gate.

Phase gates are in the report's expansion roadmap. Do not start Phase 2 until at least 40% of audited customers convert to monitoring and median time to first insight is under 15 minutes.

## Risks to watch

- Refund wave ends. Mitigation: price on monitoring, not refunds.
- Classification liability. Mitigation: advisory framing, human gates, E&O insurance, counsel review of terms before launch.
- Flexport's free audit. Mitigation: neutrality plus the multi-broker record.
- ACE report granularity may be too coarse for SKU-level audit. Mitigation: combine with invoices; test in the concierge phase.

## Verification

- Tariff engine: golden-set test suite on real historical entries; run on every rate-table change.
- Ingestion: fixture ACE reports and invoices, including malformed ones; extraction accuracy measured against hand-labeled data.
- Tenancy: automated tests that one org can never read another's rows.
- End to end: a scripted run of the first-15-minutes flow with a sample importer dataset, timed.
- Business: the validation table above is the real acceptance test.

## Open items for the user

- Confirm the stack assumptions above.
- Do you have access to real ACE exports or friendly importers for the concierge tests? Without them, assumptions #1 and #2 can't be tested.
- Who reviews liability and terms (trade counsel)?
