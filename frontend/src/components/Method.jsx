import { dayLabel, num } from "../lib/format.js";
import { Panel } from "./ui.jsx";

export default function Method({ meta }) {
  const q = meta.quality;
  return (
    <div role="tabpanel" id="panel-method" aria-labelledby="tab-method">
      <div className="page-head">
        <div>
          <h2>Method</h2>
          <p>How every number on this site is made, so you can check it.</p>
        </div>
      </div>
      <div className="method">
        <Panel title="Which forecast counts">
          <p>A delivery day is bought the day before. For each half-hour we take the <strong>latest forecast published at or before the decision time on that earlier day</strong>. Anything published later is never used, so the results reflect what a trader really knew.</p>
          <p>The default decision time is {meta.default_cutoff} UK time. You can change it; every figure updates. In January UK time and UTC are the same, so there is no clock-change ambiguity.</p>
        </Panel>
        <Panel title="How a miss is measured">
          <p>Miss = forecast minus actual, per half-hour. A positive miss means the forecast was too high, which is the risky direction for a buyer.</p>
          <ul>
            <li><strong>Average miss (MAE)</strong>: the typical size of a miss, in MW.</li>
            <li><strong>RMSE</strong>: like MAE but punishes large misses harder.</li>
            <li><strong>Bias</strong>: the average signed miss. Positive means the forecast runs high.</li>
            <li><strong>MAPE</strong>: miss as a share of actual. Half-hours under 100 MW are skipped because the ratio blows up.</li>
          </ul>
        </Panel>
        <Panel title="The buffer and the band">
          <p>Two different things come from the same past errors. The <strong>buffer</strong> is one-sided: at P90 it is the shortfall that wind exceeded only 1 half-hour in 10. The <strong>band</strong> is two-sided: it runs from P10 to P90 of past errors around the forecast, so about 80% of outcomes should land inside it and 10% on each side.</p>
          <p>A day's band uses only delivery days up to two days earlier, because the previous day is still unfinished when you buy. With fewer than {meta.min_history_days} such days there is <strong>no band and no buffer</strong>; the forecast is still shown. Nothing from later days is ever used.</p>
          <p>The errors are pooled across hours and wind levels, so the band is a rough guide. The worksheet reports a walk-forward back-test of how often actual wind really fell outside the band.</p>
        </Panel>
        <Panel title="Data">
          <ul>
            <li><strong>Actual wind:</strong> Elexon BMRS FUELHH, fuel type WIND, half-hourly.</li>
            <li><strong>Forecasts:</strong> Elexon BMRS WINDFOR, only forecasts issued up to {meta.max_horizon_h} hours before their half-hour.</li>
            {q.forecast_resolution_min === 60 && (
              <li><strong>Resolution:</strong> the forecasts are hourly while actuals are half-hourly, so each forecast is applied to both half-hours of its hour. This is an assumption about how an hourly value maps onto half-hours.</li>
            )}
            {meta.snapshot?.issue_times?.length > 0 && (
              <li><strong>Issue times:</strong> forecasts in the snapshot appear at {meta.snapshot.issue_times.join(", ")} UTC, so the forecast you hold at your decision time can be several hours old.</li>
            )}
            <li><strong>Delivery days:</strong> {dayLabel(meta.delivery_start, { year: true })} to {dayLabel(meta.delivery_end, { year: true })}. Purchases made on each day of January cover the next day.</li>
            <li><strong>Coverage:</strong> {num(q.actual_slots)} of {num(q.expected_slots)} half-hours have an actual; {num(q.targets_with_forecast)} have a forecast. Gaps are skipped and never filled in.</li>
            <li><strong>Snapshot:</strong> {meta.is_sample ? "generated sample data, not Elexon figures" : `fetched ${meta.snapshot?.generated_at?.slice(0, 10) ?? "earlier"} and served as a static file`}.</li>
          </ul>
        </Panel>
        <Panel className="span-2" title="What this can't tell you">
          <ul>
            <li>One month is a small sample. The band describes January's conditions, not every season.</li>
            <li>The band is pooled across the day. It does not yet widen for windier hours, and the table in the accuracy lab shows errors do grow with output.</li>
            <li>Wind curtailment and embedded wind are not modelled; the actuals are Elexon's national wind outturn.</li>
            <li>The procurement worksheet assumes flat demand. It is a planning aid, not a trading signal.</li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}
