"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type SyncResponse = { skipped?: string; runs?: { status: string; transactionsUpserted: number }[]; error?: string };

const SKIPPED: Record<string, string> = {
  // The server answers 409 here; a retry inside the 30 minute guard needs the force path.
  rate_limited: "Synced recently. Hold Shift to force.",
  credentials_invalid:
    "SimpleFin rejected the access URL. Put a working one in SIMPLEFIN_ACCESS_URL, then hold Shift to force.",
  no_access_url: "No access URL yet. Add SIMPLEFIN_ACCESS_URL to .env, then choose Sync now.",
};

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function resultSentence(runs: { status: string; transactionsUpserted: number }[]): string {
  if (runs.length === 0) return "Nothing to sync.";
  const saved = runs.reduce((n, r) => n + r.transactionsUpserted, 0);
  const failed = runs.filter((r) => r.status === "failed").length;
  const partial = runs.filter((r) => r.status === "partial").length;
  const head =
    runs.length === 1
      ? `Saved ${count(saved, "transaction", "transactions")}.`
      : `Saved ${count(saved, "transaction", "transactions")} over ${count(runs.length, "run", "runs")}.`;
  if (failed > 0) return `${head} ${count(failed, "run", "runs")} failed.`;
  if (partial > 0) return `${head} ${count(partial, "run", "runs")} finished with errors.`;
  return head;
}

export function SyncButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [synced, setSynced] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const trigger = (force: boolean) =>
    start(async () => {
      setMsg(null);
      setSynced(false);
      try {
        const res = await fetch(`/api/sync${force ? "?force=1" : ""}`, { method: "POST" });
        const body = (await res.json()) as SyncResponse;
        if (body.skipped) {
          setMsg(SKIPPED[body.skipped] ?? `Nothing ran: ${body.skipped}.`);
        } else if (body.error) {
          setMsg(body.error);
        } else {
          const runs = body.runs ?? [];
          setSynced(runs.length > 0 && runs.every((r) => r.status !== "failed"));
          setMsg(resultSentence(runs));
        }
        router.refresh();
      } catch (e) {
        setMsg(e instanceof Error ? e.message : String(e));
      }
    });

  return (
    <div className="syncbar">
      <button
        type="button"
        className="button button-primary"
        disabled={pending}
        onClick={(e) => trigger(e.shiftKey)}
        title="Hold Shift while choosing Sync now to force a run"
      >
        {pending ? "Syncing…" : synced ? "Synced" : "Sync now"}
      </button>
      {msg ? <span className="small">{msg}</span> : null}
    </div>
  );
}
