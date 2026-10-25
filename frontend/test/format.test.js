import test from "node:test";
import assert from "node:assert/strict";
import { addDays, clamp, dateTime, dayLabel, ease, hhmm, num, seg, signed, toCsv } from "../src/lib/format.js";
import { accuracyHeadline, decisionRows, metricsRows } from "../src/lib/insight.js";

test("num formats with UK separators and handles missing values", () => {
  assert.equal(num(7420.4), "7,420");
  assert.equal(num(13.46, 1), "13.5");
  assert.equal(num(null), "–");
  assert.equal(num(NaN), "–");
});

test("signed uses a real minus sign and no plus for zero", () => {
  assert.equal(signed(120), "+120");
  assert.equal(signed(-120), "−120");
  assert.equal(signed(0), "0");
});

test("hhmm reads the time out of an ISO string", () => {
  assert.equal(hhmm("2026-01-22T09:00:00Z"), "09:00");
  assert.equal(hhmm(null), "–");
});

test("addDays crosses month boundaries", () => {
  assert.equal(addDays("2026-01-31", 1), "2026-02-01");
  assert.equal(addDays("2026-01-02", -1), "2026-01-01");
});

test("dayLabel never depends on locale punctuation", () => {
  assert.equal(dayLabel("2026-01-23"), "Fri 23 Jan");
  assert.equal(dayLabel("2026-02-01", { year: true }), "Sun 1 Feb 2026");
  assert.equal(dayLabel("2026-01-05", { weekday: false }), "5 Jan");
});

test("dateTime shows the real publication date, not just the time", () => {
  assert.equal(dateTime("2026-01-21T16:30:00Z"), "21 Jan 16:30");
  assert.equal(dateTime(null), "–");
});

test("seg and clamp keep progress within 0..1", () => {
  assert.equal(seg(0.5, 0.2, 0.4), 1);
  assert.equal(seg(0.1, 0.2, 0.4), 0);
  assert.ok(Math.abs(seg(0.3, 0.2, 0.4) - 0.5) < 1e-9);
  assert.equal(clamp(5, 0, 1), 1);
  assert.ok(ease(0.5) > 0.5);
});

test("toCsv escapes commas, quotes and newlines", () => {
  assert.equal(toCsv([["a", 'he said "hi"', "x,y", null]]), 'a,"he said ""hi""","x,y",');
});

test("accuracyHeadline states direction and size of the miss", () => {
  const s = { n: 10, bias_mw: 117, mae_mw: 761, nmae_pct: 13.4, abs_p90_mw: 1607 };
  const text = accuracyHeadline(s, "09:00");
  assert.match(text, /over-estimated by 117 MW/);
  assert.match(text, /761 MW/);
  assert.match(text, /13\.4%/);
  assert.match(accuracyHeadline({ ...s, bias_mw: -50 }, "09:00"), /under-estimated by 50 MW/);
  assert.equal(accuracyHeadline({ n: 0 }, "09:00"), "");
});

test("export rows have a header and one row per slot", () => {
  const d = { date: "2026-01-23", summary: { buffer_mw: 100 },
    slots: [{ time: "t1", forecast: 1, actual: 2, lower: 0, upper: 3, firm: 1, issued: "p", lead_h: 15, error: -1 }] };
  const rows = decisionRows(d);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].length, rows[1].length);
  const m = metricsRows({ cutoff: "09:00", summary: { n: 1 }, by_horizon: [], by_hour: [], daily: [] });
  assert.deepEqual(m[1], ["summary", "09:00", "n", 1]);
});
