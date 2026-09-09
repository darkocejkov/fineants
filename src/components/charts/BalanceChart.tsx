"use client";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { formatCents } from "@/lib/money";

// The same plate as the net worth tooltip: paper, one ink hairline, tabular figures.
const TOOLTIP_STYLE = {
  background: "var(--paper)",
  border: "1px solid var(--ink)",
  borderRadius: 0,
  boxShadow: "none",
  padding: "0.5rem 0.625rem",
  fontSize: "0.8125rem",
  lineHeight: 1.4,
  fontVariantNumeric: "tabular-nums",
} as const;

export function BalanceChart({ points, currency }: { points: { date: string; balanceCents: number }[]; currency: string }) {
  if (points.length === 0) return <p className="small">No balance history yet. Each sync records a snapshot.</p>;
  const data = points.map((p) => ({ date: p.date, balance: p.balanceCents / 100 }));
  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height={200}>
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
            formatter={(v) => [formatCents(Math.round(Number(v) * 100), currency), currency]}
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: "var(--ink-2)", marginBottom: "0.25rem" }}
            itemStyle={{ color: "var(--ink)", padding: 0 }}
          />
          <Line
            type="monotone"
            dataKey="balance"
            name={currency}
            // One snapshot is a point, not a line: Recharts draws nothing for it unless the dot shows.
            dot={data.length > 1 ? false : { r: 3, strokeWidth: 0 }}
            activeDot={false}
            strokeWidth={2}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
