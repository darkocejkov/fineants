import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { loadConfig } from "@/lib/config";
import { first, type SearchParams } from "@/lib/searchParams";
import { listRecurringWithStatus, getRecurringCost, previewPatternMatches, type RecurringInput } from "@/lib/queries/recurring";
import { listCategories, dominantCurrency } from "@/lib/queries/categories";
import { listAccounts, displayName } from "@/lib/queries/accounts";
import { CADENCES, type Cadence } from "@/lib/db/schema";
import { formatCents } from "@/lib/money";
import { todayLocal } from "@/lib/time";
import type { RecurringStatus } from "@/lib/recurring/schedule";
import { Amount } from "@/components/Amount";
import { EmptyState } from "@/components/EmptyState";
import { StatusWord, type StatusTone } from "@/components/StatusWord";
import { createRecurringAction, updateRecurringAction, setRecurringActiveAction, deleteRecurringAction } from "./actions";

export const dynamic = "force-dynamic";

const CADENCE_LABEL: Record<Cadence, string> = { weekly: "every week", biweekly: "every two weeks", monthly: "every month", yearly: "every year", custom_days: "every N days" };
const TONE: Record<RecurringStatus, StatusTone> = { paid: "good", due: "neutral", overdue: "bad" };

function previewInputFrom(sp: SearchParams): (RecurringInput & { active?: boolean }) | null {
  if (first(sp.preview) !== "1") return null;
  const cadence = first(sp.cadence) ?? "monthly";
  const money = (v?: string) => (v ? Math.round(Number(v.replace(/[,$\s]/g, "")) * 100) : 0);
  const tol = first(sp.tolerance);
  return {
    name: first(sp.name) ?? "",
    provider: first(sp.provider) ?? null,
    currency: first(sp.currency) ?? "CAD",
    amountCents: money(first(sp.amount)),
    cadence: (CADENCES as readonly string[]).includes(cadence) ? (cadence as Cadence) : "monthly",
    intervalDays: first(sp.intervalDays) ? Number(first(sp.intervalDays)) : null,
    anchorOn: first(sp.anchorOn) ?? "",
    categoryId: first(sp.category) ? Number(first(sp.category)) : null,
    accountId: first(sp.account) ?? null,
    matchPattern: first(sp.matchPattern) ?? null,
    matchToleranceBps: tol ? Math.round(Number(tol) * 100) : 1000,
    notes: first(sp.notes) ?? null,
    active: first(sp.active) === "on",
  };
}

