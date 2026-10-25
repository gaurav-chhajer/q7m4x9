import { useEffect, useMemo } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useApi } from "../lib/api.js";
import { addDays, dateTime, dayLabel, downloadCsv, gwh, hhmm, num, signed } from "../lib/format.js";
import { decisionRows } from "../lib/insight.js";
import { C } from "../lib/theme.js";
import { Loading, Notice, Panel, Segmented, Strip } from "./ui.jsx";

function DeskTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="tip">
      <strong>{d.t}</strong>
      <div className="row"><span>Forecast</span><span>{num(d.forecast)} MW</span></div>
      {d.lower != null && <div className="row"><span>Band</span><span>{num(d.lower)} to {num(d.upper)} MW</span></div>}
      {d.actual != null && <div className="row"><span>Actual</span><span>{num(d.actual)} MW</span></div>}
      {d.error != null && <div className="row"><span>Forecast minus actual</span><span>{signed(d.error)} MW</span></div>}
      <div className="row"><span>Issued</span><span>{dateTime(d.issued)}, {num(d.lead_h, 1)} h ahead</span></div>
    </div>
  );
}

function Worksheet({ s, settings, setSettings }) {
  const pct = Math.round(settings.confidence * 100);
  const h = s.history, bt = s.backtest;
  return (
    <Panel title="Procurement worksheet" sub="What to count on, and what to hold back.">
      <Segmented legend="Risk level" name="risk" value={settings.confidence} onChange={(v) => setSettings({ confidence: v })}
        options={[{ value: 0.8, label: "P80" }, { value: 0.9, label: "P90" }, { value: 0.95, label: "P95" }]} />
      <p className="ws__big">{num(s.buffer_mw)}<small>MW buffer</small></p>
      <p className="ws__hint">
        This buffer uses the empirical P{pct} shortfall from past errors. Its target exceedance rate is {100 - pct}%, not a guarantee for the next day.
        The band starts at P{100 - pct} to P{pct} of past errors, then widens if needed to include the forecast and clips its lower edge at zero.
      </p>
      <dl className="ws__rows">
        <div><dt>Forecast wind</dt><dd>{num(s.avg_forecast_mw)} MW avg, {gwh(s.energy_mwh)} GWh</dd></div>
        <div><dt>Wind to rely on</dt><dd>{num(s.avg_firm_mw)} MW avg, {gwh(s.firm_energy_mwh)} GWh</dd></div>
      </dl>
      <label className="field">
        <span>Illustrative national demand in MW, flat all day (optional)</span>
        <input type="number" inputMode="numeric" min="0" step="100" placeholder="For example 20000"
          value={settings.demand} onChange={(e) => setSettings({ demand: e.target.value })} />
      </label>
      <p className="ws__foot">This illustration subtracts national wind from national demand. A utility must first establish its contracted or allocated wind share; national output is not its own supply.</p>
      {s.demand && (
        <dl className="ws__rows">
          <div><dt>Buy from other sources</dt><dd>{gwh(s.demand.procure_mwh)} GWh, {num(s.demand.avg_procure_mw)} MW avg</dd></div>
          <div><dt>With the wind buffer</dt><dd>{gwh(s.demand.procure_safe_mwh)} GWh, {num(s.demand.avg_procure_safe_mw)} MW avg</dd></div>
          <div><dt>Extra for wind risk</dt><dd>{gwh(s.demand.extra_for_risk_mwh)} GWh</dd></div>
        </dl>
      )}
      {bt && (
        <Notice tone="info" title="Retrospective evaluation across the full data window">
          Rebuilding the band each day from only past errors, actual wind fell below it in {num(bt.below_band_pct, 1)}% of half-hours
          (the aim is {num(bt.target_pct, 0)}%) and above it in {num(bt.above_band_pct, 1)}%, across {bt.days} days.
          This evaluation includes outcomes after the selected decision date; it was not available at that decision time.
          A big gap from the aim means the buffer is a rough guide only.
        </Notice>
      )}
      <p className="ws__foot">Learned from {num(h.half_hours)} past half-hours across {h.days} days, all known before the decision time.</p>
    </Panel>
  );
}

