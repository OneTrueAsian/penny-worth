import { describe, expect, it } from "vitest";
import { incomeByMember, spendingByMember } from "./memberBreakdowns";
import type { Transaction } from "./types";

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: Math.floor(Math.random() * 1e9),
    date: "2026-09-05",
    description: "Test transaction",
    amount: "-60.00",
    category: "Dining Out",
    category_source: "user",
    confidence: null,
    account_id: 1,
    account_name: "Everyday Checking",
    applied_to_debt: null,
    split_count: 0,
    tags: [],
    member_id: 3,
    member_name: "Joint",
    ...overrides,
  };
}

// Regression coverage for a real production case: a family member's
// September income included a $6,000 internal transfer (checking -> HYSA)
// and the deposit side of a credit-card payment, both attributed to
// "Joint" — neither is actually income. Transfer-categorized transactions
// must be excluded from both breakdowns, matching the same exclusion
// Store::monthly_totals applies on the backend (core/src/store.rs).

describe("incomeByMember", () => {
  it("excludes a Transfer-categorized deposit from a member's income total", () => {
    const result = incomeByMember([
      tx({ amount: "147.70", category: "Income", description: "Interest Payment" }),
      tx({ amount: "6000.00", category: "Transfer", description: "Internet transfer from checking" }),
    ]);
    expect(result).toEqual([{ name: "Joint", amount: 147.7 }]);
  });

  it("still drops unattributed transactions and negative amounts as before", () => {
    const result = incomeByMember([
      tx({ amount: "500.00", member_name: null }),
      tx({ amount: "-40.00" }),
    ]);
    expect(result).toEqual([]);
  });
});

describe("spendingByMember", () => {
  it("excludes a Transfer-categorized withdrawal from a member's spending total", () => {
    const result = spendingByMember([
      tx({ amount: "-33.09", category: "Dining Out" }),
      tx({ amount: "-6000.00", category: "Transfer", description: "Internet transfer to savings" }),
    ]);
    expect(result).toEqual([{ name: "Joint", amount: 33.09 }]);
  });
});
