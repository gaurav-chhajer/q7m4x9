import { useEffect, useState } from "react";

const BASE = import.meta.env?.VITE_API_BASE ?? "";

export async function api(path, params, signal) {
  const qs = new URLSearchParams(
    Object.entries(params || {}).filter(([, v]) => v != null && v !== "")
  ).toString();
  let res;
  try {
    res = await fetch(`${BASE}/api${path}${qs ? `?${qs}` : ""}`, { signal });
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw new Error("Can't reach the Windward API. Check that the backend is running.");
  }
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json()).detail; } catch { /* body wasn't JSON */ }
    throw new Error(detail || `The API returned an error (${res.status}).`);
  }
  return res.json();
}

/** Fetches on mount and whenever path/params change. Keeps the previous data while reloading. */
export function useApi(path, params, enabled = true) {
  const [state, setState] = useState({ data: null, error: null, loading: enabled });
  const key = enabled ? path + JSON.stringify(params || {}) : "off";
  useEffect(() => {
    if (!enabled) return undefined;
    const ac = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    api(path, params, ac.signal)
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((error) => { if (error.name !== "AbortError") setState({ data: null, error, loading: false }); });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}
