import { useEffect, useState } from "react";
import type { DmrName, DmrStackState } from "@/hooks/useDmrEvents";

// The client of the DMR Tier II monitor: GET /api/dmr/tier2/state every 1.5 s while the page is visible (like
// Pi-Star), nothing while it is hidden. A failed poll keeps the last good state; 3 in a row mark it stale.
// A 503 (tier3 / stopped / not_installed) is an answer, not a failure: it is exposed as notApplicable.

export const TIER2_POLL_MS = 1500;
export const TIER2_STALE_FAILS = 3;

export type Tier2EndKind = "end" | "lost" | "watchdog" | "timeout" | "restart";
export type Tier2NetStatus = "up" | "down" | "connecting" | "unknown" | "off";
export interface Tier2Call {
  key: string; slot: 1 | 2; src: "rf" | "net"; kind: "voice" | "data";
  from: string; from_id: number | null; to: string; to_id: number | null; group: boolean; net: string | null;
  start: number; end: number | null; dur: number | null; ber: number | null; loss: number | null;
  rssi: { min: number; max: number; ave: number } | null;
  end_kind: Tier2EndKind | null; blocks: number | null; ta: string | null; late: boolean;
}
export interface Tier2Net {
  n: number; name: string; address: string | null; port: number | null; routes: string | null; enabled: boolean;
  status: Tier2NetStatus; since: number | null; reason: string | null;
}
export interface Tier2Window {
  attached: boolean; sdr_rate: number | null; rx_hz: number | null; tx_hz: number | null; tx_gain: number | null;
  rx_lost: number | null; tx_late: number | null; min_margin_ms: number | null; at: number | null;
}
export interface Tier2Alert { ts: number; level: "info" | "warn" | "error"; text: string }
export interface Tier2Station {
  callsign: string | null; id: number | null; rx_hz: number | null; tx_hz: number | null; color_code: number | null;
  timeout_s: number | null; shared: boolean; display_level: number | null;
}
export interface Tier2State {
  ok: true; demo: boolean; now: number; stack: DmrStackState; station: Tier2Station;
  slots: { "1": Tier2Call | null; "2": Tier2Call | null };
  heard: Tier2Call[]; nets: Tier2Net[];
  modem: { tx: boolean; mode: string | null; since: number | null };
  window: Tier2Window | null; alerts: Tier2Alert[]; names: Record<string, DmrName>;
}
export interface Tier2NotApplicable { ok: false; reason: "tier3" | "stopped" | "not_installed"; state: DmrStackState | null; message: string }

export function useDmrTier2() {
  const [data, setData] = useState<Tier2State | null>(null);
  const [notApplicable, setNotApplicable] = useState<Tier2NotApplicable | null>(null);
  const [fails, setFails] = useState(0);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  // server clock - browser clock: the call times are the Pi's, the live counters run on the browser's
  const [skew, setSkew] = useState(0);

  useEffect(() => {
    let alive = true;
    let busy = false;
    const poll = async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const r = await fetch("/api/dmr/tier2/state", { cache: "no-store" });
        const j = await r.json().catch(() => null);
        if (!alive) return;
        if (r.ok && j?.ok === true) {
          setData(j as Tier2State);
          setNotApplicable(null);
          setFails(0);
          setFetchedAt(Date.now());
          if (typeof j.now === "number") setSkew(j.now - Date.now());
        } else if (r.status === 503 && j && typeof j.reason === "string") {
          setData(null);
          setNotApplicable(j as Tier2NotApplicable);
          setFails(0);
        } else {
          setFails((f) => f + 1);
        }
      } catch {
        if (alive) setFails((f) => f + 1);
      } finally {
        busy = false;
      }
    };
    poll();
    const id = setInterval(poll, TIER2_POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") poll(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { alive = false; clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  return { data, notApplicable, fails, stale: fails >= TIER2_STALE_FAILS, fetchedAt, skew };
}