export default async function RecurringPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const db = getDb();
  const today = todayLocal(loadConfig().timezone);
  const showInactive = first(sp.inactive) === "1";
  const rows = listRecurringWithStatus(db, { today, includeInactive: showInactive });
  const categories = listCategories(db);
  const catName = new Map(listCategories(db, { includeArchived: true }).map((c) => [c.id, c.name]));
  const accounts = listAccounts(db, { includeHidden: true });
  const currency = dominantCurrency(db) ?? "CAD";
  const error = first(sp.error);
  const saved = first(sp.saved);
  const editId = first(sp.edit) && /^\d+$/.test(first(sp.edit)!) ? Number(first(sp.edit)) : null;
  const editing = editId !== null ? getRecurringCost(db, editId) : undefined;
  const previewInput = previewInputFrom(sp);
  const preview = previewInput ? previewPatternMatches(db, previewInput) : null;

  const totals = new Map<string, number>();
  for (const r of rows) if (r.active) totals.set(r.currency, (totals.get(r.currency) ?? 0) + r.monthlyEquivalentCents);

  const d: RecurringInput & { active?: boolean } =
    previewInput ??
    (editing
      ? { name: editing.name, provider: editing.provider, currency: editing.currency, amountCents: editing.amountCents, cadence: editing.cadence, intervalDays: editing.intervalDays, anchorOn: editing.anchorOn, categoryId: editing.categoryId, accountId: editing.accountId, matchPattern: editing.matchPattern, matchToleranceBps: editing.matchToleranceBps, notes: editing.notes, active: editing.active }
      : { name: "", currency, amountCents: 0, cadence: "monthly", anchorOn: today, matchToleranceBps: 1000 });
  const dollars = (c: number | null | undefined) => (c ? (c / 100).toFixed(2) : "");
  const formKey = editing ? `edit-${editing.id}${previewInput ? "-preview" : ""}` : previewInput ? "preview" : "new";

  return (
    <>
      <section className="section hero">
        <div className="section-head">
          <h1 className="section-title">Recurring</h1>
          <p className="section-meta">{rows.filter((r) => r.active).length === 1 ? "1 commitment" : `${rows.filter((r) => r.active).length} commitments`}</p>
        </div>
        {[...totals.entries()].map(([cur, cents]) => (
          <div key={cur} className="hero-figure">
            <p className="stamp">
              <Amount cents={cents} currency={cur} signColour={false} />
              <span className="stamp-currency">{cur}</span>
            </p>
            <p className="hero-note">a month, with every commitment normalised to a monthly amount.</p>
          </div>
        ))}
        {totals.size === 0 ? <p className="hero-note">Add your subscriptions and bills below and fineants will tell you what they cost a month and which are paid.</p> : null}
        {error ? <p className="form-error">{error}</p> : null}
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Commitments</h2>
          <p className="section-meta">
            <Link href={showInactive ? "/recurring" : "/recurring?inactive=1"}>{showInactive ? "hide inactive" : "show inactive"}</Link>
          </p>
        </div>
        {rows.length === 0 ? (
          <EmptyState title="Nothing recurring yet.">Add a subscription or bill below.</EmptyState>
        ) : (
          <div className="ledger-scroll">
            <table className="ledger">
              <thead>
                <tr>
                  <th scope="col">Commitment</th>
                  <th scope="col" className="ledger-num">Expected</th>
                  <th scope="col">Cadence</th>
                  <th scope="col" className="ledger-date">Due</th>
                  <th scope="col">Status</th>
                  <th scope="col">Seen as</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.name}
                      {r.provider ? <span className="ledger-quiet"> {r.provider}</span> : null}
                      {!r.active ? <span className="small"> inactive</span> : null}
                      {r.categoryId ? <span className="small"> {catName.get(r.categoryId)}</span> : null}
                    </td>
                    <td className="ledger-num"><Amount cents={r.amountCents} currency={r.currency} signColour={false} /></td>
                    <td className="ledger-quiet">{r.cadence === "custom_days" ? `every ${r.intervalDays} days` : CADENCE_LABEL[r.cadence]}</td>
                    <td className="ledger-date">{r.dueOn}</td>
                    <td><StatusWord tone={TONE[r.status]}>{r.status}</StatusWord></td>
                    <td className="ledger-quiet">
                      {r.matched ? (
                        <Link href={`/transactions?q=${encodeURIComponent(r.matchPattern ?? r.name)}&from=${r.matched.localDate}&to=${r.matched.localDate}`}>
                          {r.matched.localDate} {formatCents(r.matched.amountCents, r.currency)}
                        </Link>
                      ) : (
                        "not seen"
                      )}
                    </td>
                    <td className="row-actions">
                      <Link className="row-action" href={`/recurring?edit=${r.id}`}>Edit</Link>
                      <form action={setRecurringActiveAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="active" value={r.active ? "0" : "1"} />
                        <button className="row-action" type="submit">{r.active ? "Deactivate" : "Activate"}</button>
                      </form>
                      <form action={deleteRecurringAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <button className="row-action" type="submit">Delete</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">{editing ? `Edit ${editing.name}` : "Add a recurring cost"}</h2>
          {editing ? (
            <p className="section-meta"><Link href="/recurring">Add a new one instead</Link></p>
          ) : null}
        </div>
        <form key={formKey} action={editing ? updateRecurringAction : createRecurringAction} className="form">
          {editing ? (
            <>
              <input type="hidden" name="id" value={editing.id} />
              <input type="hidden" name="edit" value={editing.id} />
            </>
          ) : null}
          <div className="form-row">
            <label className="form-field">
              <span>Name</span>
              <input name="name" defaultValue={d.name} required placeholder="Phone" />
            </label>
            <label className="form-field">
              <span>Provider (optional)</span>
              <input name="provider" defaultValue={d.provider ?? ""} placeholder="Rogers" />
            </label>
          </div>
          <div className="form-row">
            <label className="form-field">
              <span>Expected amount</span>
              <input name="amount" inputMode="decimal" defaultValue={dollars(d.amountCents)} required />
            </label>
            <label className="form-field">
              <span>Currency</span>
              <input name="currency" defaultValue={d.currency} />
            </label>
          </div>
          <div className="form-row">
            <label className="form-field">
              <span>How often</span>
              <select name="cadence" defaultValue={d.cadence}>
                {CADENCES.map((c) => (
                  <option key={c} value={c}>{CADENCE_LABEL[c]}</option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>Every N days (custom only)</span>
              <input name="intervalDays" inputMode="numeric" defaultValue={d.intervalDays ?? ""} />
            </label>
          </div>
          <label className="form-field">
            <span>A due date you know</span>
            <input type="date" name="anchorOn" defaultValue={d.anchorOn} required />
          </label>
          <div className="form-row">
            <label className="form-field">
              <span>Category (optional)</span>
              <select name="category" defaultValue={d.categoryId ?? ""}>
                <option value="">none</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>Only in account (optional)</span>
              <select name="account" defaultValue={d.accountId ?? ""}>
                <option value="">any account</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{displayName(a)}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-row">
            <label className="form-field">
              <span>Matches transactions containing</span>
              <input name="matchPattern" defaultValue={d.matchPattern ?? ""} placeholder={d.provider ?? d.name ?? ""} />
            </label>
            <label className="form-field">
              <span>Amount tolerance (%)</span>
              <input name="tolerance" inputMode="decimal" defaultValue={((d.matchToleranceBps ?? 1000) / 100).toString()} />
            </label>
          </div>
          <label className="form-field">
            <span>Notes (optional)</span>
            <input name="notes" defaultValue={d.notes ?? ""} />
          </label>
          {editing ? (
            <label className="form-field">
              <span><input type="checkbox" name="active" value="on" defaultChecked={d.active ?? true} /> Active</span>
            </label>
          ) : null}
          <div className="form-actions">
            <button className="button button-primary" type="submit">{editing ? "Save recurring cost" : "Add recurring cost"}</button>
            <button className="button" type="submit" formAction="/recurring" formMethod="get" name="preview" value="1">Preview matches</button>
            {saved ? <span className="small">Saved</span> : null}
          </div>
          {preview ? (
            <div className="preview">
              <p>Would match {preview.count === 1 ? "1 transaction" : `${preview.count} transactions`}{preview.sample.length ? ", most recent first:" : "."}</p>
              {preview.sample.length ? (
                <table className="ledger">
                  <tbody>
                    {preview.sample.map((s) => (
                      <tr key={s.id}>
                        <td className="ledger-date">{s.localDate ?? ""}</td>
                        <td>{s.payee ?? s.description}</td>
                        <td className="ledger-num">{formatCents(s.amountCents, s.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
          ) : null}
        </form>
      </section>

      <p className="footnote">
        A commitment is paid for a period when a matching transaction lands from a week before its due date until a week before the next one.
        Matching uses the text and a tolerance around the expected amount. Monthly figures normalise weekly and yearly costs to a month.
      </p>
    </>
  );
}
