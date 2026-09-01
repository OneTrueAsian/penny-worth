import { FormEvent, useState } from "react";
import type { Account, Bucket, FamilyMember } from "./types";
import { ProgressRing } from "./charts";
import { formatAmount } from "./format";

/** Today's date in the viewer's local timezone as "YYYY-MM-DD" — deliberately
 * not `toISOString()`, which reads UTC and can land on the wrong day for
 * anyone west of it. */
function todayLocal(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function daysLeft(targetDate: string): number {
  const target = new Date(targetDate + "T00:00:00");
  const today = new Date(todayLocal() + "T00:00:00");
  return Math.max(0, Math.round((target.getTime() - today.getTime()) / 86400000));
}

function NewBucketForm({
  accounts,
  familyMembers,
  onCreate,
}: {
  accounts: Account[];
  familyMembers: FamilyMember[];
  onCreate: (
    name: string,
    targetAmount: string | null,
    targetDate: string | null,
    accountId: number | null,
    memberId: number | null,
  ) => void;
}) {
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [accountId, setAccountId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [open, setOpen] = useState(false);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onCreate(
      name.trim(),
      target.trim() ? target.trim() : null,
      targetDate.trim() ? targetDate.trim() : null,
      accountId ? Number(accountId) : null,
      memberId ? Number(memberId) : null,
    );
    setName("");
    setTarget("");
    setTargetDate("");
    setAccountId("");
    setMemberId("");
    setOpen(false);
  }

  if (!open) {
    return <button onClick={() => setOpen(true)}>New bucket…</button>;
  }

  return (
    <form className="bucket-new-form" onSubmit={handleSubmit}>
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder='e.g. "Emergency Fund"' />
      <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Target amount (optional)" />
      <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} title="Target date" />
      <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
        <option value="">No linked account</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      {familyMembers.length > 0 && (
        <select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
          <option value="">Unassigned</option>
          {familyMembers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      )}
      <button type="submit" disabled={!name.trim()}>
        Create
      </button>
      <button type="button" className="modal-secondary" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </form>
  );
}

function ContributionForm({
  bucketId,
  onAddContribution,
}: {
  bucketId: number;
  onAddContribution: (bucketId: number, date: string, amount: string, note: string | null) => void;
}) {
  const today = todayLocal();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!amount.trim()) return;
    onAddContribution(bucketId, today, amount.trim(), note.trim() ? note.trim() : null);
    setAmount("");
    setNote("");
  }

  return (
    <form className="bucket-contribution-form" onSubmit={handleSubmit}>
      <input
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="Amount (negative = withdrawal)"
      />
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" />
      <button type="submit" disabled={!amount.trim()}>
        Add
      </button>
    </form>
  );
}

export function BucketsView({
  buckets,
  accounts,
  familyMembers,
  onCreateBucket,
  onAddContribution,
  onDeleteBucket,
}: {
  buckets: Bucket[];
  accounts: Account[];
  familyMembers: FamilyMember[];
  onCreateBucket: (
    name: string,
    targetAmount: string | null,
    targetDate: string | null,
    accountId: number | null,
    memberId: number | null,
  ) => void;
  onAddContribution: (bucketId: number, date: string, amount: string, note: string | null) => void;
  onDeleteBucket: (id: number) => void;
}) {
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null);

  return (
    <div className="buckets-view">
      <div className="buckets-grid">
        {buckets.map((b) => {
          const saved = parseFloat(b.saved_amount);
          const target = b.target_amount ? parseFloat(b.target_amount) : null;
          const pct = target && target > 0 ? Math.min(100, Math.max(0, (saved / target) * 100)) : null;
          return (
            <div key={b.id} className="bucket-card">
              <div className="bucket-card-header-row">
                {pct !== null ? (
                  <ProgressRing pct={pct} size={64} />
                ) : (
                  <div className="goal-ring-wrap" style={{ width: 64, height: 64 }} />
                )}
                <div className="bucket-card-main">
                  <div className="bucket-card-header">
                    <h3>{b.name}</h3>
                    {confirmingDeleteId === b.id ? (
                      <span className="row-delete-confirm">
                        <button type="button" className="modal-secondary" onClick={() => setConfirmingDeleteId(null)}>
                          Cancel
                        </button>
                        <button type="button" onClick={() => onDeleteBucket(b.id)}>
                          Delete
                        </button>
                      </span>
                    ) : (
                      <button type="button" className="modal-secondary" onClick={() => setConfirmingDeleteId(b.id)}>
                        Delete
                      </button>
                    )}
                  </div>
                  <p className="bucket-saved">
                    {formatAmount(b.saved_amount)}
                    {b.target_amount && <span className="bucket-target"> of {formatAmount(b.target_amount)}</span>}
                  </p>
                  <p className="bucket-target">
                    {b.account_name && `${b.account_name}`}
                    {b.account_name && (b.member_name || b.target_date) && " · "}
                    {b.member_name && `${b.member_name}`}
                    {b.member_name && b.target_date && " · "}
                    {b.target_date && `${daysLeft(b.target_date)} days left`}
                  </p>
                </div>
              </div>
              <ContributionForm bucketId={b.id} onAddContribution={onAddContribution} />
            </div>
          );
        })}
      </div>
      {buckets.length === 0 && (
        <p className="empty-state">No savings buckets yet — create one to start tracking a goal.</p>
      )}
      <NewBucketForm accounts={accounts} familyMembers={familyMembers} onCreate={onCreateBucket} />
    </div>
  );
}
