# Duty Ledger

An importer-side customs and duty control layer: entry audit, duty recovery and a SKU-level tariff monitor for US small and mid-market importers. The long-term aim is the importer's system of record for product classification and duty owed, with room to grow into a broader trade OS.

Strategy and rationale come from the diligence report "The Operating System for Global Trade" (Oct 2026). The approved build plan is in `docs/PLAN.md`; the short version is below.

## Principles

1. **The record is the product.** Product master (SKU → HTS-10 → origin → evidence → outcome) plus duty history across all brokers.
2. **Deterministic core, AI at the edges.** Tariff math, deadlines and the ledger are plain tested code. AI extracts, proposes and drafts.
3. **Advisory, never filing.** No CBP filings and no holding of duty funds in v1.
4. **Neutral.** No freight or brokerage agenda in v1.
5. **Refunds are the hook, not the business.**

## Status

Phase 1, week 0. Built so far:

- `src/tariff/`: tariff-stack engine (rules as data, effective windows, origin and HTS matching, MPF clamping, paid-vs-expected discrepancy detection) with tests.
- `db/schema.sql`: Postgres schema with tenant row-level security, an append-only audit log and a first-class approval gate.

## Important caveats

- **Tariff rules in the tests are invented fixtures**, not real rates. Real rules must be ingested from HTSUS, the Federal Register and CBP CSMS, with citations. Until that exists, the engine's output must not be used for real duty decisions.
- **MPF parameters** (0.3464%, $33.58 min, $651.50 max) come from the report's FY2026 figures. Verify against current CBP guidance.
- A **golden test set** of real historical entries with known correct duties is the most important missing asset.

## Run the tests

```
npm test
```

Requires Node 22.6+ (uses built-in type stripping; no dependencies).

## Next

1. Concierge validation with real ACE exports (assumptions 1, 2, 5).
2. ACE report and invoice ingestion.
3. Rule ingestion from public sources and the golden test set.
4. Findings dashboard and design-system tokens.
