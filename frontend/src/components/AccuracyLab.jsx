import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, LineChart, ReferenceArea, ReferenceLine,
  ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import { dayLabel, downloadCsv, num, signed } from "../lib/format.js";
import { accuracyHeadline, metricsRows } from "../lib/insight.js";
import { C } from "../lib/theme.js";
import { Loading, Notice, Panel, Strip } from "./ui.jsx";

const axis = { tick: { fill: C.text, fontSize: 12 }, tickLine: false, axisLine: { stroke: C.grid } };
const yAxis = { tick: { fill: C.text, fontSize: 12 }, tickLine: false, axisLine: false, width: 56 };
const grid = <CartesianGrid stroke={C.grid} strokeDasharray="3 4" vertical={false} />;

function Tip({ active, payload, title, lines }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="tip">
      <strong>{title(d)}</strong>
      {lines.map(([label, fn]) => <div className="row" key={label}><span>{label}</span><span>{fn(d)}</span></div>)}
    </div>
  );
}
const tip = (title, lines) => <Tooltip cursor={{ fill: "rgba(255,255,255,0.05)" }} content={(p) => <Tip {...p} title={title} lines={lines} />} />;

function Figure({ title, caption, className = "", label, children }) {
  return (
    <Panel className={`figure ${className}`}>
      <h3>{title}</h3>
      <p className="figure__cap">{caption}</p>
      <div style={{ height: 290 }} role="img" aria-label={label}>{children}</div>
    </Panel>
  );
}

