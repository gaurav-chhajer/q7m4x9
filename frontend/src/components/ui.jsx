export function Brand() {
  return (
    <span className="brand">
      <svg viewBox="0 0 32 32" fill="none" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
        <path d="M3 11h14a4 4 0 1 0-4-4" stroke="#F2C14E" />
        <path d="M3 17h21a4 4 0 1 1-4 4" stroke="#5FD3B8" />
        <path d="M3 23h9" stroke="#E8F3F0" />
      </svg>
      Windward
    </span>
  );
}

export function Panel({ title, sub, actions, className = "", children }) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <div className="panel__head">
          <div>
            {title && <h3>{title}</h3>}
            {sub && <p className="panel__sub">{sub}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/** A ruled row of key figures. items: [{label, value, unit, note, key}] */
export function Strip({ items, className = "" }) {
  return (
    <dl className={`strip ${className}`}>
      {items.map((it) => (
        <div key={it.label} className={`strip__item${it.key ? " strip__item--key" : ""}`}>
          <dt>{it.label}</dt>
          <dd>
            <span className="strip__value">{it.value}</span>
            {it.unit && <span className="strip__unit">{it.unit}</span>}
          </dd>
          {it.note && <dd className="strip__note">{it.note}</dd>}
        </div>
      ))}
    </dl>
  );
}

export function Segmented({ legend, name, value, onChange, options }) {
  return (
    <fieldset className="seg">
      <legend>{legend}</legend>
      <div className="seg__row">
        {options.map((o) => (
          <label key={o.value} className="seg__opt">
            <input type="radio" name={name} checked={Number(o.value) === Number(value)} onChange={() => onChange(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function Notice({ tone = "info", title, children }) {
  return (
    <div className={`notice notice--${tone}`} role={tone === "error" ? "alert" : "note"}>
      {title && <strong>{title}</strong>}
      {children}
    </div>
  );
}

export function Loading({ label = "Loading data" }) {
  return <div className="state" role="status" aria-live="polite">{label}…</div>;
}