function NoBand({ s }) {
  const h = s.history;
  return (
    <Panel title="Procurement worksheet" sub="What to count on, and what to hold back.">
      <Notice tone="warn" title="Not enough history yet">
        A buffer needs {h.required_days} days of past forecast errors that were already known at the decision time. This day has {h.days}.
        {h.first_band_date ? ` The first day with enough is ${dayLabel(h.first_band_date, { year: true })}.` : ""} The forecast itself is still shown.
      </Notice>
    </Panel>
  );
}

export default function DecisionDesk({ meta, date, setDate, settings, setSettings, onWind }) {
  const demand = Number(settings.demand) > 0 ? Number(settings.demand) : null;
  const { data, error, loading } = useApi("/decision",
    { date, cutoff: settings.cutoff, confidence: settings.confidence, demand_mw: demand }, !!date);
  const s = data?.summary;

  useEffect(() => {
    if (s?.avg_forecast_mw != null) onWind(s.avg_forecast_mw / meta.capacity_hint_mw);
  }, [s?.avg_forecast_mw, meta.capacity_hint_mw]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => (data?.slots ?? []).map((x) => ({
    ...x, t: hhmm(x.time), base: x.lower, size: x.lower != null ? x.upper - x.lower : null,
  })), [data]);

  const pct = Math.round(settings.confidence * 100);
  const prev = addDays(date, -1);
  let strip = null;
  if (s?.avg_forecast_mw != null) {
    const d1 = s.issued_first.slice(0, 10), d2 = s.issued_last.slice(0, 10);
    strip = [
      { label: "Expected wind", value: num(s.avg_forecast_mw), unit: "MW avg", note: `${gwh(s.energy_mwh)} GWh over the day`, key: true },
      { label: "Forecast issued",
        value: s.issued_first === s.issued_last ? hhmm(s.issued_last) : `${hhmm(s.issued_first)} to ${hhmm(s.issued_last)}`,
        note: `${d1 === d2 ? dayLabel(d2) : `${dayLabel(d1)} to ${dayLabel(d2)}`}, ${num(s.lead_h_min)} to ${num(s.lead_h_max)} h before delivery` },
      s.band_available
        ? { label: "Suggested buffer", value: num(s.buffer_mw), unit: "MW", note: `Historical P${pct} shortfall; not guaranteed` }
        : { label: "Suggested buffer", value: "Not yet", note: `Needs ${s.history.required_days} days of past errors` },
      s.band_available
        ? { label: "Wind to rely on", value: num(s.avg_firm_mw), unit: "MW avg", note: "Forecast minus buffer" }
        : { label: "Wind to rely on", value: "Not yet", note: "Needs the buffer" },
      { label: "Peak", value: num(s.peak.mw), unit: "MW", note: `At ${hhmm(s.peak.time)}. Low of ${num(s.trough.mw)} MW at ${hhmm(s.trough.time)}` },
    ];
  }

  return (
    <div role="tabpanel" id="panel-desk" aria-labelledby="tab-desk">
      <div className="page-head">
        <div>
          <h2>Decision desk</h2>
          <p>The forecast you actually had when you bought, and how much room to leave for it being wrong.</p>
        </div>
        <button className="btn btn--quiet" disabled={!data} onClick={() => downloadCsv(`windward-forecast-${date}-cutoff-${settings.cutoff.replace(":", "")}.csv`, decisionRows(data))}>
          Download this day as CSV
        </button>
      </div>

      <div className="controls">
        <div className="daynav">
          <button className="btn btn--quiet" aria-label="Previous day" disabled={date <= meta.delivery_start} onClick={() => setDate(addDays(date, -1))}>Previous</button>
          <div className="daynav__label">
            <span className="daynav__title">{dayLabel(date, { year: true })}</span>
            <span className="daynav__sub">Delivery day, bought at {settings.cutoff} on {dayLabel(prev)}</span>
          </div>
          <button className="btn btn--quiet" aria-label="Next day" disabled={date >= meta.delivery_end} onClick={() => setDate(addDays(date, 1))}>Next</button>
        </div>
        <label className="field">
          <span>Jump to a day</span>
          <input type="date" min={meta.delivery_start} max={meta.delivery_end} value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
        <label className="field">
          <span>Decision time, UK</span>
          <select value={settings.cutoff} onChange={(e) => setSettings({ cutoff: e.target.value })}>
            {meta.cutoff_options.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
      </div>

      {error && <Notice tone="error" title="Couldn't load this day">{error.message}</Notice>}
      {!data && !error && <Loading label="Loading the forecast" />}

      {data && (
        <div className={loading ? "is-stale" : ""}>
          {strip ? <Strip items={strip} /> : <Notice tone="warn" title="No forecast before the decision time">None of the forecasts for this day were published before {settings.cutoff}, so there is nothing to plan on.</Notice>}
          {s.missing_forecast_slots > 0 && s.slots_with_forecast > 0 && (
            <Notice tone="warn" title={`${s.missing_forecast_slots} half-hours have no forecast`}>They show as gaps in the chart and are left out of the totals.</Notice>
          )}

          <div className="desk">
            <div>
              <Panel title="Wind generation across the day" sub={s.band_available ? "Half-hourly, UK time. Plan on the lower edge of the shaded band." : "Half-hourly, UK time."}>
                <div className="chart-box" role="img" aria-label="Line chart of forecast and actual wind generation, 48 half-hours.">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={rows} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}>
                      <CartesianGrid stroke={C.grid} strokeDasharray="3 4" vertical={false} />
                      <XAxis dataKey="t" interval={3} tick={{ fill: C.text, fontSize: 12 }} tickLine={false} axisLine={{ stroke: C.grid }} />
                      <YAxis tick={{ fill: C.text, fontSize: 12 }} tickLine={false} axisLine={false} width={52}
                        tickFormatter={(v) => `${(v / 1000).toFixed(0)} GW`} domain={[0, (max) => Math.ceil(max / 2000) * 2000]} />
                      <Tooltip content={<DeskTip />} cursor={{ stroke: C.text, strokeOpacity: 0.4 }} />
                      <Area dataKey="base" stackId="band" stroke="none" fill="transparent" isAnimationActive={false} activeDot={false} />
                      <Area dataKey="size" stackId="band" stroke="none" fill={C.forecast} fillOpacity={0.18} isAnimationActive={false} activeDot={false} />
                      <Line dataKey="forecast" stroke={C.forecast} strokeWidth={2.5} dot={false} isAnimationActive={false} />
                      <Line dataKey="actual" stroke={C.actual} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <ul className="legend">
                  <li><i className="swatch swatch--forecast" />Forecast at {settings.cutoff}</li>
                  {s.band_available && <li><i className="swatch swatch--band" />P{100 - pct} to P{pct} range of past errors (about {2 * pct - 100}% of outcomes)</li>}
                  <li><i className="swatch swatch--actual" />Actual (once known)</li>
                </ul>
              </Panel>

              {s.realised && (
                <Notice tone="info" title="Hindsight check">
                  Actual wind came in {num(Math.abs(s.realised.bias_mw))} MW {s.realised.bias_mw > 0 ? "below" : "above"} the forecast on average, with an average miss of {num(s.realised.mae_mw)} MW.
                  {s.realised.within_band_pct != null ? ` It stayed inside the band for ${num(s.realised.within_band_pct)}% of half-hours.` : ""}
                </Notice>
              )}

              <details className="detail">
                <summary>Half-hourly detail</summary>
                <div className="table-wrap">
                  <table className="data">
                    <thead><tr>
                      <th>Time</th><th>Forecast</th><th>Band low</th><th>Band high</th><th>Actual</th><th>Forecast minus actual</th><th>Issued</th><th>Lead, h</th>
                    </tr></thead>
                    <tbody>
                      {data.slots.map((x) => (
                        <tr key={x.time}>
                          <td>{hhmm(x.time)}</td><td>{num(x.forecast)}</td><td>{num(x.lower)}</td><td>{num(x.upper)}</td>
                          <td>{num(x.actual)}</td>
                          <td className={x.error > 0 ? "over" : x.error < 0 ? "under" : ""}>{signed(x.error)}</td>
                          <td>{dateTime(x.issued)}</td><td>{num(x.lead_h, 1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </div>

            {s.band_available ? <Worksheet s={s} settings={settings} setSettings={setSettings} /> : <NoBand s={s} />}
          </div>
        </div>
      )}
    </div>
  );
}
