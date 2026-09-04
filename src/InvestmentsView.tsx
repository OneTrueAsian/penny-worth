import { FormEvent, useMemo, useState } from "react";
import type { Account, Holding } from "./types";
import { DonutChart, LineChart, fmtMoneyShort } from "./charts";
import { formatAmount, isValidDecimalString } from "./format";
import { projectGoal } from "./projections";
import { useAutoCancelDelete } from "./useAutoCancelDelete";

const CLASS_COLORS = ["#1E9E76", "#3E7CB8", "#C08A2E", "#8A5FB0", "#BD5B3C", "#4E8FC9"];

const PROJECTION_YEAR_OPTIONS = [5, 10, 15, 20, 25, 30, 40];

function GoalProjectionCalculator({ currentTotal }: { currentTotal: number }) {
  const [startingBalance, setStartingBalance] = useState(currentTotal.toFixed(2));
  const [monthlyContribution, setMonthlyContribution] = useState("0");
  const [annualReturnPct, setAnnualReturnPct] = useState("7");
  const [years, setYears] = useState(20);

  const parsedStart = parseFloat(startingBalance) || 0;
  const parsedContribution = parseFloat(monthlyContribution) || 0;
  const parsedReturn = parseFloat(annualReturnPct) || 0;
  const points = projectGoal(parsedStart, parsedContribution, parsedReturn, years);
  const finalBalance = points[points.length - 1].balance;
  const totalContributed = parsedStart + parsedContribution * 12 * years;
  const totalGrowth = finalBalance - totalContributed;

  return (
    <div className="card">
      <div className="card-head">
        <span className="reports-section-title">Goal projection</span>
      </div>
      <p className="modal-message-secondary">
        A simple what-if calculator — not tied to your actual holdings beyond the starting balance suggestion.
        Assumes a constant monthly contribution and a constant annual return, compounded monthly.
      </p>
      <form className="labeled-field-form" onSubmit={(e) => e.preventDefault()}>
        <label className="labeled-field">
          <span className="labeled-field-label">Starting balance</span>
          <input value={startingBalance} onChange={(e) => setStartingBalance(e.target.value)} placeholder="0.00" />
        </label>
        <label className="labeled-field">
          <span className="labeled-field-label">Monthly contribution</span>
          <input value={monthlyContribution} onChange={(e) => setMonthlyContribution(e.target.value)} placeholder="0.00" />
        </label>
        <label className="labeled-field">
          <span className="labeled-field-label">Assumed annual return %</span>
          <input value={annualReturnPct} onChange={(e) => setAnnualReturnPct(e.target.value)} placeholder="7" />
        </label>
        <label className="labeled-field">
          <span className="labeled-field-label">Time horizon</span>
          <select value={years} onChange={(e) => setYears(Number(e.target.value))}>
            {PROJECTION_YEAR_OPTIONS.map((y) => (
              <option key={y} value={y}>
                {y} years
              </option>
            ))}
          </select>
        </label>
      </form>

      <div className="stats">
        <div className="stat">
          <span className="stat-value">{formatAmount(finalBalance.toFixed(2))}</span>
          <span className="stat-label">Projected in {years} years</span>
        </div>
        <div className="stat">
          <span className="stat-value">{formatAmount(totalContributed.toFixed(2))}</span>
          <span className="stat-label">Total contributed</span>
        </div>
        <div className="stat">
          <span className="stat-value">{formatAmount(totalGrowth.toFixed(2))}</span>
          <span className="stat-label">Projected growth</span>
        </div>
      </div>

      <LineChart points={points.map((p) => ({ label: `Yr ${p.year}`, value: p.balance }))} height={180} />
    </div>
  );
}

