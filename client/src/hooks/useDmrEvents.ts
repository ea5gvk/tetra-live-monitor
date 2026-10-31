import { useCallback, useEffect, useReducer, useRef } from "react";

// The client of the DMR dashboard (phase 3b): /api/dmr/state at load and every 30 s, an EventSource on
// /api/dmr/events (exponential reconnection 1 s -> 30 s, full refresh on every reconnection), the dmrtc events
// merged into the state (history of up to 500, active calls from call_start/call_end, registrations from
// registration/deregistration/mass_registration, the gateway from gateway), and the callsigns from state.names
// plus /api/dmr/names for the IDs that show up later (debounced). Commands go through /api/dmr/cmd with the system
// password; the rejected ones are written into the history as local entries.
//
// 3a quirk (dmrtc's pushEvent writes the event counter over "id" and the event type over "type"): the radio of a
// registration/deregistration/ping/position event is trusted only under radio_id, or under id when the counter has
// moved to event_id; the group/private type of call_* events only under call_type or when type is a call type.

export const DMR_ID_MAX = 16777215;
export const DMR_SMS_MAX = 1000;
export const DMR_DGNA_MAX = 15;
export const HISTORY_MAX = 500;
export const STATE_REFRESH_MS = 30 * 1000;
export const MIN_REFRESH_GAP_MS = 5 * 1000;
export const RECONNECT_MIN_MS = 1000;
export const RECONNECT_MAX_MS = 30 * 1000;
export const NAMES_DEBOUNCE_MS = 1500;
export const NAMES_RETRY_MS = 60 * 1000;
const NAMES_QUERY_MAX = 200;

export type DmrCmd =
  | "requestMassRegistration" | "sendUDTShortMessage" | "sendUDTDGNA" | "pingRadio" | "pollStatus" | "pollData"
  | "sendAuthCheck" | "announceLocalTime" | "announceSystemFreqs" | "announceSystemMessage" | "announceAdjacentSites"
  | "setChannelEnabled" | "requestStatusSnapshot";

export const CALL_TYPES = ["group", "private", "group_packet", "private_packet"] as const;
export type CallType = typeof CALL_TYPES[number];

export interface DmrSlotCall {
  src: number; dst: number; type: CallType | string; local: boolean; network: boolean;
  call_time_s: number; rssi: number; ber: number; max_ber: number; text: string; gps: string; timeout: boolean;
}
export interface DmrSlot {
  slot: number; index: number; control: boolean; enabled: boolean; busy: boolean;
  state: "control" | "disabled" | "busy" | "idle"; text: string; call: DmrSlotCall | null;
}
export interface DmrChannel {
  channel_id: number; physical_id: number; logical_channel: number; tx_freq: number; rx_freq: number;
  colour_code: number; control: boolean; slots: DmrSlot[];
}
export interface DmrRegistered { id: number; talkgroups: number[]; dgna: number[]; registered_at: string; last_seen: string }
export interface DmrCall {
  channel_id: number; slot: number; index: number; src: number; dst: number; type: CallType | string; network: boolean;
  local: boolean; call_time_s: number; rssi: number; ber: number; max_ber: number; text: string; gps: string; started: string | null;
}
export interface DmrGatewayEntry { gateway_id: string; gateway_name: string; gateway_type: string; talkgroup_prefix: string; enable_private_calls: string }
export interface DmrGateway {
  enabled: boolean; trunking_protocol: boolean; number: number; address: string; listen_port: number; send_port: number;
  gateways: DmrGatewayEntry[]; logged_in: boolean | null; logged_in_at: string | null;
}
export interface DmrConfig {
  system_code: number; control_channel: { physical_id: number; channel_id: number; slot: number }; channel_number: number;
  gateway_enabled: boolean; registration_required: boolean; authentication_required: boolean; use_trunking_protocol: boolean;
  receive_tg_attach: boolean; send_network_registrations: boolean; announce_system_message: boolean; announce_priority: boolean;
  system_announcement_message: string; announce_system_freqs_interval: number; announce_adjacent_bs_interval: number;
  announce_late_entry_interval: number; payload_channel_idle_timeout: number; freq_base: number; freq_separation: number;
  freq_duplexsplit: number; use_fixed_channel_plan: boolean; channel_disable_bitmask: number; log_level: number;
  local_tg_ids: number[]; talkgroup_routing: { tg: number; gateway: number }[]; service_ids: Record<string, number>;
}
export interface DmrEvent { id?: number; ts: string; type: string; [k: string]: unknown }
export interface HistoryEntry extends DmrEvent { key: string; local?: boolean }
export interface DmrName { callsign: string; name?: string; city?: string; country?: string }
export interface DmrStackState { installed: boolean; exists: boolean; enabled: boolean; version: string | null; active: boolean; degraded: boolean; missing: string[] }

