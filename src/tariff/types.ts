export type Authority = 'MFN' | 'S301' | 'S232' | 'IEEPA' | 'S122' | 'MPF';

/** A versioned, cited tariff rule. Rules are data, not code. */
export interface TariffRule {
  id: string;
  authority: Authority;
  /** Ad valorem rate as a fraction, e.g. 0.25 for 25%. */
  rate: number;
  /** Inclusive ISO dates (YYYY-MM-DD). effectiveTo null = open ended. */
  effectiveFrom: string;
  effectiveTo: string | null;
  /** HTS prefixes the rule applies to. Empty = all goods. */
  htsPrefixes: string[];
  /** ISO country codes the rule applies to. Empty = all origins. */
  origins: string[];
  citation: string;
  ruleVersion: string;
}

export interface EntryLine {
  entryNumber: string;
  lineNumber: number;
  hts: string;
  origin: string;
  /** ISO date of entry. */
  entryDate: string;
  /** Entered value in USD. */
  value: number;
}

export interface DutyComponent {
  authority: Authority;
  amount: number;
  rate: number;
  ruleId: string;
  citation: string;
  ruleVersion: string;
}

export interface StackResult {
  line: EntryLine;
  components: DutyComponent[];
  total: number;
}

export type PaidByAuthority = Partial<Record<Authority, number>>;

export interface Discrepancy {
  authority: Authority;
  paid: number;
  expected: number;
  /** paid - expected. Positive = possible overpayment, negative = possible underpayment. */
  delta: number;
}
