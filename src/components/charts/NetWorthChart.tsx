"use client";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { formatCents } from "@/lib/money";

type Series = { currency: string; points: { date: string; balanceCents: number }[] };

// Every line is drawn in ink; extra currencies are told apart by stroke pattern, which the
// key below names in words so no legend swatch is needed.
const PATTERNS = ["solid", "dashed", "dotted", "dash-dot"] as const;

// One snapshot is a point, not a line: Recharts draws nothing for it unless the dot is shown.
const hasLine = (s: Series) => s.points.length > 1;

function keyPhrase(s: Series, i: number): string {
  if (hasLine(s)) return `The ${PATTERNS[i % PATTERNS.length]} line is ${s.currency}`;
  return `${s.currency} has one snapshot so far, drawn as a single point`;
}

export function NetWorthChart({ series }: { series: Series[] }) {
  if (series.length === 0 || series.every((s) => s.points.length === 0)) {
    return <p className="small">No balance history yet. Each sync records one, so the line starts after the next sync.</p>;
  }
  const dates = [...new Set(series.flatMap((s) => s.points.map((p) => p.date)))].sort();
  const data = dates.map((date) => {
    const row: Record<string, string | number> = { date };
    for (const s of series) {
      const p = s.points.find((x) => x.date === date);
      if (p) row[s.currency] = p.balanceCents / 100;
    }
    return row;
  });
  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="date" axisLine={false} tickLine={false} minTickGap={28} tickMargin={8} />
          <YAxis
            axisLine={false}
            tickLine={false}
            width={72}
            tickMargin={8}
            tickFormatter={(v: number) => v.toLocaleString()}
          />
          <Tooltip
            isAnimationActive={false}
            formatter={(v, name) => [formatCents(Math.round(Number(v) * 100), String(name)), String(name)]}
            contentStyle={{
              background: "var(--paper)",
              border: "1px solid var(--ink)",
              borderRadius: 0,
              boxShadow: "none",
              padding: "0.5rem 0.625rem",
              fontSize: "0.8125rem",
              lineHeight: 1.4,
              fontVariantNumeric: "tabular-nums",
            }}
            labelStyle={{ color: "var(--ink-2)", marginBottom: "0.25rem" }}
            itemStyle={{ color: "var(--ink)", padding: 0 }}
          />
          {series.map((s, i) => (
            <Line
              key={s.currency}
              className={`chart-line-${i % PATTERNS.length}`}
              type="monotone"
              dataKey={s.currency}
              dot={hasLine(s) ? false : { r: 3, strokeWidth: 0 }}
              activeDot={false}
              strokeWidth={2}
              isAnimationActive={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      {series.length > 1 || series.some((s) => !hasLine(s)) ? (
        <p className="chart-key">{series.map(keyPhrase).join(". ")}.</p>
      ) : null}
    </div>
  );
}