export interface DmrState {
  version: string; uptime_s: number; headless: boolean; started: string; now: string; snapshot_ts: string | null;
  snapshot_age_ms: number | null; startup_completed: boolean; config: DmrConfig; channels: DmrChannel[];
  registered: DmrRegistered[]; subscribed_talkgroups: number[]; calls_active: DmrCall[]; private_calls: { dst: number; src: number }[];
  gateway: DmrGateway; stats: Record<string, number>; last_events: DmrEvent[]; rejected_streams: number; auth_pending: number;
  names?: Record<string, DmrName>; panel?: { fetched_at: string; latency_ms: number; host: string; port: number };
}

// live = the SSE is open; reconnecting = it dropped and a retry is scheduled; stopped = the stack is not running
// (503 reason stopped / panel reason stopped); unreachable = the stack runs but dmrtc has no status server.
export type ConnStatus = "loading" | "live" | "reconnecting" | "stopped" | "unreachable";

export interface CmdResult { ok: boolean; status: number; message?: string; data: Record<string, unknown> }

interface Model {
  state: DmrState | null;
  stack: DmrStackState | null;
  conn: ConnStatus;
  connReason: string;
  history: HistoryEntry[];
  names: Record<string, DmrName>;
  fetchedAt: string | null;
  latencyMs: number | null;
  // bumped when an event could not be merged on its own (no usable radio id, unknown call type): the hook then
  // refreshes /api/dmr/state, never more often than every MIN_REFRESH_GAP_MS
  refreshWanted: number;
}

type Action =
  | { type: "state"; state: DmrState; source: "fetch" | "hello" }
  | { type: "stack"; stack: DmrStackState | null; conn: "stopped" | "unreachable"; reason: string }
  | { type: "conn"; conn: ConnStatus; reason?: string }
  | { type: "event"; event: DmrEvent }
  | { type: "names"; names: Record<string, DmrName> }
  | { type: "local"; entry: DmrEvent };

const SSE_TYPES = [
  "registration", "deregistration", "mass_registration", "call_start", "call_end", "call_stats", "channel", "sms",
  "call_rejected", "ping", "position", "auth", "subscriptions", "gateway", "announce", "command", "log",
] as const;

const toInt = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : undefined;
};

/** The radio of a registration/deregistration/ping/position event, or undefined when only the event counter is there. */
export function eventRadioId(e: DmrEvent): number | undefined {
  if (e.radio_id !== undefined) return toInt(e.radio_id);
  if (e.event_id !== undefined) return toInt(e.id);
  return undefined;
}

/** The group/private type of a call_* event, or undefined when dmrtc overwrote it with the event type. */
export function eventCallType(e: DmrEvent): CallType | undefined {
  const t = (e.call_type ?? e.type) as string;
  return (CALL_TYPES as readonly string[]).includes(t) ? (t as CallType) : undefined;
}

export const isPrivateType = (t: unknown) => typeof t === "string" && t.startsWith("private");

/** The radio IDs of one event (src always; dst only for private calls / private SMS; never a talkgroup). */
export function eventRadioIds(e: DmrEvent): number[] {
  const ids: number[] = [];
  const add = (v: unknown) => { const n = toInt(v); if (n) ids.push(n); };
  switch (e.type) {
    case "registration": case "deregistration": case "ping": case "position": add(eventRadioId(e)); break;
    case "call_start": case "call_end": case "call_stats": add(e.src); if (isPrivateType(eventCallType(e))) add(e.dst); break;
    case "call_rejected": add(e.src); break;
    case "sms": add(e.src); if (e.group === false) add(e.dst); break;
    case "mass_registration": for (const id of Array.isArray(e.cleared) ? e.cleared : []) add(id); break;
  }
  return ids;
}

