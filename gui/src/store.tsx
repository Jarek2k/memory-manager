import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { fetchInventory, fetchStatus, postClose, postDecisions } from "./api";
import type { SessionStatus } from "./api";
import type { CartItem, Entry, Inventory } from "./types";

export type FacetState = Record<string, "include" | "exclude">;
export type SortKey = "age" | "size" | "project" | "type" | "name";
export interface Filters { q: string; sort: SortKey; type: FacetState; signal: FacetState; project: FacetState; cluster: FacetState; }
export type FacetGroup = "type" | "signal" | "project" | "cluster";

const emptyFilters = (): Filters => ({ q: "", sort: "project", type: {}, signal: {}, project: {}, cluster: {} });

export const SIGNALS = [
  { key: "enforceable", label: "sollte erzwungen werden", icon: "scale" },
  { key: "split", label: "zu lang / Log-Ballast", icon: "scissors" },
  { key: "unicode", label: "Sicherheitsprüfung", icon: "alert" },
  { key: "dangling", label: "verwaiste Verweise", icon: "unlink" },
  { key: "stale", label: "alt", icon: "clock" },
  { key: "global", label: "Global-Kandidat", icon: "globe" },
  { key: "none", label: "keine Signale", icon: "circle" },
] as const;

export function signalHas(e: Entry, key: string): boolean {
  switch (key) {
    case "enforceable": return e.enforceable_candidate;
    case "split": return e.split_candidate;
    case "unicode": return e.unicode_flags.length > 0;
    case "dangling": return e.has_dangling_links;
    case "stale": return e.stale;
    case "global": return e.global_candidate;
    case "none": return !(e.enforceable_candidate || e.split_candidate || e.unicode_flags.length > 0 || e.has_dangling_links || e.stale || e.global_candidate);
    default: return false;
  }
}

interface Store {
  inv: Inventory | null;
  loading: boolean;
  error: string | null;
  view: string;
  setView: (v: string) => void;
  selectedProject: string | null;
  openProject: (slug: string) => void;
  filters: Filters;
  setQ: (q: string) => void;
  setSort: (s: SortKey) => void;
  cycleFacet: (group: FacetGroup, value: string) => void;
  clearFilters: () => void;
  filterEntries: (entries: Entry[]) => Entry[];
  cart: Map<string, CartItem>;
  cartList: CartItem[];
  cartSet: (item: CartItem) => void;
  cartRemove: (key: string) => void;
  clearCart: () => void;
  entryItem: (id: string) => CartItem | undefined;
  submitState: "idle" | "sending" | "sent" | "error";
  submitMsg: string;
  submit: (items?: CartItem[]) => Promise<void>;
  session: SessionStatus | null;
  continueCuration: () => Promise<void>;
  finishSession: () => Promise<void>;
}

