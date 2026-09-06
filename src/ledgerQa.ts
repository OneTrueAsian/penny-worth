import * as chrono from "chrono-node";
import Fuse from "fuse.js";
import type { Account, Bucket, Recurring, Transaction } from "./types";
import { groupOf, netWorthContribution, owedAmount } from "./accountGroups";
import { formatAmount, toLocalIsoDate } from "./format";

/** Everything a question might need — all of it already sitting in App.tsx
 * state, so answering a question is a pure client-side computation, never
 * a network or even a fresh Tauri call. Answers are only ever as current
 * as this data already is (whatever the Dashboard last fetched). */
export type QaContext = {
  transactions: Transaction[];
  categories: string[];
  accounts: Account[];
  buckets: Bucket[];
  recurring: Recurring[];
  avgMonthlySpend: string;
  today: Date;
};

export type QaResult = {
  answer: string;
  /** false means no template matched at all — `answer` is then the
   * fallback "try asking it like this" message. A question whose *shape*
   * was recognized but whose subject (category/account/bucket/period)
   * couldn't be resolved still counts as matched — a specific "I couldn't
   * find X" is more useful than the generic fallback, since the question
   * itself was understood. */
  matched: boolean;
};

export const LEDGER_QA_EXAMPLES = [
  "how much did I spend on dining out in July",
  "how much did I spend at Whole Foods",
  "what's my runway if rent goes up by $200",
  "how much do I have in checking",
  "what's my net worth",
  "what's my total debt",
  "how much do I owe on car loan",
  "how much are my subscriptions",
  "when is my next bill due",
  "how much have I saved toward vacation",
  "what's my savings rate this month",
  "compare this month to last month",
];

function match(result: RegExpMatchArray | null): RegExpMatchArray | null {
  return result;
}

// ---------------------------------------------------------------------------
// Fuzzy matching — typo-tolerant lookups against the app's own real,
// user-curated names (categories, accounts, bucket names, merchants),
// replacing a hand-rolled exact-then-substring check. Fuse does lexical
// fuzzy matching (edit-distance-ish), not synonyms — "dinning" finds
// "Dining Out", but "restaurant" won't, since that's a meaning match, not
// a typo. A single shared low threshold keeps every lookup's tolerance
// consistent.
const FUSE_OPTIONS = { includeScore: true, threshold: 0.4 };

function fuzzyFind<T>(phrase: string, items: T[], key: (item: T) => string): T | null {
  const trimmed = phrase.trim();
  if (!trimmed || items.length === 0) return null;
  const exact = items.find((item) => key(item).toLowerCase() === trimmed.toLowerCase());
  if (exact) return exact;
  const fuse = new Fuse(items.map(key), FUSE_OPTIONS);
  const hit = fuse.search(trimmed)[0];
  return hit ? items[hit.refIndex] : null;
}

function findCategory(phrase: string, categories: string[]): string | null {
  return fuzzyFind(phrase, categories, (c) => c);
}

function findAccount(phrase: string, accounts: Account[]): Account | null {
  return fuzzyFind(phrase, accounts, (a) => a.name);
}

function findBucket(phrase: string, buckets: Bucket[]): Bucket | null {
  return fuzzyFind(phrase, buckets, (b) => b.name);
}

function findMerchant(phrase: string, transactions: Transaction[]): string | null {
  const descriptions = Array.from(new Set(transactions.map((t) => t.description)));
  return fuzzyFind(phrase, descriptions, (d) => d);
}

const ACCOUNT_GROUP_WORDS: Record<string, string> = {
  cash: "cash",
  checking: "cash",
  savings: "cash",
  investments: "investment",
  investment: "investment",
};

// ---------------------------------------------------------------------------
// Period parsing — chrono-node handles the actual date-language understanding
// (specific dates, month names, "this/last month", relative days), but three
// common phrasings need help chrono doesn't give out of the box (verified
// empirically, not assumed): a bare 4-digit year isn't parsed as a date at
// all; "last week" resolves to a single day (same weekday, one week back)
// rather than the 7-day week; and "the past N months"/"since X" resolve to
// a single reference point rather than a range running through today.
export type DateRange = { from: Date; to: Date };

function monthRange(year: number, month1to12: number): DateRange {
  return { from: new Date(year, month1to12 - 1, 1), to: new Date(year, month1to12, 0) };
}

function yearRange(year: number): DateRange {
  return { from: new Date(year, 0, 1), to: new Date(year, 11, 31) };
}

/** Builds a range from one chrono `start` component, at whatever
 * granularity it actually specified (day beats month beats year) — a bare
 * "July" only pins down month+year, so it becomes the whole month; "August
 * 5th" pins down a day, so it becomes that single day. */