/** The radio IDs of a whole state (registered, calls, private calls, slot calls, last events). */
export function stateRadioIds(s: DmrState): number[] {
  const ids = new Set<number>();
  const add = (v: unknown) => { const n = toInt(v); if (n) ids.add(n); };
  const call = (c: { src?: unknown; dst?: unknown; type?: unknown } | null | undefined) => { if (c) { add(c.src); if (isPrivateType(c.type)) add(c.dst); } };
  for (const r of s.registered ?? []) add(r.id);
  for (const c of s.calls_active ?? []) call(c);
  for (const p of s.private_calls ?? []) { add(p.src); add(p.dst); }
  for (const ch of s.channels ?? []) for (const sl of ch.slots ?? []) call(sl.call);
  for (const e of s.last_events ?? []) for (const id of eventRadioIds(e)) ids.add(id);
  return Array.from(ids);
}

const eventKey = (e: DmrEvent) => `${e.id ?? "x"}:${e.ts}:${e.type}`;

function mergeHistory(prev: HistoryEntry[], incoming: HistoryEntry[]): HistoryEntry[] {
  if (!incoming.length) return prev;
  const seen = new Set(prev.map((h) => h.key));
  const fresh = incoming.filter((h) => !seen.has(h.key));
  if (!fresh.length) return prev;
  // one live event goes on top as it arrives (the browser's clock may differ from the Pi's); a batch (the
  // last_events of a /state) is ordered by its timestamps, newest first
  if (fresh.length === 1) return [fresh[0], ...prev].slice(0, HISTORY_MAX);
  return [...fresh, ...prev].sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0)).slice(0, HISTORY_MAX);
}

let localSeq = 0;

function idleState(slot: DmrSlot): DmrSlot["state"] {
  return slot.control ? "control" : slot.enabled ? "idle" : "disabled";
}

function patchSlot(channels: DmrChannel[], channelId: unknown, slotNo: unknown, fn: (s: DmrSlot) => DmrSlot): DmrChannel[] {
  const ch = toInt(channelId), sl = toInt(slotNo);
  if (ch === undefined || sl === undefined) return channels;
  return channels.map((c) => c.channel_id !== ch ? c : { ...c, slots: c.slots.map((s) => s.slot === sl ? fn(s) : s) });
}

function touch(registered: DmrRegistered[], id: number | undefined, ts: string): DmrRegistered[] {
  if (!id) return registered;
  return registered.map((r) => r.id === id && r.last_seen < ts ? { ...r, last_seen: ts } : r);
}

