// Pure formatting and maths helpers (unit-tested in test/format.test.js).
const nf0 = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
/** Progress of p through the range [a, b], clamped to 0..1. */
export const seg = (p, a, b) => clamp((p - a) / (b - a), 0, 1);
export const ease = (t) => 1 - Math.pow(1 - t, 3);

export const num = (v, digits = 0) =>
  v == null || Number.isNaN(v) ? "–" : (digits ? nf1 : nf0).format(v);
export const signed = (v) =>
  v == null || Number.isNaN(v) ? "–" : (v > 0 ? "+" : v < 0 ? "−" : "") + nf0.format(Math.abs(v));
export const gwh = (mwh) => (mwh == null ? "–" : nf1.format(mwh / 1000));
/** "2026-01-22T09:00:00Z" -> "09:00" (UTC, which equals UK time in January). */
export const hhmm = (iso) => (iso ? iso.slice(11, 16) : "–");

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-01-23" -> "Fri 23 Jan". Built by hand so it never depends on the browser's locale rules. */
export const dayLabel = (d, { year = false, weekday = true } = {}) => {
  const [y, m, day] = d.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
  return `${weekday ? `${WEEKDAYS[dow]} ` : ""}${day} ${MONTHS[m - 1]}${year ? ` ${y}` : ""}`;
};
/** "2026-01-22T09:00:00Z" -> "22 Jan 09:00": the date matters, since a forecast can be a day or more old. */
export const dateTime = (iso) => (iso ? `${dayLabel(iso.slice(0, 10), { weekday: false })} ${hhmm(iso)}` : "–");
export const addDays = (d, n) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

export function toCsv(rows) {
  const esc = (v) => {
    if (v == null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(esc).join(",")).join("\n");
}

export function downloadCsv(filename, rows) {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
