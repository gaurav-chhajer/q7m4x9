import { num, signed } from "./format.js";

/** One plain-English sentence that turns the headline metrics into meaning. */
export function accuracyHeadline(summary, cutoff) {
  if (!summary || !summary.n) return "";
  const dir = summary.bias_mw >= 0 ? "over" : "under";
  return (
    `Using the forecast available at ${cutoff}, wind was ${dir}-estimated by ${num(Math.abs(summary.bias_mw))} MW on average. ` +
    `A half-hour misses by ${num(summary.mae_mw)} MW on average (${num(summary.nmae_pct, 1)}% of output), ` +
    `and one in ten misses by more than ${num(summary.abs_p90_mw)} MW.`
  );
}

/** Rows for the metrics CSV export: section, label, metric, value. */
export function metricsRows(acc) {
  const rows = [["section", "label", "metric", "value"]];
  for (const [k, v] of Object.entries(acc.summary)) rows.push(["summary", acc.cutoff, k, v]);
  for (const b of acc.by_horizon)
    for (const k of ["n", "mae_mw", "bias_mw", "abs_p90_mw"]) rows.push(["by_lead_time_h", `${b.from}-${b.to}`, k, b[k]]);
  for (const h of acc.by_hour)
    for (const k of ["n", "mae_mw", "bias_mw"]) rows.push(["by_hour_of_day", `${String(h.hour).padStart(2, "0")}:00`, k, h[k]]);
  for (const d of acc.daily)
    for (const k of ["n", "mae_mw", "bias_mw", "mean_actual_mw", "mean_forecast_mw"]) rows.push(["daily", d.date, k, d[k]]);
  return rows;
}

/** Rows for the decision CSV export (one row per half-hour). */
export function decisionRows(d) {
  const head = ["delivery_date", "time_utc", "forecast_mw", "actual_mw", "band_low_mw", "band_high_mw",
    "buffer_mw", "firm_wind_mw", "forecast_issued_utc", "lead_time_h", "error_mw_forecast_minus_actual"];
  const buffer = d.summary.buffer_mw;
  return [head, ...d.slots.map((s) => [d.date, s.time, s.forecast, s.actual, s.lower, s.upper, buffer, s.firm,
    s.issued, s.lead_h, s.error])];
}

export { signed };