function rangeFromComponent(component: chrono.ParsedComponents): DateRange {
  const year = component.get("year")!;
  if (component.isCertain("day")) {
    const d = component.date();
    return { from: d, to: d };
  }
  if (component.isCertain("month")) {
    return monthRange(year, component.get("month")!);
  }
  return yearRange(year);
}

export function parsePeriod(phrase: string, today: Date): DateRange | null {
  const lower = phrase.trim().toLowerCase();
  if (!lower) return null;

  const bareYear = lower.match(/^(\d{4})$/);
  if (bareYear) return yearRange(Number(bareYear[1]));

  if (lower === "this year") return yearRange(today.getFullYear());
  if (lower === "last year") return yearRange(today.getFullYear() - 1);

  if (lower === "this week" || lower === "last week") {
    const weeksBack = lower === "last week" ? 1 : 0;
    const start = new Date(today);
    start.setDate(today.getDate() - today.getDay() - weeksBack * 7);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { from: start, to: end };
  }

  const rolling = lower.match(/^(?:the )?(?:past|last) (\d+) (day|week|month|year)s?$/);
  if (rolling) {
    const n = Number(rolling[1]);
    const unit = rolling[2];
    const from = new Date(today);
    if (unit === "day") from.setDate(from.getDate() - n);
    else if (unit === "week") from.setDate(from.getDate() - n * 7);
    else if (unit === "month") from.setMonth(from.getMonth() - n);
    else from.setFullYear(from.getFullYear() - n);
    return { from, to: today };
  }

  const since = lower.match(/^since (.+)$/);
  if (since) {
    const parsed = chrono.parse(since[1], today, { forwardDate: false });
    if (parsed.length === 0) return null;
    return { from: rangeFromComponent(parsed[0].start).from, to: today };
  }

  const parsed = chrono.parse(phrase, today, { forwardDate: false });
  if (parsed.length === 0) return null;
  const r = parsed[0];
  if (r.end) return { from: r.start.date(), to: r.end.date() };
  return rangeFromComponent(r.start);
}

function inRange(dateStr: string, range: DateRange): boolean {
  return dateStr >= toLocalIsoDate(range.from) && dateStr <= toLocalIsoDate(range.to);
}

function periodLabel(phrase: string): string {
  return phrase.trim();
}

// ---------------------------------------------------------------------------
// Recurring/subscription helpers — same monthly-equivalent convention as
// the backend's own `recurring_totals` (see core/src/store.rs): a small
// mirrored multiplier table, duplicated client-side deliberately (same
// precedent as `next_occurrence`/`stepDate` elsewhere in this app) since
// this is a display-only estimate, not the source of truth.
const CADENCE_MONTHLY_MULTIPLIER: Record<string, number> = {
  weekly: 52 / 12,
  biweekly: 26 / 12,
  monthly: 1,
  annual: 1 / 12,
};

function monthlyEquivalent(r: Recurring): number {
  return Math.abs(parseFloat(r.amount)) * (CADENCE_MONTHLY_MULTIPLIER[r.cadence] ?? 1);
}

// ---------------------------------------------------------------------------
// Intents — tried in order; the first pattern to match commits to that
// intent (see QaResult.matched above for why a resolution failure still
// returns a specific message rather than falling through to the next one).

type Intent = {
  pattern: RegExp;
  handle: (m: RegExpMatchArray, ctx: QaContext) => string;
};

