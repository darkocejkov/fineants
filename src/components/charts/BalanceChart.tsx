"use client";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { formatCents } from "@/lib/money";
import {
  CHART_MARGIN,
  TOOLTIP_ITEM_STYLE,
  TOOLTIP_LABEL_STYLE,
  TOOLTIP_STYLE,
  X_AXIS_PROPS,
  Y_AXIS_PROPS,
} from "./chartStyle";

export function BalanceChart({ points, currency }: { points: { date: string; balanceCents: number }[]; currency: string }) {
  if (points.length === 0) return <p className="small">No balance history yet. Each sync records a snapshot.</p>;
  const data = points.map((p) => ({ date: p.date, balance: p.balanceCents / 100 }));
  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={CHART_MARGIN}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="date" {...X_AXIS_PROPS} />
          <YAxis {...Y_AXIS_PROPS} />
          <Tooltip
            isAnimationActive={false}
            formatter={(v) => [formatCents(Math.round(Number(v) * 100), currency), currency]}
            contentStyle={TOOLTIP_STYLE}
            labelStyle={TOOLTIP_LABEL_STYLE}
            itemStyle={TOOLTIP_ITEM_STYLE}
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
