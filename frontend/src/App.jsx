import { useEffect, useRef, useState } from "react";
import AccuracyLab from "./components/AccuracyLab.jsx";
import DecisionDesk from "./components/DecisionDesk.jsx";
import FlowField from "./components/FlowField.jsx";
import Intro from "./components/Intro.jsx";
import Method from "./components/Method.jsx";
import { Brand, Loading, Notice } from "./components/ui.jsx";
import { useApi } from "./lib/api.js";
import { useMedia, useSettings } from "./lib/hooks.js";

const TABS = [["desk", "Decision desk"], ["lab", "Accuracy lab"], ["method", "Method"]];

export default function App() {
  const meta = useApi("/meta");
  const m = meta.data;
  const [settings, setSettings] = useSettings();
  const [date, setDate] = useState(null);
  const [tab, setTab] = useState("desk");
  const [wind, setWind] = useState(0.45);
  const deskRef = useRef(null);
  const reduced = useMedia("(prefers-reduced-motion: reduce)");

  useEffect(() => { if (m && !date) setDate(m.default_date); }, [m]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {                       // a stored cutoff that this dataset doesn't offer falls back to the default
    if (m && !m.cutoff_options.includes(settings.cutoff)) setSettings({ cutoff: m.default_cutoff });
  }, [m]); // eslint-disable-line react-hooks/exhaustive-deps

  const acc = useApi("/accuracy", { cutoff: settings.cutoff }, !!m);
  const vint = useApi("/vintages", { target: m?.demo_target, cutoff: settings.cutoff }, !!m?.demo_target);

  const enter = () => deskRef.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });

  return (
    <>
      <FlowField wind={wind} />
      {m?.is_sample && <div className="sample-pill" role="status">Generated sample data, not real Elexon figures. Run the ingestion script to load the real snapshot.</div>}

      <Intro cutoff={settings.cutoff} vint={vint.data} acc={acc.data} isSample={!!m?.is_sample} onEnter={enter} reduced={reduced} />

      <main className="app" ref={deskRef} id="desk">
        <header className="topbar">
          <div className="topbar__inner">
            <Brand />
            <div className="tabs" role="tablist" aria-label="Sections">
              {TABS.map(([id, label]) => (
                <button key={id} role="tab" id={`tab-${id}`} aria-selected={tab === id} aria-controls={`panel-${id}`}
                        className="tab" onClick={() => setTab(id)}>{label}</button>
              ))}
            </div>
          </div>
        </header>

        <div className="shell">
          {meta.error && (
            <Notice tone="error" title="The data service isn't responding">
              {meta.error.message} If you're running locally, start the backend with <code>uvicorn app.main:app --port 8000</code> from the backend folder, or use <code>docker compose up</code>.
            </Notice>
          )}
          {!m && !meta.error && <Loading />}
          {m && tab === "desk" && date && (
            <DecisionDesk meta={m} date={date} setDate={setDate} settings={settings} setSettings={setSettings} onWind={setWind} />
          )}
          {m && tab === "lab" && (
            <AccuracyLab acc={acc} cutoff={settings.cutoff} setCutoff={(c) => setSettings({ cutoff: c })} meta={m} />
          )}
          {m && tab === "method" && <Method meta={m} />}
        </div>

        <footer className="footer">
          Wind data from Elexon BMRS (FUELHH and WINDFOR). All times are UK time; in January that equals UTC.
        </footer>
      </main>
    </>
  );
}
