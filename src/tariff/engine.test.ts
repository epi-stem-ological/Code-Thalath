import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMpf, computeStack, expectedByAuthority, findDiscrepancies } from './engine.ts';
import type { EntryLine, TariffRule } from './types.ts';

// TEST FIXTURE RULES ONLY. Rates and windows are invented to exercise the engine.
// They are NOT authoritative tariff data. Real rules must be ingested from
// HTSUS / Federal Register / CBP CSMS with citations (see README).
const rules: TariffRule[] = [
  {
    id: 'fx-mfn-6110',
    authority: 'MFN',
    rate: 0.1,
    effectiveFrom: '2020-01-01',
    effectiveTo: null,
    htsPrefixes: ['6110'],
    origins: [],
    citation: 'fixture',
    ruleVersion: 'fixture-1',
  },
  {
    id: 'fx-301-cn',
    authority: 'S301',
    rate: 0.25,
    effectiveFrom: '2024-01-01',
    effectiveTo: null,
    htsPrefixes: ['6110'],
    origins: ['CN'],
    citation: 'fixture',
    ruleVersion: 'fixture-1',
  },
  {
    id: 'fx-ieepa-window',
    authority: 'IEEPA',
    rate: 0.1,
    effectiveFrom: '2025-04-05',
    effectiveTo: '2026-02-20',
    htsPrefixes: [],
    origins: [],
    citation: 'fixture',
    ruleVersion: 'fixture-1',
  },
];

const line = (over: Partial<EntryLine> = {}): EntryLine => ({
  entryNumber: 'E1',
  lineNumber: 1,
  hts: '6110.20.2079',
  origin: 'CN',
  entryDate: '2025-06-01',
  value: 1000,
  ...over,
});

test('stacks MFN, 301 and IEEPA when all apply', () => {
  const r = computeStack(line(), rules);
  assert.deepEqual(r.components.map((c) => c.authority).sort(), ['IEEPA', 'MFN', 'S301']);
  assert.equal(r.total, 450);
});

test('origin filter excludes 301 for non-CN goods', () => {
  const r = computeStack(line({ origin: 'VN' }), rules);
  assert.ok(!r.components.some((c) => c.authority === 'S301'));
});

test('effective window is inclusive at both ends and closed after end date', () => {
  assert.ok(computeStack(line({ entryDate: '2026-02-20' }), rules).components.some((c) => c.authority === 'IEEPA'));
  assert.ok(!computeStack(line({ entryDate: '2026-02-21' }), rules).components.some((c) => c.authority === 'IEEPA'));
  assert.ok(!computeStack(line({ entryDate: '2025-04-04' }), rules).components.some((c) => c.authority === 'IEEPA'));
});

test('HTS matching ignores dots', () => {
  assert.ok(computeStack(line({ hts: '611020' }), rules).components.some((c) => c.authority === 'MFN'));
});

test('every component carries rule id and version for auditability', () => {
  for (const c of computeStack(line(), rules).components) {
    assert.ok(c.ruleId && c.ruleVersion && c.citation);
  }
});

test('MPF clamps to min and max', () => {
  assert.equal(computeMpf(100), 33.58);
  assert.equal(computeMpf(1_000_000), 651.5);
  assert.equal(computeMpf(50_000), 173.2);
});

test('discrepancies flag overpayment and underpayment, largest first', () => {
  const expected = expectedByAuthority([computeStack(line(), rules)]);
  const d = findDiscrepancies({ MFN: 100, S301: 250, IEEPA: 100, S232: 0 }, expected);
  assert.equal(d.length, 0);

  const d2 = findDiscrepancies({ MFN: 100, S301: 0, IEEPA: 150 }, expected);
  assert.deepEqual(d2.map((x) => [x.authority, x.delta]), [
    ['S301', -250],
    ['IEEPA', 50],
  ]);
});
