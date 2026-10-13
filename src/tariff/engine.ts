import type {
  Authority,
  Discrepancy,
  DutyComponent,
  EntryLine,
  PaidByAuthority,
  StackResult,
  TariffRule,
} from './types.ts';

/** FY2026 MPF parameters per the diligence report. Verify before relying on them. */
export const MPF = { rate: 0.003464, min: 33.58, max: 651.5 } as const;

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

function ruleApplies(rule: TariffRule, line: EntryLine): boolean {
  if (line.entryDate < rule.effectiveFrom) return false;
  if (rule.effectiveTo !== null && line.entryDate > rule.effectiveTo) return false;
  if (rule.origins.length > 0 && !rule.origins.includes(line.origin)) return false;
  if (rule.htsPrefixes.length > 0) {
    const hts = line.hts.replace(/\./g, '');
    const hit = rule.htsPrefixes.some((p) => hts.startsWith(p.replace(/\./g, '')));
    if (!hit) return false;
  }
  return true;
}

/** Compute the full duty stack for one entry line. Pure and deterministic. */
export function computeStack(line: EntryLine, rules: TariffRule[]): StackResult {
  const components: DutyComponent[] = [];
  for (const rule of rules) {
    if (rule.authority === 'MPF' || !ruleApplies(rule, line)) continue;
    components.push({
      authority: rule.authority,
      amount: round2(line.value * rule.rate),
      rate: rule.rate,
      ruleId: rule.id,
      citation: rule.citation,
      ruleVersion: rule.ruleVersion,
    });
  }
  const total = round2(components.reduce((s, c) => s + c.amount, 0));
  return { line, components, total };
}

/**
 * MPF is assessed per entry, not per line: 0.3464% of entered value,
 * clamped to the annual min and max.
 */
export function computeMpf(entryValue: number): number {
  const raw = entryValue * MPF.rate;
  return round2(Math.min(MPF.max, Math.max(MPF.min, raw)));
}

/** Sum expected duty by authority across the lines of one entry. */
export function expectedByAuthority(results: StackResult[]): PaidByAuthority {
  const out: PaidByAuthority = {};
  for (const r of results) {
    for (const c of r.components) {
      out[c.authority] = round2((out[c.authority] ?? 0) + c.amount);
    }
  }
  return out;
}

/** Compare duty actually paid against the expected stack, per authority. */
export function findDiscrepancies(
  paid: PaidByAuthority,
  expected: PaidByAuthority,
  tolerance = 0.01,
): Discrepancy[] {
  const authorities = new Set<Authority>([
    ...(Object.keys(paid) as Authority[]),
    ...(Object.keys(expected) as Authority[]),
  ]);
  const out: Discrepancy[] = [];
  for (const authority of authorities) {
    const p = paid[authority] ?? 0;
    const e = expected[authority] ?? 0;
    const delta = round2(p - e);
    if (Math.abs(delta) > tolerance) out.push({ authority, paid: p, expected: e, delta });
  }
  return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}
