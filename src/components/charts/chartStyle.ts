/**
 * The plate every chart is served on: paper, one ink hairline, tabular figures, no shadow,
 * no radius. These are design tokens, so they live in one file — a palette change should be
 * one edit, not three — and they are identical in the net worth, balance and spending charts.
 */
export const TOOLTIP_STYLE = {
  background: "var(--paper)",
  border: "1px solid var(--ink)",
  borderRadius: 0,
  boxShadow: "none",
  padding: "0.5rem 0.625rem",
  fontSize: "0.8125rem",
  lineHeight: 1.4,
  fontVariantNumeric: "tabular-nums",
} as const;

export const TOOLTIP_LABEL_STYLE = { color: "var(--ink-2)", marginBottom: "0.25rem" } as const;
export const TOOLTIP_ITEM_STYLE = { color: "var(--ink)", padding: 0 } as const;

/** Flush left so the axis labels line up with the column of text above the chart. */
export const CHART_MARGIN = { top: 4, right: 4, left: 0, bottom: 0 } as const;

/** No axis line and no tick marks: the grid's horizontal rules are the only structure. */
export const X_AXIS_PROPS = { axisLine: false, tickLine: false, minTickGap: 28, tickMargin: 8 } as const;
export const Y_AXIS_PROPS = {
  axisLine: false,
  tickLine: false,
  width: 72,
  tickMargin: 8,
  tickFormatter: (v: number) => v.toLocaleString(),
} as const;
