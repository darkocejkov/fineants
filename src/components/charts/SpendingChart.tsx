"use client";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { formatCents } from "@/lib/money";
import type { PeriodTotals } from "@/lib/queries/spending";
import {
  CHART_MARGIN,
  TOOLTIP_ITEM_STYLE,
  TOOLTIP_LABEL_STYLE,
  TOOLTIP_STYLE,
  X_AXIS_PROPS,
  Y_AXIS_PROPS,
} from "./chartStyle";

/**
 * One currency, two bars per period: spent and received.
 *
 * The key is the plain line above the chart, not a Recharts <Legend>: the two bars are otherwise
 * told apart by colour alone, the tooltip needs a pointer and JavaScript to say anything, and the
 * line is where every other chart in the sheet already names its currency.
 *
 * Periods with no activity are absent from `rows` and are simply not plotted; phase 1 does not
 * gap-fill, so the section's meta line says how many periods carried activity.
 */
export function SpendingChart({ rows, currency }: { rows: PeriodTotals[]; currency: string }) {
  if (rows.length === 0) return <p className="small">No transactions in this range.</p>;
  const data = rows.map((r) => ({ period: r.period, spent: r.outflowCents / 100, received: r.inflowCents / 100 }));
  return (
    <div className="chart">
      <p className="chart-label">
        <span className="chart-key-out">Spent</span> and <span className="chart-key-in">received</span> in {currency}
      </p>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={CHART_MARGIN}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="period" {...X_AXIS_PROPS} />
          <YAxis {...Y_AXIS_PROPS} />
          <Tooltip
            isAnimationActive={false}
            separator=" "
            // No wash behind the hovered period: the sheet's shared .recharts-tooltip-cursor rule
            // already outlines it in cobalt, the way the balance charts mark the hovered date.
            cursor={{ fill: "none" }}
            formatter={(v, name) => [formatCents(Math.round(Number(v) * 100), currency), String(name)]}
            contentStyle={TOOLTIP_STYLE}
            labelStyle={TOOLTIP_LABEL_STYLE}
            itemStyle={TOOLTIP_ITEM_STYLE}
          />
          {/* No radius: the sheet rounds inputs and buttons only. maxBarSize keeps a 7-day
              range from drawing seven poster-width slabs. */}
          <Bar dataKey="spent" name="Spent" fill="var(--oxblood)" maxBarSize={28} isAnimationActive={false} />
          <Bar dataKey="received" name="Received" fill="var(--bottle)" maxBarSize={28} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
