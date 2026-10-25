import { useRef } from "react";
import { dayLabel, ease, gwh, hhmm, num, seg } from "../lib/format.js";
import { useMedia, useScrollProgress } from "../lib/hooks.js";
import { Brand } from "./ui.jsx";

/**
 * Scroll story. One real half-hour, followed through the day-ahead decision:
 * every forecast published for it -> the decision time -> the last usable forecast -> what actually happened.
 * Scroll position drives the drawing; text changes at four stages. Skippable, and static when
 * the visitor prefers reduced motion.
 */
function copy(stage, { cutoff, chosen, acc }) {
  const s = acc?.summary;
  if (stage === 0) return ["Tomorrow's wind isn't known yet.",
    "Forecasts are revised throughout the day. Each dot is one publication, all for the same half-hour of delivery."];
  if (stage === 1) return [`You decide at ${cutoff}.`,
    "Forecasts published after that haven't happened yet. They tend to be better, but you can't use them."];
  if (stage === 2) return ["One forecast matters: the last one before you decide.",
    chosen ? `Issued at ${hhmm(chosen.publish)}, it said ${num(chosen.generation)} MW. Your purchase rests on that number.`
           : "That is the number your purchase rests on."];
  return ["So how wrong is it?",
    s?.n ? `Across every delivery day in the data, the ${cutoff} forecast misses by ${num(s.mae_mw)} MW on average, ${num(s.nmae_pct, 1)}% of what wind produces. The desk shows tomorrow's forecast, its error band, and how much to hold back.`
         : "The desk shows tomorrow's forecast, its error band, and how much to hold back."];
}

function Scene({ p, vint, narrow }) {
  const W = narrow ? 520 : 1000, H = narrow ? 440 : 400;
  const L = narrow ? 48 : 64, R = 22, T = 30, B = 56;
  const vs = vint.vintages;
  const vals = vs.map((v) => v.generation);
  if (vint.actual != null) vals.push(vint.actual);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.2 || 500, y0 = lo - pad, y1 = hi + pad;
  const x = (h) => L + (1 - h / 48) * (W - L - R);
  const y = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);

  const shown = Math.round(vs.length * ease(seg(p, 0.02, 0.22)));
  const cutP = ease(seg(p, 0.26, 0.4)), lateP = seg(p, 0.34, 0.46);
  const ringP = ease(seg(p, 0.5, 0.62)), actP = ease(seg(p, 0.72, 0.86)), missP = seg(p, 0.86, 0.96);
  const cx = x(vint.cutoff_horizon_h), base = H - T - B;
  const chosen = vs.find((v) => v.publish === vint.chosen_publish);
  const cutLabel = hhmm(vint.cutoff_at);
  const yticks = [0, 1, 2, 3].map((i) => lo + ((hi - lo) * i) / 3);
  const xticks = narrow ? [48, 24, 0] : [48, 36, 24, 12, 0];

  const chosenX = chosen && x(chosen.horizon_h), chosenY = chosen && y(chosen.generation);
  const labelBelow = chosen && chosenY < T + 70;
  const missX = W - R - 14;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMax meet" role="img" className={narrow ? "scene--narrow" : ""}
         aria-label="Chart of every wind forecast published for one half-hour, the decision time, the last usable forecast and the actual outcome.">
      {yticks.map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="sc-grid" />
          <text x={L - 8} y={y(v) + 4} textAnchor="end" className="sc-tick">{(v / 1000).toFixed(1)} GW</text>
        </g>
      ))}
      <line x1={L} x2={W - R} y1={H - B} y2={H - B} className="sc-axis" />
      {xticks.map((h) => (
        <text key={h} x={x(h)} y={H - B + 24} textAnchor={h === 0 ? "end" : h === 48 ? "start" : "middle"} className="sc-tick">
          {h === 0 ? "delivery" : `${h} h before`}
        </text>
      ))}

      <rect x={cx} y={T} width={Math.max(0, W - R - cx)} height={base} className="sc-late" opacity={0.55 * cutP} />
      <text x={(cx + W - R) / 2} y={T + 20} textAnchor="middle" className="sc-txt" opacity={lateP}>Published after you decide</text>

      <polyline className="sc-link" points={vs.slice(0, shown).map((v) => `${x(v.horizon_h)},${y(v.generation)}`).join(" ")} />
      {vs.slice(0, shown).map((v) => (
        <circle key={v.publish} cx={x(v.horizon_h)} cy={y(v.generation)} r={narrow ? 4 : 4.5} className="sc-dot"
                opacity={v.horizon_h < vint.cutoff_horizon_h ? 1 - 0.8 * lateP : 1} />
      ))}

      <line x1={cx} x2={cx} y1={H - B} y2={H - B - cutP * base} className="sc-cut" />
      {cutP > 0.9 && (
        <text x={cx - 8} y={T + 20} textAnchor="end" className="sc-txt">{narrow ? `Decide ${cutLabel}` : `Decision time, ${cutLabel}`}</text>
      )}

      {chosen && ringP > 0 && (
        <g opacity={ringP}>
          <circle cx={chosenX} cy={chosenY} r={5 + 11 * ringP} className="sc-ring" />
          <circle cx={chosenX} cy={chosenY} r={7} className="sc-dot" />
          {ringP > 0.85 && (
            <text x={chosenX - 16} y={labelBelow ? chosenY + 34 : chosenY - 20} textAnchor="end" className="sc-txt sc-txt--amber">
              {narrow ? `${num(chosen.generation)} MW` : `Last usable forecast: ${num(chosen.generation)} MW`}
            </text>
          )}
        </g>
      )}

      {vint.actual != null && actP > 0 && (
        <g>
          <line x1={L} x2={L + actP * (W - L - R)} y1={y(vint.actual)} y2={y(vint.actual)} className="sc-actual" />
          {actP > 0.9 && (
            <text x={L + 8} y={y(vint.actual) - 10} className="sc-txt sc-txt--actual">
              {narrow ? `Actual ${num(vint.actual)} MW` : `What actually happened: ${num(vint.actual)} MW`}
            </text>
          )}
        </g>
      )}

      {chosen && vint.actual != null && missP > 0 && (
        <g opacity={missP}>
          <line x1={missX} x2={missX} y1={chosenY} y2={y(vint.actual)} className="sc-miss" />
          <line x1={missX - 6} x2={missX + 6} y1={chosenY} y2={chosenY} className="sc-miss" />
          <line x1={missX - 6} x2={missX + 6} y1={y(vint.actual)} y2={y(vint.actual)} className="sc-miss" />
          <text x={missX - 12} y={(chosenY + y(vint.actual)) / 2 + 5} textAnchor="end" className="sc-txt sc-txt--risk">
            Miss: {num(Math.abs(chosen.generation - vint.actual))} MW
          </text>
        </g>
      )}
    </svg>
  );
}