const Ctx = createContext<Store | null>(null);
export const useStore = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error("no store");
  return s;
};

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [inv, setInv] = useState<Inventory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState("graph");
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(emptyFilters());
  const [cart, setCart] = useState<Map<string, CartItem>>(new Map());
  const [submitState, setSubmitState] = useState<Store["submitState"]>("idle");
  const [submitMsg, setSubmitMsg] = useState("");
  const [session, setSession] = useState<SessionStatus | null>(null);
  const [awaiting, setAwaiting] = useState(false);

  useEffect(() => {
    fetchInventory().then((i) => { setInv(i); setLoading(false); })
      .catch((e) => { setError(String(e.message || e)); setLoading(false); });
  }, []);

  // Poll the terminal's live status only while a submission is in flight. Stops
  // once the cycle finishes (done) or the server is shutting down.
  useEffect(() => {
    if (!awaiting) return;
    let alive = true;
    const tick = async () => {
      try {
        const st = await fetchStatus();
        if (!alive) return;
        setSession(st);
        if (st.phase === "done" || st.server === "closing") setAwaiting(false);
      } catch { /* transient — keep polling */ }
    };
    tick();
    const id = setInterval(tick, 1200);
    return () => { alive = false; clearInterval(id); };
  }, [awaiting]);

  const openProject = useCallback((slug: string) => { setSelectedProject(slug); setView("project"); }, []);
  const setQ = useCallback((q: string) => setFilters((f) => ({ ...f, q })), []);
  const setSort = useCallback((sort: SortKey) => setFilters((f) => ({ ...f, sort })), []);
  const clearFilters = useCallback(() => setFilters(emptyFilters()), []);

  const cycleFacet = useCallback((group: FacetGroup, value: string) => {
    setFilters((f) => {
      const cur = { ...f[group] };
      const st = cur[value];
      if (!st) cur[value] = "include";
      else if (st === "include") cur[value] = "exclude";
      else delete cur[value];
      return { ...f, [group]: cur };
    });
  }, []);

  const filterEntries = useCallback((entries: Entry[]): Entry[] => {
    const f = filters;
    const q = f.q.trim().toLowerCase();
    const matchGroup = (state: FacetState, test: (val: string) => boolean): boolean => {
      const inc = Object.entries(state).filter(([, s]) => s === "include").map(([v]) => v);
      const exc = Object.entries(state).filter(([, s]) => s === "exclude").map(([v]) => v);
      if (exc.some((v) => test(v))) return false;
      if (inc.length && !inc.some((v) => test(v))) return false;
      return true;
    };
    let out = entries.filter((e) => {
      if (q) {
        const hay = (e.name + " " + e.description + " " + e.why + " " + e.how + " " + e.filename).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (!matchGroup(f.type, (v) => e.type === v)) return false;
      if (!matchGroup(f.signal, (v) => signalHas(e, v))) return false;
      if (!matchGroup(f.project, (v) => e.project_slug === v)) return false;
      if (!matchGroup(f.cluster, (v) => e.cluster_hint_ids.includes(v))) return false;
      return true;
    });
    const cmp: Record<SortKey, (a: Entry, b: Entry) => number> = {
      age: (a, b) => b.age_days - a.age_days,
      size: (a, b) => b.lines - a.lines,
      project: (a, b) => a.project_slug.localeCompare(b.project_slug) || a.name.localeCompare(b.name),
      type: (a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name),
      name: (a, b) => a.name.localeCompare(b.name),
    };
    return [...out].sort(cmp[f.sort]);
  }, [filters]);

  const cartSet = useCallback((item: CartItem) => setCart((c) => new Map(c).set(item.key, item)), []);
  const cartRemove = useCallback((key: string) => setCart((c) => { const n = new Map(c); n.delete(key); return n; }), []);
  const clearCart = useCallback(() => setCart(new Map()), []);
  const entryItem = useCallback((id: string) => cart.get(id), [cart]);
  const cartList = useMemo(() => Array.from(cart.values()), [cart]);

  const submit = useCallback(async (items?: CartItem[]) => {
    const toSend = items ?? cartList;
    setSubmitState("sending");
    try {
      const n = await postDecisions(toSend);
      setSubmitState("sent");
      setSubmitMsg(`${n} Änderung(en) freigegeben — Claude übernimmt im Terminal.`);
      // submitted items leave the cart; skipped ones stay for a later cycle
      setCart((c) => { const nc = new Map(c); for (const it of toSend) nc.delete(it.key); return nc; });
      setSession({ phase: "submitted", message: "Freigabe gesendet — Claude übernimmt …", server: "running", result: null });
      setAwaiting(true);
    } catch (e: any) {
      setSubmitState("error");
      setSubmitMsg("Senden fehlgeschlagen: " + (e.message || e));
    }
  }, [cartList]);

  const reload = useCallback(async () => {
    setLoading(true); setError(null);
    try { setInv(await fetchInventory()); }
    catch (e: any) { setError(String(e.message || e)); }
    setLoading(false);
  }, []);

  // "Weiter bearbeiten": Claude already re-scanned, so pull the fresh inventory
  // and reset back to a clean editing state.
  const continueCuration = useCallback(async () => {
    setSession(null); setAwaiting(false); setSubmitState("idle"); setSubmitMsg("");
    setCart(new Map());
    await reload();
  }, [reload]);

  const finishSession = useCallback(async () => {
    try { await postClose(); } catch { /* server may already be gone */ }
    setAwaiting(false);
    setSession((s) => ({ phase: "closing", message: "Sitzung beendet.", server: "closing", result: s?.result ?? null }));
  }, []);

  const value: Store = {
    inv, loading, error, view, setView, selectedProject, openProject,
    filters, setQ, setSort, cycleFacet, clearFilters, filterEntries,
    cart, cartList, cartSet, cartRemove, clearCart, entryItem,
    submitState, submitMsg, submit, session, continueCuration, finishSession,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/* projected always-loaded budget given the cart */
export function projectedLines(inv: Inventory, cart: CartItem[]): number {
  let n = inv.budget.current_lines;
  const ruleLines = (path: string) => inv.global.rules.find((r) => r.path === path || r.filename === path.split("/").pop())?.lines ?? 0;
  for (const it of cart) {
    if (it.kind === "promote") n += it.translated_text.trim() ? it.translated_text.replace(/\n+$/, "").split("\n").length : 6;
    else if (it.kind === "edit_global") {
      const orig = it.path.endsWith("CLAUDE.md") ? inv.global.claude_md.lines : ruleLines(it.path);
      n += it.estLines - orig;
    } else if (it.kind === "delete_global") n -= ruleLines(it.path);
  }
  return Math.max(0, n);
}
