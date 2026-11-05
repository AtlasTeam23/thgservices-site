// Shapes of the checker Worker's replies. The page treats every reply as
// untrusted data: text is only ever rendered through React text nodes or the
// sanitizer in sanitize.tsx.

export type Profile = 'trade' | 'professional' | 'health' | 'retail' | 'software' | 'general';

export type Letter = 'A' | 'B' | 'C' | 'D' | 'F';

export type Grade = { score: number; grade: Letter };

export type CategorySummary = {
  id: string;
  section: string;
  label: string;
  to_fix: number;
  to_improve: number;
  passing: number;
};

export type ScanOk = {
  ok: true;
  scan_id: string;
  host: string;
  final_url: string;
  cached: boolean;
  checked_at: string;
  read_limited: boolean;
  bot_view: boolean;
  overall: Grade | null;
  seo: Grade;
  conversion: Grade | null;
  summary: {
    to_fix: number;
    to_improve: number;
    passing: number;
    categories: CategorySummary[];
  };
  gated: boolean;
};

export type FailReason =
  | 'blocked'
  | 'no_response'
  | 'not_found'
  | 'site_error'
  | 'timeout'
  | 'not_html'
  | 'too_large'
  | 'invalid_url'
  | 'recheck_too_soon';

export type CheckStatus = 'pass' | 'warn' | 'fail';

export type ReportCheck = {
  id: string;
  title: string;
  status: CheckStatus;
  points?: number;
  max_points?: number;
  finding: string;
  fix: string;
};

export type ReportCategory = { id: string; label: string; checks: ReportCheck[] };

export type ReportSection = {
  id: string;
  title: string;
  subtitle?: string;
  categories: ReportCategory[];
};

export type TopFix = { check_id: string; title: string; fix: string };

export type ReportCompetitor = {
  host: string;
  final_url?: string;
  overall: Grade | null;
  seo: Grade | null;
  conversion: Grade | null;
  checks: { id: string; status: CheckStatus }[];
};

export type ActionPlan = {
  summary: string;
  items: { check_id: string; text: string }[];
};

export type Report = {
  host: string;
  final_url: string;
  checked_at: string;
  read_limited: boolean;
  bot_view: boolean;
  overall: Grade | null;
  seo: Grade;
  conversion: Grade | null;
  top_fixes: TopFix[];
  sections: ReportSection[];
  competitors?: ReportCompetitor[];
  plan?: ActionPlan | null;
};

export type UnlockFields = { name?: unknown; email?: unknown; phone?: unknown };