export default function Intro({ cutoff, vint, acc, isSample, onEnter, reduced }) {
  const ref = useRef(null);
  const narrow = useMedia("(max-width: 640px)");
  const scrolled = useScrollProgress(ref, reduced);
  const p = reduced ? 1 : scrolled;
  const stage = p < 0.24 ? 0 : p < 0.54 ? 1 : p < 0.78 ? 2 : 3;
  const chosen = vint?.vintages.find((v) => v.publish === vint.chosen_publish);

  return (
    <section ref={ref} className={`intro${reduced ? " intro--static" : ""}`} aria-label="How the day-ahead forecast is chosen">
      <div className="intro__sticky">
        <header className="intro__bar">
          <Brand />
          <button className="skip" onClick={onEnter}>Skip to the desk</button>
        </header>

        <div className="intro__text" aria-live="polite">
          {[0, 1, 2, 3].map((index) => {
            const [heading, body] = copy(index, { cutoff, chosen, acc });
            const active = index === stage;
            return (
              <div key={index} className={`intro__step${active ? " intro__step--active" : ""}`}
                   aria-hidden={!active} inert={active ? undefined : ""}>
                <h1>{heading}</h1>
                <p>{body}</p>
                {index === 0 && !reduced && <span className="hint">Scroll to follow one forecast</span>}
                {index === 3 && <button className="btn" tabIndex={active ? 0 : -1} onClick={onEnter}>Open the desk</button>}
              </div>
            );
          })}
        </div>

        <div className="intro__scene">{vint && <Scene p={p} vint={vint} narrow={narrow} />}</div>
        {vint && (
          <p className="intro__foot">
            Each dot is {isSample ? "a generated sample" : "a real"} forecast for {hhmm(vint.target)} on {dayLabel(vint.target.slice(0, 10))}.
          </p>
        )}
        {!reduced && <div className="progress" aria-hidden="true"><span style={{ transform: `scaleY(${p})` }} /></div>}
      </div>
    </section>
  );
}
