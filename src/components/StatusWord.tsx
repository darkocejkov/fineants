export type StatusTone = "good" | "attention" | "bad" | "neutral";

export function StatusWord({ tone, children }: { tone: StatusTone; children: React.ReactNode }) {
  return <span className={`status-word status-${tone}`}>{children}</span>;
}
