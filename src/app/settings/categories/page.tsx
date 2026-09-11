import { getDb } from "@/lib/db/client";
import { first, type SearchParams } from "@/lib/searchParams";
import { listCategories, dominantCurrency } from "@/lib/queries/categories";
import { CATEGORY_KINDS } from "@/lib/db/schema";
import { SettingsNav } from "@/components/SettingsNav";
import { EmptyState } from "@/components/EmptyState";
import { createCategoryAction, updateCategoryAction, archiveCategoryAction, moveCategoryAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function CategoriesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const db = getDb();
  const all = listCategories(db, { includeArchived: true });
  const active = all.filter((c) => !c.archived);
  const archived = all.filter((c) => c.archived);
  const currency = dominantCurrency(db) ?? "CAD";
  const error = first(sp.error);
  const saved = first(sp.saved);

  return (
    <>
      <section className="section section-lead">
        <div className="section-head">
          <h1 className="section-title">Settings</h1>
        </div>
        <SettingsNav current="categories" />
        {error ? <p className="form-error">{error}</p> : null}
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Categories</h2>
          <p className="section-meta">{active.length === 1 ? "1 category" : `${active.length} categories`}</p>
        </div>
        {active.length === 0 ? (
          <EmptyState title="No categories yet.">Add one below; rules and the transaction list use them.</EmptyState>
        ) : (
          <div className="ledger-scroll">
            <table className="ledger">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Kind</th>
                  <th scope="col" className="ledger-num">Monthly cap</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {active.map((c, i) => (
                  <tr key={c.id}>
                    <td colSpan={3}>
                      <form action={updateCategoryAction} className="filters account-row">
                        <input type="hidden" name="id" value={c.id} />
                        <label className="filter-field">
                          <span className="small">Name</span>
                          <input name="name" defaultValue={c.name} required />
                        </label>
                        <label className="filter-field">
                          <span className="small">Kind</span>
                          <select name="kind" defaultValue={c.kind}>
                            {CATEGORY_KINDS.map((k) => (
                              <option key={k} value={k}>{k}</option>
                            ))}
                          </select>
                        </label>
                        <label className="filter-field">
                          <span className="small">Monthly cap ({c.capCurrency ?? currency})</span>
                          <input name="cap" inputMode="decimal" defaultValue={c.monthlyCapCents === null ? "" : (c.monthlyCapCents / 100).toFixed(2)} placeholder="none" />
                          <input type="hidden" name="capCurrency" value={c.capCurrency ?? currency} />
                        </label>
                        <div className="filter-actions">
                          <button className="button button-primary" type="submit">Save</button>
                          {saved === String(c.id) ? <span className="small">Saved</span> : null}
                        </div>
                      </form>
                    </td>
                    <td className="row-actions">
                      <form action={moveCategoryAction} style={{ display: "inline" }}>
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="direction" value="up" />
                        <button className="row-action" type="submit" disabled={i === 0}>Move up</button>
                      </form>
                      <form action={moveCategoryAction} style={{ display: "inline" }}>
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="direction" value="down" />
                        <button className="row-action" type="submit" disabled={i === active.length - 1}>Move down</button>
                      </form>
                      <form action={archiveCategoryAction} style={{ display: "inline" }}>
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="archived" value="1" />
                        <button className="row-action" type="submit">Archive</button>
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
          <h2 className="section-title">Add a category</h2>
        </div>
        <form action={createCategoryAction} className="form">
          <label className="form-field">
            <span>Name</span>
            <input name="name" required />
          </label>
          <label className="form-field">
            <span>Kind</span>
            <select name="kind" defaultValue="expense">
              {CATEGORY_KINDS.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </label>
          <div className="form-actions">
            <button className="button button-primary" type="submit">Add category</button>
            {saved === "new" ? <span className="small">Added</span> : null}
          </div>
        </form>
      </section>

      {archived.length > 0 ? (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Archived</h2>
            <p className="section-meta">kept for history, hidden from pickers</p>
          </div>
          <ul>
            {archived.map((c) => (
              <li key={c.id}>
                {c.name}{" "}
                <form action={archiveCategoryAction} style={{ display: "inline" }}>
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="archived" value="0" />
                  <button className="row-action" type="submit">Restore</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
