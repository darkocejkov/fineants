import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { first, type SearchParams } from "@/lib/searchParams";
import { listRules, getRule, previewRuleMatches, validateRuleInput, type RuleInput } from "@/lib/queries/rules";
import { listCategories } from "@/lib/queries/categories";
import { listAccounts, displayName } from "@/lib/queries/accounts";
import { RULE_FIELDS, RULE_MATCHES, type RuleField, type RuleMatch } from "@/lib/db/schema";
import { formatCents } from "@/lib/money";
import { SettingsNav } from "@/components/SettingsNav";
import { EmptyState } from "@/components/EmptyState";
import { createRuleAction, updateRuleAction, deleteRuleAction, moveRuleAction } from "../actions";

export const dynamic = "force-dynamic";

function inputFromParams(sp: SearchParams): RuleInput | null {
  if (first(sp.preview) !== "1") return null;
  const field = first(sp.field) ?? "any";
  const match = first(sp.match) ?? "contains";
  const money = (v?: string) => (v ? Math.round(Number(v.replace(/[,$\s]/g, "")) * 100) : null);
  return {
    name: first(sp.name) ?? "",
    field: (RULE_FIELDS as readonly string[]).includes(field) ? (field as RuleField) : "any",
    match: (RULE_MATCHES as readonly string[]).includes(match) ? (match as RuleMatch) : "contains",
    pattern: first(sp.pattern) ?? "",
    accountId: first(sp.account) ?? null,
    minAmountCents: money(first(sp.min)),
    maxAmountCents: money(first(sp.max)),
    categoryId: first(sp.category) ? Number(first(sp.category)) : null,
    markTransfer: first(sp.markTransfer) === "on",
    // The Active checkbox only exists while editing, and an unticked box sends nothing, so the
    // preview has to read it too or previewing an inactive rule would silently re-activate it.
    active: first(sp.active) === "on",
  };
}