const INTENTS: Intent[] = [
  {
    // "how much did I spend on/at <subject> [in/during/since <period>]",
    // plus a handful of relative periods ("last week", "the past 3
    // months") that read naturally with no connector word at all.
    pattern:
      /how much (?:did i|have i) spen[dt] (?:on|at) (.+?)(?: (in|during|since) (.+)|(this week|last week|this month|last month|this year|last year|the past \d+ (?:day|week|month|year)s?|\d{4}))?$/,
    handle: (m, ctx) => {
      const subjectPhrase = m[1].trim();
      const periodPhrase = m[4] ?? (m[3] ? (m[2] === "since" ? `since ${m[3]}` : m[3]) : undefined);

      let range: DateRange | null = null;
      if (periodPhrase) {
        range = parsePeriod(periodPhrase, ctx.today);
        if (!range) return `I couldn't figure out what time period "${periodPhrase}" means.`;
      }

      const category = findCategory(subjectPhrase, ctx.categories);
      const merchant = category ? null : findMerchant(subjectPhrase, ctx.transactions);
      if (!category && !merchant) {
        return `I couldn't find a category or merchant matching "${subjectPhrase}".`;
      }

      const matches = ctx.transactions.filter((t) => {
        if (parseFloat(t.amount) >= 0) return false;
        if (category && t.category !== category) return false;
        if (merchant && t.description !== merchant) return false;
        if (range && !inRange(t.date, range)) return false;
        return true;
      });
      const total = matches.reduce((s, t) => s + Math.abs(parseFloat(t.amount)), 0);
      const subject = category ?? merchant!;
      const when = periodPhrase ? periodLabel(periodPhrase) : "all time";
      return matches.length > 0
        ? `You spent ${formatAmount(-total)} on ${subject} (${when}), across ${matches.length} transaction${matches.length === 1 ? "" : "s"}.`
        : `No ${subject} spending found (${when}).`;
    },
  },
  {
    pattern: /runway if .+? (?:goes up|increases|were to go up|rises)(?: by)? \$?([\d,]+(?:\.\d+)?)/,
    handle: (m, ctx) => {
      const delta = parseFloat(m[1].replace(/,/g, ""));
      const avgSpend = parseFloat(ctx.avgMonthlySpend);
      const cash = ctx.accounts
        .filter((a) => groupOf(a.account_type) === "cash")
        .reduce((s, a) => s + netWorthContribution(a), 0);
      const currentRunway = avgSpend > 0 ? cash / avgSpend : null;
      const newRunway = avgSpend + delta > 0 ? cash / (avgSpend + delta) : null;
      if (currentRunway === null || newRunway === null) {
        return "I don't have enough spending history yet to estimate a runway.";
      }
      return `Right now your runway is ${currentRunway.toFixed(1)} months. If spending goes up by ${formatAmount(delta)}/mo, it'd drop to ${newRunway.toFixed(1)} months.`;
    },
  },
  {
    pattern: /how much (?:do i have|is there|is) in (.+?)$/,
    handle: (m, ctx) => {
      const phrase = m[1].trim();
      const group = ACCOUNT_GROUP_WORDS[phrase.toLowerCase()];
      if (group) {
        const total = ctx.accounts
          .filter((a) => groupOf(a.account_type) === group)
          .reduce((s, a) => s + netWorthContribution(a), 0);
        return `You have ${formatAmount(total)} in ${phrase}.`;
      }
      const account = findAccount(phrase, ctx.accounts);
      if (!account) return `I couldn't find an account matching "${phrase}".`;
      return `${account.name} has a balance of ${formatAmount(netWorthContribution(account))}.`;
    },
  },
  {
    pattern: /(?:what'?s|what is) my net worth/,
    handle: (_m, ctx) => {
      const total = ctx.accounts.reduce((s, a) => s + netWorthContribution(a), 0);
      return `Your net worth is ${formatAmount(total)}.`;
    },
  },
  {
    pattern: /(?:what'?s|what is) my (?:total )?debt|how much debt do i have/,
    handle: (_m, ctx) => {
      const total = ctx.accounts
        .filter((a) => groupOf(a.account_type) === "credit" || groupOf(a.account_type) === "loan")
        .reduce((s, a) => s + owedAmount(a), 0);
      return total > 0 ? `You owe ${formatAmount(total)} in total.` : "You have no debt tracked — nice.";
    },
  },
  {
    pattern: /how much do i owe on (.+?)$/,
    handle: (m, ctx) => {
      const account = findAccount(m[1], ctx.accounts);
      if (!account || !(groupOf(account.account_type) === "credit" || groupOf(account.account_type) === "loan")) {
        return `I couldn't find a debt account matching "${m[1].trim()}".`;
      }
      return `You owe ${formatAmount(owedAmount(account))} on ${account.name}.`;
    },
  },
  {
    pattern: /(?:how much (?:are|is)|what (?:are|is)) my (?:subscriptions|recurring bills|recurring)|how much do i spend on (?:subscriptions|recurring bills)/,
    handle: (_m, ctx) => {
      const bills = ctx.recurring.filter((r) => parseFloat(r.amount) < 0);
      if (bills.length === 0) return "No recurring bills tracked yet.";
      const total = bills.reduce((s, r) => s + monthlyEquivalent(r), 0);
      return `Your recurring bills add up to about ${formatAmount(total)}/mo, across ${bills.length} recurring bill${bills.length === 1 ? "" : "s"}.`;
    },
  },
  {
    pattern: /when is my next bill due|what'?s due soon|when'?s my next bill/,
    handle: (_m, ctx) => {
      const bills = ctx.recurring.filter((r) => parseFloat(r.amount) < 0).sort((a, b) => (a.next_date < b.next_date ? -1 : 1));
      if (bills.length === 0) return "No recurring bills tracked yet.";
      const next = bills[0];
      return `Your next bill is ${next.merchant} for ${formatAmount(next.amount)} on ${next.next_date}.`;
    },
  },
  {
    pattern: /how much (?:have i saved|do i have saved) (?:for|toward|towards) (.+?)$/,
    handle: (m, ctx) => bucketProgressAnswer(m[1], ctx),
  },
  {
    pattern: /how close am i to (?:my )?(.+?)$/,
    handle: (m, ctx) => bucketProgressAnswer(m[1], ctx),
  },
  {
    pattern: /(?:what'?s|what is) my savings rate(?: (?:in|during|for) (.+))?$/,
    handle: (m, ctx) => {
      const periodPhrase = m[1]?.trim();
      const range = periodPhrase ? parsePeriod(periodPhrase, ctx.today) : monthRange(ctx.today.getFullYear(), ctx.today.getMonth() + 1);
      if (!range) return `I couldn't figure out what time period "${periodPhrase}" means.`;
      const { income, expense } = incomeAndExpense(ctx.transactions, range);
      if (income <= 0) return `No income found for ${periodPhrase ? periodLabel(periodPhrase) : "this month"}, so a savings rate isn't meaningful yet.`;
      const rate = ((income - expense) / income) * 100;
      return `Your savings rate for ${periodPhrase ? periodLabel(periodPhrase) : "this month"} is ${rate.toFixed(0)}% (${formatAmount(income)} income, ${formatAmount(expense)} spent).`;
    },
  },
  {
    pattern: /how does (.+?) compare (?:to|with) (.+?)$/,
    handle: (m, ctx) => compareSpendAnswer(m[1], m[2], ctx),
  },
  {
    pattern: /compare (.+?) (?:to|with|and) (.+?)$/,
    handle: (m, ctx) => compareSpendAnswer(m[1], m[2], ctx),
  },
];

function bucketProgressAnswer(phrase: string, ctx: QaContext): string {
  const b = findBucket(phrase, ctx.buckets);
  if (!b) return `I couldn't find a bucket matching "${phrase.trim()}".`;
  if (!b.target_amount) return `${b.name} has ${formatAmount(b.saved_amount)} saved (no target set).`;
  const pct = Math.min(100, Math.max(0, (parseFloat(b.saved_amount) / parseFloat(b.target_amount)) * 100));
  return `${b.name} has ${formatAmount(b.saved_amount)} saved of its ${formatAmount(b.target_amount)} target (${pct.toFixed(0)}%).`;
}

function totalSpend(transactions: Transaction[], range: DateRange): number {
  return transactions
    .filter((t) => parseFloat(t.amount) < 0 && inRange(t.date, range))
    .reduce((s, t) => s + Math.abs(parseFloat(t.amount)), 0);
}

function incomeAndExpense(transactions: Transaction[], range: DateRange): { income: number; expense: number } {
  let income = 0;
  let expense = 0;
  for (const t of transactions) {
    if (!inRange(t.date, range)) continue;
    const amount = parseFloat(t.amount);
    if (t.category === "Income") income += amount;
    else if (amount < 0) expense += Math.abs(amount);
  }
  return { income, expense };
}

function compareSpendAnswer(phraseA: string, phraseB: string, ctx: QaContext): string {
  const rangeA = parsePeriod(phraseA, ctx.today);
  const rangeB = parsePeriod(phraseB, ctx.today);
  if (!rangeA) return `I couldn't figure out what time period "${phraseA.trim()}" means.`;
  if (!rangeB) return `I couldn't figure out what time period "${phraseB.trim()}" means.`;
  const spendA = totalSpend(ctx.transactions, rangeA);
  const spendB = totalSpend(ctx.transactions, rangeB);
  const diff = spendA - spendB;
  const direction = diff > 0 ? "more" : diff < 0 ? "less" : "the same amount";
  return (
    `You spent ${formatAmount(spendA)} during ${periodLabel(phraseA)} and ${formatAmount(spendB)} during ${periodLabel(phraseB)}` +
    (diff === 0 ? " — " : ` — that's ${formatAmount(Math.abs(diff))} ${direction} `) +
    `during ${periodLabel(phraseA)}.`
  );
}

/** Template-matches `question` against the shapes in `INTENTS` above, each
 * answered from data the app already has on hand — no hosted LLM call, no
 * new backend query, no network at all. An unmatched question gets a
 * fallback pointing at an example, rather than a bare "I don't understand." */
export function answerLedgerQuestion(question: string, ctx: QaContext): QaResult {
  const q = question.trim().toLowerCase().replace(/[?.!]+$/, "");

  for (const intent of INTENTS) {
    const m = match(q.match(intent.pattern));
    if (m) return { matched: true, answer: intent.handle(m, ctx) };
  }

  const example = LEDGER_QA_EXAMPLES[Math.floor(Math.random() * LEDGER_QA_EXAMPLES.length)];
  return {
    matched: false,
    answer: `I couldn't match that to a question I understand yet. Try something like: "${example}"`,
  };
}
