import type { ErrItem } from "../simplefin/types";

export type Attribution = { items: ErrItem[]; heldAll: boolean; heldIds: Set<string> };

/**
 * Decide which connection each errlist item is about. The new wire shape says so with
 * `conn_id`; the old shape only has prose, so the connection whose name appears in it wins,
 * but only when exactly one does. Anything undecidable holds every watermark for this run:
 * re-fetching a window is cheap and idempotent, skipping one is silent data loss.
 */
export function attributeErrors(errlist: ErrItem[], connections: { id: string; name: string }[]): Attribution {
  const ids = new Set(connections.map((c) => c.id));
  const items: ErrItem[] = [];
  const heldIds = new Set<string>();
  let heldAll = false;

  for (const e of errlist) {
    let attributed: string | undefined;
    if (e.connId && ids.has(e.connId)) {
      attributed = e.connId;
    } else if (!e.connId) {
      const msg = e.msg.toLowerCase();
      const named = connections.filter((c) => c.name.trim() && msg.includes(c.name.trim().toLowerCase()));
      if (named.length === 1) attributed = named[0].id;
    }
    if (attributed) {
      heldIds.add(attributed);
      items.push({ ...e, attributedConnectionId: attributed });
    } else {
      heldAll = true;
      items.push({ ...e });
    }
  }
  if (heldAll) for (const id of ids) heldIds.add(id);
  return { items, heldAll, heldIds };
}