export default function AccuracyLab({ acc, cutoff, setCutoff, meta }) {
  const { data, error, loading } = acc;
  if (error) return <Notice tone="error" title="Couldn't load the accuracy figures">{error.message}</Notice>;
  if (!data) return <Loading label="Measuring forecast errors" />;
  const s = data.summary;
  if (!s.n) return <Notice tone="warn" title="Nothing to measure">No half-hours have both a forecast before the cutoff and an actual.</Notice>;

  const maxAxis = Math.ceil(Math.max(...data.pairs.flat()) / 2000) * 2000;
  const scatter = data.pairs.map(([f, a]) => ({ f, a }));
  const dh = data.decision_horizon_h;
  const strip = [
    { label: "Average miss (MAE)", value: num(s.mae_mw), unit: "MW", key: true, note: `${num(s.nmae_pct, 1)}% of average output` },
    { label: "Typical big miss (RMSE)", value: num(s.rmse_mw), unit: "MW", note: "Penalises large misses" },
    { label: "Bias", value: signed(s.bias_mw), unit: "MW", note: s.bias_mw > 0 ? "Forecast runs high" : "Forecast runs low" },
    { label: "1 in 10 misses exceed", value: num(s.abs_p90_mw), unit: "MW", note: `1 in 20 exceed ${num(s.abs_p95_mw)} MW` },
    { label: "Median miss", value: num(s.abs_p50_mw), unit: "MW" },
    { label: "Forecast too high", value: num(s.over_forecast_pct), unit: "% of half-hours", note: "The risky direction for a buyer" },
    { label: "Shortfall at P90", value: num(s.shortfall_p90_mw), unit: "MW", note: "Wind below forecast by this much or more, 1 time in 10" },
    { label: "MAPE", value: s.mape_pct == null ? "–" : num(s.mape_pct, 1), unit: "%", note: s.mape_excluded ? `Ignores ${s.mape_excluded} near-zero half-hours` : "All half-hours included" },
  ];

  return (
    <div role="tabpanel" id="panel-lab" aria-labelledby="tab-lab">
      <div className="page-head">
        <div>
          <h2>Accuracy lab</h2>
          <p>Every half-hour in the data, scored against what wind actually produced.</p>
        </div>
        <div style={{ display: "flex", gap: "1rem", alignItems: "end", flexWrap: "wrap" }}>
          <label className="field">
            <span>Decision time, UK</span>
            <select value={cutoff} onChange={(e) => setCutoff(e.target.value)}>
              {meta.cutoff_options.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <button className="btn btn--quiet" onClick={() => downloadCsv(`windward-metrics-cutoff-${cutoff.replace(":", "")}.csv`, metricsRows(data))}>
            Download metrics as CSV
          </button>
        </div>
      </div>

      <p className="headline">{accuracyHeadline(s, data.cutoff)}</p>
      <div className={loading ? "is-stale" : ""}>
        <Strip items={strip} className="strip--8" />

        <div className="lab-grid">
          <Figure className="span-2" title="Error grows with lead time"
            caption="Average and P90 miss for every forecast ever published, by how far ahead it was issued. The shaded window is what a trader at this decision time can actually use."
            label="Line chart of forecast error against lead time in hours.">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.by_horizon} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                {grid}
                <XAxis dataKey="mid" type="number" domain={[0, 48]} ticks={[0, 6, 12, 18, 24, 30, 36, 42, 48]} tickFormatter={(v) => `${v} h`} {...axis} />
                <YAxis {...yAxis} tickFormatter={(v) => `${(v / 1000).toFixed(1)} GW`} />
                {dh && <ReferenceArea x1={dh.min} x2={dh.max} fill={C.forecast} fillOpacity={0.09} stroke="none" />}
                {tip((d) => `${d.from} to ${d.to} h ahead`, [["Average miss", (d) => `${num(d.mae_mw)} MW`], ["P90 miss", (d) => `${num(d.abs_p90_mw)} MW`], ["Bias", (d) => `${signed(d.bias_mw)} MW`]])}
                <Line dataKey="mae_mw" name="Average miss" stroke={C.forecast} strokeWidth={2.5} dot={false} isAnimationActive={false} />
                <Line dataKey="abs_p90_mw" name="P90 miss" stroke={C.risk} strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </Figure>

          <Figure title="Day by day" caption="Bars show bias (coral = forecast too high); the line is the average miss."
            label="Bar chart of daily forecast bias with a line for daily average miss.">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data.daily.map((d) => ({ ...d, label: dayLabel(d.date, { weekday: false }) }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                {grid}
                <XAxis dataKey="label" interval={4} {...axis} />
                <YAxis {...yAxis} tickFormatter={(v) => `${(v / 1000).toFixed(1)}k`} />
                <ReferenceLine y={0} stroke={C.text} strokeOpacity={0.5} />
                {tip((d) => dayLabel(d.date), [["Average miss", (d) => `${num(d.mae_mw)} MW`], ["Bias", (d) => `${signed(d.bias_mw)} MW`], ["Mean actual", (d) => `${num(d.mean_actual_mw)} MW`]])}
                <Bar dataKey="bias_mw" isAnimationActive={false}>
                  {data.daily.map((d) => <Cell key={d.date} fill={d.bias_mw > 0 ? C.risk : C.actual} fillOpacity={0.8} />)}
                </Bar>
                <Line dataKey="mae_mw" stroke={C.forecast} strokeWidth={2} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </Figure>

          <Figure title="Time of day" caption="Average miss for each hour of the delivery day."
            label="Bar chart of average forecast miss by hour of day.">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.by_hour} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                {grid}
                <XAxis dataKey="hour" interval={2} tickFormatter={(h) => `${String(h).padStart(2, "0")}:00`} {...axis} />
                <YAxis {...yAxis} tickFormatter={(v) => `${(v / 1000).toFixed(1)}k`} />
                {tip((d) => `${String(d.hour).padStart(2, "0")}:00 to ${String(d.hour).padStart(2, "0")}:59`, [["Average miss", (d) => `${num(d.mae_mw)} MW`], ["Bias", (d) => `${signed(d.bias_mw)} MW`]])}
                <Bar dataKey="mae_mw" fill={C.forecast} fillOpacity={0.85} radius={[3, 3, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </Figure>

          <Figure title="How big are the misses?" caption="Forecast minus actual, in 250 MW steps. Coral is the shortfall side."
            label="Histogram of forecast errors.">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.distribution.bins} barCategoryGap={1} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                {grid}
                <XAxis dataKey="mid" interval={3} tickFormatter={(v) => `${(v / 1000).toFixed(1)}k`} {...axis} />
                <YAxis {...yAxis} width={40} />
                {tip((d) => `${signed(d.from)} to ${signed(d.to)} MW`, [["Half-hours", (d) => num(d.count)]])}
                <Bar dataKey="count" isAnimationActive={false}>
                  {data.distribution.bins.map((b) => <Cell key={b.from} fill={b.mid > 0 ? C.risk : C.actual} fillOpacity={0.8} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Figure>

          <Figure title="Forecast against actual" caption="Each dot is one half-hour. Dots on the line were forecast exactly."
            label="Scatter plot of forecast against actual wind generation.">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                {grid}
                <XAxis dataKey="a" type="number" domain={[0, maxAxis]} name="Actual" tickFormatter={(v) => `${v / 1000}`} {...axis} />
                <YAxis dataKey="f" type="number" domain={[0, maxAxis]} name="Forecast" {...yAxis} width={40} tickFormatter={(v) => `${v / 1000}`} />
                <ReferenceLine segment={[{ x: 0, y: 0 }, { x: maxAxis, y: maxAxis }]} stroke={C.actual} strokeDasharray="5 4" />
                {tip(() => "One half-hour", [["Forecast", (d) => `${num(d.f)} MW`], ["Actual", (d) => `${num(d.a)} MW`]])}
                <Scatter data={scatter} fill={C.forecast} fillOpacity={0.35} isAnimationActive={false} />
              </ScatterChart>
            </ResponsiveContainer>
          </Figure>

          <Panel className="span-2 figure" title="Does the error depend on how windy it is?" sub="Grouped by actual generation. Error is usually larger when more wind is blowing.">
            <div className="table-wrap" style={{ maxHeight: "none" }}>
              <table className="data">
                <thead><tr><th>Actual output</th><th>Half-hours</th><th>Average miss, MW</th><th>As % of output</th><th>Bias, MW</th><th>P90 miss, MW</th></tr></thead>
                <tbody>
                  {data.by_level.map((r) => (
                    <tr key={r.label}>
                      <td>{r.label}</td><td>{num(r.n)}</td><td>{num(r.mae_mw)}</td><td>{num(r.nmae_pct, 1)}%</td>
                      <td className={r.bias_mw > 0 ? "over" : "under"}>{signed(r.bias_mw)}</td><td>{num(r.abs_p90_mw)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