/** One dmrtc event folded into the state; pure. Returns the new state and whether a refresh is wanted. */
export function applyEvent(state: DmrState, e: DmrEvent): { state: DmrState; refresh: boolean } {
  let refresh = false;
  let s = state;
  switch (e.type) {
    case "registration": {
      const id = eventRadioId(e);
      if (id === undefined) { refresh = true; break; }
      const have = s.registered.find((r) => r.id === id);
      s = { ...s, registered: have
        ? s.registered.map((r) => r.id === id ? { ...r, last_seen: e.ts } : r)
        : [...s.registered, { id, talkgroups: [], dgna: [], registered_at: e.ts, last_seen: e.ts }] };
      // the talkgroups attached at registration only come with the next /state
      if (!have) refresh = true;
      break;
    }
    case "deregistration": {
      const id = eventRadioId(e);
      if (id === undefined) { refresh = true; break; }
      s = { ...s, registered: s.registered.filter((r) => r.id !== id) };
      break;
    }
    case "mass_registration": {
      const cleared = new Set((Array.isArray(e.cleared) ? e.cleared : []).map(toInt).filter((n): n is number => n !== undefined));
      s = { ...s, registered: s.registered.filter((r) => !cleared.has(r.id)) };
      break;
    }
    case "call_start": {
      const index = toInt(e.index), src = toInt(e.src) ?? 0, dst = toInt(e.dst) ?? 0;
      const type = eventCallType(e);
      if (!type) refresh = true;
      const prev = s.calls_active.find((c) => c.index === index);
      const network = e.network === true;
      const call: DmrCall = {
        channel_id: toInt(e.channel_id) ?? prev?.channel_id ?? 0, slot: toInt(e.slot) ?? prev?.slot ?? 0, index: index ?? -1,
        src, dst, type: type ?? prev?.type ?? "", network, local: !network,
        call_time_s: 0, rssi: prev?.rssi ?? 0, ber: prev?.ber ?? 0, max_ber: prev?.max_ber ?? 0, text: "", gps: "",
        started: typeof e.started === "string" ? e.started : e.ts,
      };
      const calls = index === undefined ? [...s.calls_active, call] : [...s.calls_active.filter((c) => c.index !== index), call];
      const channels = patchSlot(s.channels, e.channel_id, e.slot, (sl) => ({
        ...sl, busy: true, state: "busy",
        call: { src, dst, type: call.type, local: !network, network, call_time_s: 0, rssi: sl.call?.rssi ?? 0, ber: sl.call?.ber ?? 0, max_ber: sl.call?.max_ber ?? 0, text: "", gps: "", timeout: false },
      }));
      s = { ...s, calls_active: calls, channels, registered: touch(s.registered, src, e.ts) };
      break;
    }
    case "call_end": {
      const index = toInt(e.index);
      const calls = index === undefined ? s.calls_active : s.calls_active.filter((c) => c.index !== index);
      const channels = patchSlot(s.channels, e.channel_id, e.slot, (sl) => ({ ...sl, busy: false, state: idleState(sl), call: null }));
      s = { ...s, calls_active: calls, channels };
      break;
    }
    case "call_stats": {
      const src = toInt(e.src), dst = toInt(e.dst);
      const stats = { rssi: Number(e.rssi) || 0, ber: Number(e.ber) || 0, max_ber: Number(e.max_ber) || 0, call_time_s: toInt(e.call_time_s) ?? 0 };
      s = {
        ...s,
        calls_active: s.calls_active.map((c) => c.src === src && c.dst === dst ? { ...c, ...stats } : c),
        channels: s.channels.map((c) => ({ ...c, slots: c.slots.map((sl) => sl.call && sl.call.src === src && sl.call.dst === dst ? { ...sl, call: { ...sl.call, ...stats } } : sl) })),
        registered: touch(s.registered, src, e.ts),
      };
      break;
    }
    case "channel": {
      const st = e.state as DmrSlot["state"] | undefined;
      s = { ...s, channels: patchSlot(s.channels, e.channel_id, e.slot, (sl) => ({
        ...sl,
        enabled: typeof e.enabled === "boolean" ? e.enabled : sl.enabled,
        state: st && ["control", "disabled", "busy", "idle"].includes(st) ? st : sl.state,
        busy: st ? st === "busy" : sl.busy,
        call: st && st !== "busy" ? null : sl.call,
      })) };
      break;
    }
    case "sms": case "call_rejected": s = { ...s, registered: touch(s.registered, toInt(e.src), e.ts) }; break;
    case "ping": if (e.ok === true) s = { ...s, registered: touch(s.registered, eventRadioId(e), e.ts) }; break;
    case "position": s = { ...s, registered: touch(s.registered, eventRadioId(e), e.ts) }; break;
    case "subscriptions": {
      const tgs = (Array.isArray(e.talkgroups) ? e.talkgroups : []).map(toInt).filter((n): n is number => n !== undefined);
      s = { ...s, subscribed_talkgroups: tgs };
      break;
    }
    case "gateway": {
      if (e.logged_in === true) s = { ...s, gateway: { ...s.gateway, logged_in: true, logged_in_at: s.gateway.logged_in_at ?? e.ts } };
      break;
    }
  }
  return { state: s, refresh };
}

function reducer(m: Model, a: Action): Model {
  switch (a.type) {
    case "state": {
      const { names: stateNames, panel, ...state } = a.state;
      const history = mergeHistory(m.history, (state.last_events ?? []).map((e) => ({ ...e, key: eventKey(e) })));
      return {
        ...m, state, history,
        names: stateNames ? { ...m.names, ...stateNames } : m.names,
        fetchedAt: panel?.fetched_at ?? new Date().toISOString(),
        latencyMs: panel?.latency_ms ?? m.latencyMs,
        stack: m.stack ? { ...m.stack, active: true, degraded: false, missing: [] } : m.stack,
        // the stack answers again: "live" only when the SSE says so
        conn: m.conn === "stopped" || m.conn === "unreachable" ? "reconnecting" : m.conn,
      };
    }
    case "stack":
      // the stack is stopped or dmrtc is gone: the last state is stale, the history stays
      return { ...m, state: null, stack: a.stack ?? m.stack, conn: a.conn, connReason: a.reason };
    case "conn":
      return { ...m, conn: a.conn, connReason: a.reason ?? "" };
    case "event": {
      const entry: HistoryEntry = { ...a.event, key: eventKey(a.event) };
      const history = mergeHistory(m.history, [entry]);
      if (!m.state) return { ...m, history };
      const { state, refresh } = applyEvent(m.state, a.event);
      return { ...m, state, history, refreshWanted: refresh ? m.refreshWanted + 1 : m.refreshWanted };
    }
    case "names":
      return Object.keys(a.names).length ? { ...m, names: { ...m.names, ...a.names } } : m;
    case "local": {
      const entry: HistoryEntry = { ...a.entry, key: `local-${++localSeq}`, local: true };
      return { ...m, history: mergeHistory(m.history, [entry]) };
    }
  }
}