function NewHoldingForm({
  accounts,
  onCreate,
  livePricesEnabled,
  onFetchQuote,
}: {
  accounts: Account[];
  onCreate: (
    accountId: number,
    symbol: string,
    name: string,
    shares: string,
    price: string,
    costBasis: string,
    assetClass: string | null,
  ) => void;
  livePricesEnabled: boolean;
  onFetchQuote: (symbol: string) => Promise<string | null>;
}) {
  const investmentAccounts = accounts.filter((a) => a.account_type === "investment");
  const [accountId, setAccountId] = useState<number | string>(investmentAccounts[0]?.id ?? "");
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [shares, setShares] = useState("");
  const [price, setPrice] = useState("");
  const [priceTouched, setPriceTouched] = useState(false);
  const [fetchingPrice, setFetchingPrice] = useState(false);
  const [costBasis, setCostBasis] = useState("");
  const [assetClass, setAssetClass] = useState("");
  const [open, setOpen] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const sharesTrimmed = shares.trim();
  const priceTrimmed = price.trim();
  const costBasisTrimmed = costBasis.trim();

  const sharesError =
    sharesTrimmed === ""
      ? "Enter a number of shares."
      : !isValidDecimalString(sharesTrimmed)
        ? "That doesn't look like a number."
        : parseFloat(sharesTrimmed) <= 0
          ? "Shares must be greater than zero."
          : null;
  const priceError =
    priceTrimmed === ""
      ? "Enter a price."
      : !isValidDecimalString(priceTrimmed)
        ? "That doesn't look like a number."
        : parseFloat(priceTrimmed) <= 0
          ? "Price must be greater than zero."
          : null;
  const costBasisError =
    costBasisTrimmed === ""
      ? "Enter a cost basis."
      : !isValidDecimalString(costBasisTrimmed)
        ? "That doesn't look like a number."
        : parseFloat(costBasisTrimmed) < 0
          ? "Cost basis can't be negative."
          : null;
  const valid = accountId !== "" && symbol.trim() !== "" && !sharesError && !priceError && !costBasisError;

  async function handleSymbolBlur() {
    const trimmed = symbol.trim();
    if (!livePricesEnabled || !trimmed || priceTouched) return;
    setFetchingPrice(true);
    try {
      const quote = await onFetchQuote(trimmed.toUpperCase());
      // The user may have started typing their own price while the lookup
      // was in flight — don't clobber it.
      if (quote && !priceTouched) setPrice(quote);
    } finally {
      setFetchingPrice(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitAttempted(true);
    if (!valid) return;
    onCreate(
      Number(accountId),
      symbol.trim().toUpperCase(),
      name.trim() || symbol.trim().toUpperCase(),
      sharesTrimmed,
      priceTrimmed,
      costBasisTrimmed,
      assetClass.trim() || null,
    );
    setSymbol("");
    setName("");
    setShares("");
    setPrice("");
    setPriceTouched(false);
    setCostBasis("");
    setAssetClass("");
    setSubmitAttempted(false);
    setOpen(false);
  }

  if (investmentAccounts.length === 0) {
    return (
      <p className="modal-message-secondary">
        Create an account with type "Investment" first (Reports tab) to add holdings.
      </p>
    );
  }

  if (!open) {
    return <button onClick={() => setOpen(true)}>Add holding…</button>;
  }

  return (
    <form className="labeled-field-form" onSubmit={handleSubmit}>
      <label className="labeled-field">
        <span className="labeled-field-label">Account</span>
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {investmentAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <label className="labeled-field">
        <span className="labeled-field-label">Symbol</span>
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          onBlur={handleSymbolBlur}
          placeholder="e.g. AAPL"
        />
      </label>
      <label className="labeled-field">
        <span className="labeled-field-label">Name (optional)</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Apple Inc." />
      </label>
      <label className="labeled-field">
        <span className="labeled-field-label">Shares</span>
        <input
          value={shares}
          onChange={(e) => setShares(e.target.value)}
          placeholder="0"
          aria-invalid={submitAttempted && sharesError !== null}
        />
        {submitAttempted && sharesError && <span className="field-error">{sharesError}</span>}
      </label>
      <label className="labeled-field">
        <span className="labeled-field-label">Price</span>
        <input
          value={price}
          onChange={(e) => {
            setPriceTouched(true);
            setPrice(e.target.value);
          }}
          placeholder={fetchingPrice ? "Fetching live price…" : "0.00"}
          aria-invalid={submitAttempted && priceError !== null}
        />
        {submitAttempted && priceError && <span className="field-error">{priceError}</span>}
      </label>
      <label className="labeled-field">
        <span className="labeled-field-label">Cost basis ($)</span>
        <input
          value={costBasis}
          onChange={(e) => setCostBasis(e.target.value)}
          placeholder="0.00"
          aria-invalid={submitAttempted && costBasisError !== null}
        />
        {submitAttempted && costBasisError && <span className="field-error">{costBasisError}</span>}
      </label>
      <label className="labeled-field">
        <span className="labeled-field-label">Asset class (optional)</span>
        <input
          value={assetClass}
          onChange={(e) => setAssetClass(e.target.value)}
          placeholder="e.g. US Stocks"
        />
      </label>
      <button type="submit" style={{ alignSelf: "flex-end" }} disabled={!accountId || !symbol.trim()}>
        Save
      </button>
      <button type="button" className="modal-secondary" style={{ alignSelf: "flex-end" }} onClick={() => setOpen(false)}>
        Cancel
      </button>
    </form>
  );
}

export function InvestmentsView({
  holdings,
  accounts,
  onCreate,
  onUpdatePrice,
  onDelete,
  livePricesEnabled,
  onFetchQuote,
}: {
  holdings: Holding[];
  accounts: Account[];
  onCreate: (
    accountId: number,
    symbol: string,
    name: string,
    shares: string,
    price: string,
    costBasis: string,
    assetClass: string | null,
  ) => void;
  onUpdatePrice: (id: number, price: string) => void;
  onDelete: (id: number) => void;
  livePricesEnabled: boolean;
  onFetchQuote: (symbol: string) => Promise<string | null>;
}) {
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null);
  useAutoCancelDelete(confirmingDeleteId, () => setConfirmingDeleteId(null));
  const [editingPrice, setEditingPrice] = useState<{ id: number; value: string } | null>(null);

  const { totalValue, totalCost, totalGain, holdingsWithDayCount, totalDayGain, totalDayGainPct } = useMemo(() => {
    const totalValue = holdings.reduce((s, h) => s + parseFloat(h.value), 0);
    const totalCost = holdings.reduce((s, h) => s + parseFloat(h.cost_basis), 0);
    const holdingsWithDayData = holdings.filter((h) => h.day_gain_loss !== null);
    const totalDayGain = holdingsWithDayData.reduce((s, h) => s + parseFloat(h.day_gain_loss as string), 0);
    const totalDayPrevValue = holdingsWithDayData.reduce(
      (s, h) => s + parseFloat(h.shares) * parseFloat(h.prev_close as string),
      0,
    );
    return {
      totalValue,
      totalCost,
      totalGain: totalValue - totalCost,
      holdingsWithDayCount: holdingsWithDayData.length,
      totalDayGain,
      totalDayGainPct: totalDayPrevValue !== 0 ? (totalDayGain / totalDayPrevValue) * 100 : null,
    };
  }, [holdings]);

  const byClass = new Map<string, number>();
  for (const h of holdings) {
    const key = h.asset_class ?? "Other";
    byClass.set(key, (byClass.get(key) ?? 0) + parseFloat(h.value));
  }
  const donutData = Array.from(byClass.entries()).map(([label, value], i) => ({
    label,
    value,
    color: CLASS_COLORS[i % CLASS_COLORS.length],
  }));

  function commitPriceEdit(id: number, value: string) {
    setEditingPrice(null);
    if (!value.trim()) return;
    onUpdatePrice(id, value.trim());
  }

  const byAccount = new Map<string, Holding[]>();
  for (const h of holdings) {
    const list = byAccount.get(h.account_name) ?? [];
    list.push(h);
    byAccount.set(h.account_name, list);
  }

  return (
    <div className="buckets-view">
      <div className="stats">
        <div className="stat">
          <span className="stat-value">{formatAmount(totalValue.toFixed(2))}</span>
          <span className="stat-label">Portfolio value</span>
        </div>
        <div className="stat">
          <span className="stat-value">{formatAmount(totalCost.toFixed(2))}</span>
          <span className="stat-label">Cost basis</span>
        </div>
        <div className="stat">
          <span className={totalGain < 0 ? "stat-value report-over-budget" : "stat-value"}>
            {formatAmount(totalGain.toFixed(2))}
          </span>
          <span className="stat-label">Total gain/loss</span>
        </div>
        <div className="stat">
          {holdingsWithDayCount > 0 ? (
            <span className={totalDayGain < 0 ? "stat-value report-over-budget" : "stat-value"}>
              {totalDayGain > 0 ? "+" : ""}
              {formatAmount(totalDayGain.toFixed(2))}
            </span>
          ) : (
            <span className="stat-value stat-value-muted">—</span>
          )}
          <span className="stat-label">Today's gain/loss</span>
          {holdingsWithDayCount > 0 && totalDayGainPct !== null && (
            <span className={totalDayGainPct >= 0 ? "stat-delta up" : "stat-delta down"}>
              {totalDayGainPct >= 0 ? "▲" : "▼"} {Math.abs(totalDayGainPct).toFixed(2)}%
            </span>
          )}
          {holdingsWithDayCount > 0 && holdingsWithDayCount < holdings.length && (
            <span className="stat-delta">
              {holdingsWithDayCount} of {holdings.length} priced today
            </span>
          )}
        </div>
      </div>

      {donutData.length > 0 && (
        <div className="card">
          <div className="card-head">
            <span className="reports-section-title">Allocation</span>
          </div>
          <div className="donut-with-legend">
            <DonutChart data={donutData} size={132} />
            <div>
              {donutData.map((d) => (
                <div className="chart-legend-item" key={d.label} style={{ marginBottom: 8 }}>
                  <span className="chart-legend-swatch" style={{ background: d.color }}></span>
                  {d.label}
                  <span className="account-col" style={{ marginLeft: "auto" }}>
                    {fmtMoneyShort(d.value)} ({totalValue ? ((d.value / totalValue) * 100).toFixed(0) : 0}%)
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <GoalProjectionCalculator currentTotal={totalValue} />

      {Array.from(byAccount.entries()).map(([accountName, accountHoldings]) => (
        <div key={accountName}>
          <h2 className="reports-section-title">{accountName}</h2>
          <table className="ledger">
            <thead>
              <tr>
                <th>Holding</th>
                <th className="amount-col">Shares</th>
                <th className="amount-col">Price</th>
                <th className="amount-col">Today</th>
                <th className="amount-col">Value</th>
                <th className="amount-col">Gain/Loss</th>
                <th className="actions-col"></th>
              </tr>
            </thead>
            <tbody>
              {accountHoldings.map((h) => {
                const gain = parseFloat(h.gain_loss);
                const dayGain = h.day_gain_loss !== null ? parseFloat(h.day_gain_loss) : null;
                const dayPrevValue = h.prev_close !== null ? parseFloat(h.shares) * parseFloat(h.prev_close) : 0;
                const dayGainPct = dayGain !== null && dayPrevValue !== 0 ? (dayGain / dayPrevValue) * 100 : null;
                return (
                  <tr key={h.id}>
                    <td>
                      <div className="account-name-cell">{h.symbol}</div>
                      <span className="account-col">{h.name}</span>
                    </td>
                    <td className="amount-col">{h.shares}</td>
                    <td className="amount-col">
                      {editingPrice?.id === h.id ? (
                        <input
                          autoFocus
                          className="amount-edit-input"
                          value={editingPrice.value}
                          onChange={(e) => setEditingPrice({ id: h.id, value: e.target.value })}
                          onBlur={() => commitPriceEdit(h.id, editingPrice.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitPriceEdit(h.id, editingPrice.value);
                            if (e.key === "Escape") setEditingPrice(null);
                          }}
                        />
                      ) : (
                        <span
                          className="amount-editable"
                          title="Click to update the price"
                          onClick={() => setEditingPrice({ id: h.id, value: h.price })}
                        >
                          {formatAmount(h.price)}
                        </span>
                      )}
                    </td>
                    <td className={dayGain !== null && dayGain < 0 ? "amount-col report-over-budget" : "amount-col"}>
                      {dayGain !== null ? (
                        <>
                          {dayGain > 0 ? "+" : ""}
                          {formatAmount(h.day_gain_loss as string)}
                          {dayGainPct !== null && (
                            <>
                              <br />
                              <span className={dayGainPct >= 0 ? "stat-delta up" : "stat-delta down"}>
                                {dayGainPct >= 0 ? "▲" : "▼"} {Math.abs(dayGainPct).toFixed(2)}%
                              </span>
                            </>
                          )}
                        </>
                      ) : (
                        <span className="account-col">—</span>
                      )}
                    </td>
                    <td className="amount-col">{formatAmount(h.value)}</td>
                    <td className={gain < 0 ? "amount-col report-over-budget" : "amount-col"}>
                      {formatAmount(h.gain_loss)}
                    </td>
                    <td className="actions-col">
                      {confirmingDeleteId === h.id ? (
                        <span className="row-delete-confirm">
                          <button type="button" className="modal-secondary" onClick={() => setConfirmingDeleteId(null)}>
                            Cancel
                          </button>
                          <button type="button" className="btn-danger" onClick={() => onDelete(h.id)}>
                            Delete
                          </button>
                        </span>
                      ) : (
                        <button type="button" className="modal-secondary" onClick={() => setConfirmingDeleteId(h.id)}>
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
      {holdings.length === 0 && <p className="empty-state">No holdings yet.</p>}

      <NewHoldingForm
        accounts={accounts}
        onCreate={onCreate}
        livePricesEnabled={livePricesEnabled}
        onFetchQuote={onFetchQuote}
      />
    </div>
  );
}
