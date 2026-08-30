/** Static, in-app version of the project README — no props, no backend
 * calls, just the same tour/instructions/FAQ so a user never has to leave
 * the app (or find a separate file) to look something up. Keep this in
 * sync with README.md when a feature changes. */
export function HelpView() {
  return (
    <div className="reports-view help-view">
      <div className="card">
        <h2 className="reports-section-title">Getting started</h2>
        <ol>
          <li>
            <strong>Add an account</strong> — from the Reports tab
            ("Add account…"), or you'll be prompted automatically the first
            time you import a file. Checking, savings, credit card, loan,
            investment, and "other" are all supported.
          </li>
          <li>
            <strong>Get your transactions in</strong>, either by importing a
            CSV from your bank (see below) or entering them by hand in the
            Ledger.
          </li>
          <li>
            <strong>Set up your budget</strong> in the Budget tab — add a
            monthly amount per category, grouped as Income / Fixed /
            Flexible / Non-Monthly.
          </li>
          <li>
            From there, the Dashboard and Cash Flow tabs summarize
            everything automatically — there's nothing else to configure.
          </li>
        </ol>
      </div>

      <div className="card">
        <h2 className="reports-section-title">A tour of the tabs</h2>
        <ul>
          <li>
            <strong>Dashboard</strong> — net worth, this month's spending,
            and budget alerts at a glance.
          </li>
          <li>
            <strong>Ledger</strong> — every transaction, filterable by
            account/category/tag, with inline category correction (one at a
            time or in bulk), splitting a transaction across multiple
            categories, tagging, and applying a payment toward a debt
            account.
          </li>
          <li>
            <strong>Budget</strong> — this month's budgeted vs. actual per
            category, with prev/next month navigation and drag-to-reorder.
            Click any category name to see every transaction behind that
            number and fix any that are miscategorized, right from that
            screen.
          </li>
          <li>
            <strong>Buckets</strong> — savings goals with a target
            amount/date, optionally linked to an account, with a running
            total and contribution history.
          </li>
          <li>
            <strong>Cash Flow</strong> — income vs. expenses over a 3 or 6
            month window (with an optional year-over-year comparison);
            click a bar to see that month's spending by category and any
            unusually large charges. "Top categories"/"Top merchants" below
            are scoped to a single month (defaulting to the current one,
            with a picker to look back further) and show a month-over-month
            trend per category.
          </li>
          <li>
            <strong>Recurring</strong> — a manually maintained list of
            recurring bills/income, each showing its next expected date.
          </li>
          <li>
            <strong>Investments</strong> — holdings per account (shares,
            price, cost basis) with computed value and gain/loss. This is a
            manual tracker, not a live market-data feed.
          </li>
          <li>
            <strong>Reports</strong> — accounts management, net worth
            breakdown, total saved, all-time income, spending by tag, this
            month's budget snapshot, and the CSV/PDF export and setup-data
            import/export tools described below.
          </li>
        </ul>
      </div>

      <div className="card">
        <h2 className="reports-section-title">Importing transactions</h2>
        <p>
          From the <strong>Ledger</strong> tab, click <strong>"Import
          CSV…"</strong>:
        </p>
        <ol>
          <li>
            Pick which account the file belongs to (or create a new one on
            the spot).
          </li>
          <li>Choose the CSV file exported from your bank or credit card.</li>
          <li>
            Confirm which way the amounts go. Penny Worth's convention is
            <em> negative = money out</em>; if your file shows charges as
            positive numbers (common for credit card exports), choose "Flip
            the signs" — otherwise "Keep as-is."
          </li>
          <li>
            You'll see a preview of every row before anything is saved.
            Rows that look like duplicates of something already in your
            ledger are unchecked by default (see the FAQ below) — check or
            uncheck any row, or override which account a specific row
            should land in.
          </li>
          <li>
            Confirm the import. Each new transaction is auto-categorized
            where possible; anything it can't confidently place is left
            Uncategorized for you to set yourself.
          </li>
        </ol>
      </div>

      <div className="card">
        <h2 className="reports-section-title">Bulk setup-data import/export</h2>
        <p>
          If you'd rather set up accounts, categories, budgets, and buckets
          in bulk instead of one at a time through the UI, use the two
          buttons on the <strong>Reports</strong> tab:
        </p>
        <ul>
          <li>
            <strong>"Download setup template…"</strong> saves one CSV file
            with a section for each of Accounts / Categories / Budgets /
            Buckets, with one example row in each section to show the
            expected columns.
          </li>
          <li>
            Open it, delete the example rows, fill in your own (keep the
            section titles and column headers as they are), and save.
          </li>
          <li>
            <strong>"Import setup data…"</strong> reads the file back in
            and shows you a review screen — anything that already exists is
            flagged, and you choose what to actually apply before anything
            is written.
          </li>
          <li>A blank "Period" on a budget row defaults to the current month.</li>
        </ul>
      </div>

      <div className="card">
        <h2 className="reports-section-title">Exporting your data</h2>
        <ul>
          <li>
            <strong>"Export CSV…"</strong> (Reports tab) exports whatever
            rows are currently visible/filtered.
          </li>
          <li>
            <strong>"Print / Save as PDF…"</strong> opens your system print
            dialog against the current Reports view — choose "Save as PDF"
            as the destination if you want a file instead of a physical
            printout.
          </li>
        </ul>
      </div>

      <div className="card">
        <h2 className="reports-section-title">FAQ</h2>

        <h3>Is my data private?</h3>
        <p>
          Yes. Everything is stored in one file on your own computer,
          created fresh the first time you launch the app. There's no
          account, no server, and nothing is ever uploaded — a fresh
          install on someone else's computer starts completely empty,
          never with your data.
        </p>

        <h3>I got a "Windows protected your PC" warning — is this safe?</h3>
        <p>
          That's Windows SmartScreen, and it appears because this installer
          isn't signed with a certificate Microsoft already recognizes — it
          doesn't mean anything is actually wrong. Click "More info," then
          "Run anyway."
        </p>

        <h3>What happens if I import the same file twice?</h3>
        <p>
          Every transaction is fingerprinted from its date, description,
          amount, and account. An exact repeat is flagged as a likely
          duplicate in the import preview and left unchecked by default, so
          re-importing the same statement won't create doubled entries
          unless you explicitly check it back in.
        </p>

        <h3>How does auto-categorization work?</h3>
        <p>
          New transactions are matched against rules first — an exact
          merchant match, or a pattern Penny Worth has learned from a
          category you've corrected before. Once you've made at least 10
          corrections, a lightweight classifier also kicks in for
          transactions the rules don't cover. Anything neither can
          confidently place is left Uncategorized rather than guessing —
          setting it yourself teaches the app for next time.
        </p>

        <h3>Can I fix a transaction's category after the fact?</h3>
        <p>
          Yes, several ways: the category dropdown on any Ledger row;
          selecting several rows and using the Ledger's bulk-edit bar to
          recategorize them all at once; or, from the Budget page, clicking
          a category name to see every transaction behind that month's
          number and fixing any of them right there (individually or in
          bulk).
        </p>

        <h3>How do budgets carry forward month to month?</h3>
        <p>
          A new month starts from whatever the closest earlier month had
          set for each category, so you don't need to re-enter every line
          every month. Changing the current month's amount never changes a
          past month's numbers.
        </p>

        <h3>Can I split one transaction across multiple categories?</h3>
        <p>
          Yes — the Ledger's "Split →" control on any transaction lets you
          divide it into as many category/amount lines as you need, each
          with an optional note.
        </p>

        <h3>Does it support credit cards and loans, not just checking/savings?</h3>
        <p>
          Yes — each account type tracks its balance the way that type
          actually works: a credit card's balance is available credit, a
          loan's is what's still owed, and a checking/savings/investment/
          other account's is a literal balance.
        </p>
      </div>
    </div>
  );
}
