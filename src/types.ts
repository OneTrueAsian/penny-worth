export type AppliedDebtPayment = {
  debt_account_id: number;
  debt_account_name: string;
  amount: string;
};

export type Transaction = {
  id: number;
  date: string;
  description: string;
  amount: string;
  category: string | null;
  category_source: "rule" | "user" | "classifier" | null;
  confidence: number | null;
  account_id: number;
  account_name: string;
  applied_to_debt: AppliedDebtPayment | null;
  split_count: number;
  tags: string[];
};

export type TransactionSplit = {
  id: number;
  category: string | null;
  amount: string;
  note: string | null;
};

export type Account = {
  id: number;
  name: string;
  account_type: string;
  starting_balance: string;
  current_balance: string;
  institution: string | null;
  mask: string | null;
};

export type Bucket = {
  id: number;
  name: string;
  target_amount: string | null;
  saved_amount: string;
  target_date: string | null;
  account_id: number | null;
  account_name: string | null;
};

export type BudgetGroup = "income" | "fixed" | "flexible" | "nonmonthly";

export type ReportBudgetLine = {
  category: string;
  budget_group: string;
  budgeted: string;
  actual: string;
};

export type Recurring = {
  id: number;
  merchant: string;
  category: string | null;
  amount: string;
  cadence: string;
  anchor_date: string;
  next_date: string;
  account_id: number | null;
  account_name: string | null;
};

export type Holding = {
  id: number;
  account_id: number;
  account_name: string;
  symbol: string;
  name: string;
  shares: string;
  price: string;
  cost_basis: string;
  asset_class: string | null;
  value: string;
  gain_loss: string;
};

export type MonthTotal = {
  month_label: string;
  year: number;
  month: number;
  income: string;
  expense: string;
};

export type CategoryAmount = {
  category: string;
  amount: string;
};

export type MerchantAmount = {
  description: string;
  amount: string;
};

export type YoyCashFlow = {
  current: MonthTotal[];
  prior_year: MonthTotal[];
};

export type CashFlow = {
  months: MonthTotal[];
  top_categories: CategoryAmount[];
  top_merchants: MerchantAmount[];
  total_income: string;
  total_expense: string;
};

export type LargeExpense = {
  transaction_id: number;
  date: string;
  description: string;
  amount: string;
  category: string | null;
  detail: string;
};

export type MonthExpenseDetail = {
  month_label: string;
  categories: CategoryAmount[];
  large_expenses: LargeExpense[];
};

export type CategoryTransaction = {
  transaction_id: number;
  date: string;
  description: string;
  amount: string;
  account_name: string;
  is_split: boolean;
  split_note: string | null;
};

export type NetWorthPoint = {
  month_label: string;
  value: string;
};

export type Report = {
  total_saved: string;
  income_total: string;
  month_label: string;
  budget_actuals: ReportBudgetLine[];
};

export type RolledAccount = {
  account_id: number;
  account_name: string;
  new_balance: string;
};

export type BudgetAlert = {
  category: string;
  budget_group: string;
  budgeted: string;
  actual: string;
  pct: string;
  level: "warning" | "over";
};

export type AnomalyFlag = {
  transaction_id: number;
  kind: "large" | "duplicate";
  detail: string;
};

export type SetupAccountRow = {
  index: number;
  name: string;
  account_type: string;
  starting_balance: string | null;
  institution: string | null;
  mask: string | null;
  already_exists: boolean;
};

export type SetupCategoryRow = {
  index: number;
  name: string;
  already_exists: boolean;
};

export type SetupBudgetRow = {
  index: number;
  category: string;
  budget_group: string;
  monthly_amount: string;
  period: string | null;
  will_update: boolean;
};

export type SetupBucketRow = {
  index: number;
  name: string;
  target_amount: string | null;
  target_date: string | null;
  linked_account_name: string | null;
  already_exists: boolean;
};

export type SetupImportPreview = {
  accounts: SetupAccountRow[];
  categories: SetupCategoryRow[];
  budgets: SetupBudgetRow[];
  buckets: SetupBucketRow[];
  row_errors: number;
};

export type SetupImportSummary = {
  accounts_created: number;
  categories_created: number;
  budgets_set: number;
  buckets_created: number;
  skipped: string[];
  row_errors: number;
};
