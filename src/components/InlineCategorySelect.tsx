"use client";
import { useRef } from "react";
import type { CategoryRow } from "@/lib/db/schema";

/**
 * A select that submits its form on change. The form itself is a server action, so without
 * JavaScript the <noscript> Save button does the same job.
 */
export function InlineCategorySelect({
  categories,
  value,
  manual,
  label,
}: {
  categories: CategoryRow[];
  value: number | null;
  manual: boolean;
  label: string;
}) {
  const ref = useRef<HTMLSelectElement>(null);
  return (
    <>
      <select
        ref={ref}
        name="category"
        className="inline-select"
        aria-label={label}
        defaultValue={value === null ? "" : String(value)}
        onChange={() => ref.current?.form?.requestSubmit()}
      >
        <option value="">{manual ? "None (pinned)" : "Uncategorised"}</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
            {c.archived ? " (archived)" : ""}
          </option>
        ))}
        {manual ? <option value="clear">Use rules again</option> : null}
      </select>
      <noscript>
        <button type="submit" className="row-action">
          Save
        </button>
      </noscript>
    </>
  );
}