export default async function RulesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const db = getDb();
  const rules = listRules(db, { includeInactive: true });
  const categories = listCategories(db);
  const accounts = listAccounts(db, { includeHidden: true });
  const catName = new Map(listCategories(db, { includeArchived: true }).map((c) => [c.id, c.name]));
  const error = first(sp.error);
  const saved = first(sp.saved);
  const editId = first(sp.edit) && /^\d+$/.test(first(sp.edit)!) ? Number(first(sp.edit)) : null;
  const editing = editId !== null ? getRule(db, editId) : undefined;
  const previewInput = inputFromParams(sp);
  const previewProblem = previewInput ? validateRuleInput(previewInput, { forPreview: true }) : null;
  const preview = previewInput && !previewProblem ? previewRuleMatches(db, previewInput) : null;

  // Form defaults: the preview's values if there was one, else the rule being edited, else blank.
  const d: RuleInput = previewInput ?? (editing ? { name: editing.name, field: editing.field, match: editing.match, pattern: editing.pattern, accountId: editing.accountId, minAmountCents: editing.minAmountCents, maxAmountCents: editing.maxAmountCents, categoryId: editing.categoryId, markTransfer: editing.markTransfer, active: editing.active } : { name: "", field: "any", match: "contains", pattern: "" });
  const cents = (n: number | null | undefined) => (n === null || n === undefined ? "" : (n / 100).toFixed(2));

  return (
    <>
      <section className="section section-lead">
        <div className="section-head">
          <h1 className="section-title">Settings</h1>
        </div>
        <SettingsNav current="rules" />
        {error ? <p className="form-error">{error}</p> : null}
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Rules</h2>
          <p className="section-meta">first match wins, top to bottom</p>
        </div>
        {rules.length === 0 ? (
          <EmptyState title="No rules yet.">Add one below. Rules re-tag every transaction the moment you save.</EmptyState>
        ) : (
          <div className="ledger-scroll">
            <table className="ledger">
              <thead>
                <tr>
                  <th scope="col">Rule</th>
                  <th scope="col">Looks at</th>
                  <th scope="col">Pattern</th>
                  <th scope="col">Sets</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r, i) => (
                  <tr key={r.id}>
                    <td>
                      {r.name}
                      {!r.active ? <span className="small"> inactive</span> : null}
                    </td>
                    <td className="ledger-quiet">{r.field === "any" ? "payee or description" : r.field}</td>
                    <td>{r.match === "regex" ? `/${r.pattern}/i` : r.pattern}</td>
                    <td>
                      {[r.categoryId !== null ? catName.get(r.categoryId) ?? "a removed category" : null, r.markTransfer ? "transfer" : null].filter(Boolean).join(", ")}
                    </td>
                    <td className="row-actions">
                      <Link className="row-action" href={`/settings/rules?edit=${r.id}`}>Edit</Link>
                      <form action={moveRuleAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="direction" value="up" />
                        <button className="row-action" type="submit" disabled={i === 0}>Move up</button>
                      </form>
                      <form action={moveRuleAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="direction" value="down" />
                        <button className="row-action" type="submit" disabled={i === rules.length - 1}>Move down</button>
                      </form>
                      <form action={deleteRuleAction}>
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
          <h2 className="section-title">{editing ? `Edit rule ${editing.name}` : "Add a rule"}</h2>
          {editing ? (
            <p className="section-meta">
              <Link href="/settings/rules">Add a new rule instead</Link>
            </p>
          ) : null}
        </div>
        <form action={editing ? updateRuleAction : createRuleAction} className="form">
          {/* `id` is for the server action. `edit` rides along so the Preview button, which
              submits this form as a GET and so replaces the query string with the form fields,
              comes back to the edit form rather than falling through to "Add a rule". */}
          {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
          {editing ? <input type="hidden" name="edit" value={editing.id} /> : null}
          <label className="form-field">
            <span>Name (optional)</span>
            <input name="name" defaultValue={d.name ?? ""} placeholder="defaults to the pattern" />
          </label>
          <div className="form-row">
            <label className="form-field">
              <span>Looks at</span>
              <select name="field" defaultValue={d.field}>
                <option value="any">payee or description</option>
                <option value="payee">payee</option>
                <option value="description">description</option>
              </select>
            </label>
            <label className="form-field">
              <span>Matches when</span>
              <select name="match" defaultValue={d.match}>
                <option value="contains">it contains</option>
                <option value="regex">it matches the regular expression</option>
              </select>
            </label>
          </div>
          <label className="form-field">
            <span>Pattern</span>
            <input name="pattern" defaultValue={d.pattern} required />
          </label>
          <label className="form-field">
            <span>Only in account</span>
            <select name="account" defaultValue={d.accountId ?? ""}>
              <option value="">any account</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{displayName(a)}</option>
              ))}
            </select>
          </label>
          <div className="form-row">
            <label className="form-field">
              <span>Minimum amount (signed, spending is negative)</span>
              <input name="min" inputMode="decimal" defaultValue={cents(d.minAmountCents)} placeholder="any" />
            </label>
            <label className="form-field">
              <span>Maximum amount</span>
              <input name="max" inputMode="decimal" defaultValue={cents(d.maxAmountCents)} placeholder="any" />
            </label>
          </div>
          <label className="form-field">
            <span>Set category</span>
            <select name="category" defaultValue={d.categoryId === null || d.categoryId === undefined ? "" : String(d.categoryId)}>
              <option value="">leave the category alone</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>
              <input type="checkbox" name="markTransfer" defaultChecked={d.markTransfer ?? false} /> Mark matching transactions as transfers
            </span>
          </label>
          {editing ? (
            <label className="form-field">
              <span>
                <input type="checkbox" name="active" value="on" defaultChecked={d.active ?? true} /> Active
              </span>
            </label>
          ) : null}
          <div className="form-actions">
            <button className="button button-primary" type="submit">{editing ? "Save rule" : "Add rule"}</button>
            <button className="button" type="submit" formAction="/settings/rules" formMethod="get" name="preview" value="1">
              Preview matches
            </button>
            {saved ? <span className="small">Saved</span> : null}
          </div>
          {previewProblem ? <p className="form-error">{previewProblem}</p> : null}
          {preview ? (
            <div className="preview">
              <p>
                Would match {preview.count === 1 ? "1 transaction" : `${preview.count} transactions`}
                {preview.sample.length > 0 ? ", for example:" : "."}
              </p>
              {preview.sample.length > 0 ? (
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
    </>
  );
}