const initial: Model = {
  state: null, stack: null, conn: "loading", connReason: "", history: [], names: {},
  fetchedAt: null, latencyMs: null, refreshWanted: 0,
};

export function useDmrEvents() {
  const [m, dispatch] = useReducer(reducer, initial);
  const esRef = useRef<EventSource | null>(null);
  const backoffRef = useRef(RECONNECT_MIN_MS);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFetchRef = useRef(0);
  const fetchingRef = useRef(false);
  const aliveRef = useRef(true);
  // callsign resolution: ids waiting for the next /api/dmr/names, and when each id was last asked for
  const pendingIds = useRef(new Set<number>());
  const askedAt = useRef(new Map<number, number>());
  const namesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const namesRef = useRef(m.names);
  namesRef.current = m.names;
  // the SSE connect of the effect below, so a successful fetch can bring the stream back at once
  const connectNowRef = useRef<() => void>(() => {});

  const flushNames = useCallback(async () => {
    namesTimer.current = null;
    const now = Date.now();
    const ids = Array.from(pendingIds.current).filter((id) => !namesRef.current[String(id)] && now - (askedAt.current.get(id) ?? 0) > NAMES_RETRY_MS);
    pendingIds.current.clear();
    if (!ids.length) return;
    for (const id of ids) askedAt.current.set(id, now);
    for (let i = 0; i < ids.length; i += NAMES_QUERY_MAX) {
      try {
        const r = await fetch(`/api/dmr/names?ids=${ids.slice(i, i + NAMES_QUERY_MAX).join(",")}`);
        if (!r.ok) continue;
        const j = await r.json();
        if (aliveRef.current && j && typeof j === "object") dispatch({ type: "names", names: j });
      } catch { /* next round */ }
    }
  }, []);

  const wantNames = useCallback((ids: number[]) => {
    let added = false;
    for (const id of ids) {
      if (id < 1000 || id > DMR_ID_MAX || namesRef.current[String(id)]) continue;
      pendingIds.current.add(id);
      added = true;
    }
    if (added && !namesTimer.current) namesTimer.current = setTimeout(flushNames, NAMES_DEBOUNCE_MS);
  }, [flushNames]);

  const refresh = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    lastFetchRef.current = Date.now();
    try {
      const r = await fetch("/api/dmr/state", { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (!aliveRef.current) return;
      if (r.ok && j && typeof j === "object") {
        dispatch({ type: "state", state: j as DmrState, source: "fetch" });
        wantNames(stateRadioIds(j as DmrState));
        if (!esRef.current) connectNowRef.current();
      } else if (r.status === 503 && j && typeof j === "object") {
        const reason = j.reason === "stopped" ? "stopped" : "unreachable";
        dispatch({ type: "stack", stack: (j.state as DmrStackState) ?? null, conn: reason, reason: String(j.message ?? "") });
      } else {
        dispatch({ type: "conn", conn: "reconnecting", reason: `HTTP ${r.status}` });
      }
    } catch (e: any) {
      if (aliveRef.current) dispatch({ type: "conn", conn: "reconnecting", reason: String(e?.message ?? e) });
    } finally {
      fetchingRef.current = false;
    }
  }, [wantNames]);

  // a refresh no sooner than MIN_REFRESH_GAP_MS after the previous one, a single one pending at a time
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) return;
    const wait = Math.max(0, MIN_REFRESH_GAP_MS - (Date.now() - lastFetchRef.current));
    refreshTimer.current = setTimeout(() => { refreshTimer.current = null; refresh(); }, wait);
  }, [refresh]);

  useEffect(() => { if (m.refreshWanted > 0) scheduleRefresh(); }, [m.refreshWanted, scheduleRefresh]);

  useEffect(() => {
    aliveRef.current = true;

    const planReconnect = () => {
      if (!aliveRef.current || reconnectTimer.current) return;
      const wait = backoffRef.current;
      backoffRef.current = Math.min(backoffRef.current * 2, RECONNECT_MAX_MS);
      reconnectTimer.current = setTimeout(() => { reconnectTimer.current = null; connect(); }, wait);
    };

    const connect = () => {
      if (!aliveRef.current) return;
      if (esRef.current) esRef.current.close();
      const es = new EventSource("/api/dmr/events");
      esRef.current = es;
      let dead = false;
      const die = () => { dead = true; es.close(); if (esRef.current === es) esRef.current = null; };
      const dataOf = (ev: Event): any => { try { return JSON.parse((ev as MessageEvent).data); } catch { return null; } };
      es.addEventListener("panel", (ev: Event) => {
        if (dead) return;
        const d = dataOf(ev);
        if (!d) return;
        if (d.connected) {
          backoffRef.current = RECONNECT_MIN_MS;
          dispatch({ type: "conn", conn: "live" });
          // full refresh on every (re)connection: the names and whatever happened while we were away
          scheduleRefresh();
          return;
        }
        const reason = String(d.reason ?? "");
        if (reason === "stopped") dispatch({ type: "stack", stack: (d.state as DmrStackState) ?? null, conn: "stopped", reason });
        else if (reason === "unreachable") dispatch({ type: "stack", stack: null, conn: "unreachable", reason });
        else dispatch({ type: "conn", conn: "reconnecting", reason });
        // the server closes right after; our backoff decides when to come back
        die();
        planReconnect();
      });
      es.addEventListener("hello", (ev: Event) => {
        if (dead) return;
        const st = dataOf(ev) as DmrState | null;
        if (st && typeof st === "object" && Array.isArray(st.channels)) {
          dispatch({ type: "state", state: st, source: "hello" });
          wantNames(stateRadioIds(st));
        }
      });
      for (const type of SSE_TYPES) {
        es.addEventListener(type, (ev: Event) => {
          if (dead) return;
          const d = dataOf(ev);
          if (!d || typeof d !== "object") return;
          const event: DmrEvent = { ...d, type, ts: typeof d.ts === "string" ? d.ts : new Date().toISOString() };
          dispatch({ type: "event", event });
          wantNames(eventRadioIds(event));
        });
      }
      es.onerror = () => {
        if (dead) return;
        die();
        dispatch({ type: "conn", conn: "reconnecting", reason: "sse" });
        planReconnect();
      };
    };
    connectNowRef.current = () => {
      if (!aliveRef.current || esRef.current) return;
      if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null; }
      backoffRef.current = RECONNECT_MIN_MS;
      connect();
    };

    refresh();
    connect();
    const interval = setInterval(refresh, STATE_REFRESH_MS);
    return () => {
      aliveRef.current = false;
      clearInterval(interval);
      if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null; }
      if (refreshTimer.current) { clearTimeout(refreshTimer.current); refreshTimer.current = null; }
      if (namesTimer.current) { clearTimeout(namesTimer.current); namesTimer.current = null; }
      connectNowRef.current = () => {};
      if (esRef.current) { esRef.current.close(); esRef.current = null; }
    };
  }, [refresh, scheduleRefresh, wantNames]);

  const sendCmd = useCallback(async (password: string, cmd: DmrCmd, args: Record<string, unknown> = {}): Promise<CmdResult> => {
    let r: Response;
    try {
      r = await fetch("/api/dmr/cmd", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password, cmd, ...args }) });
    } catch (e: any) {
      const message = String(e?.message ?? e);
      dispatch({ type: "local", entry: { type: "command", ts: new Date().toISOString(), cmd, args, error: message } });
      return { ok: false, status: 0, message, data: {} };
    }
    const j = await r.json().catch(() => ({})) as Record<string, unknown>;
    const ok = r.ok && j.ok !== false;
    const message = typeof j.message === "string" ? j.message : ok ? undefined : `HTTP ${r.status}`;
    // a wrong password is the user's business, not the site's history
    if (!ok && r.status !== 401) dispatch({ type: "local", entry: { type: "command", ts: new Date().toISOString(), cmd, args, error: message } });
    return { ok, status: r.status, message, data: j };
  }, []);

  const nameOf = useCallback((id: number | string | undefined | null): DmrName | undefined => id === undefined || id === null ? undefined : m.names[String(id)], [m.names]);

  return {
    state: m.state, stack: m.stack, conn: m.conn, connReason: m.connReason, history: m.history, names: m.names,
    fetchedAt: m.fetchedAt, latencyMs: m.latencyMs, refresh, sendCmd, nameOf,
  };
}
