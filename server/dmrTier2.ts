// The DMR Tier II monitor (a Pi-Star / WPSD style "last heard"). In Tier II (DMR_TIER=2) there is no dmrtc: the
// calls, the networks of DMRGateway, the modem and the MiuraStation DMR window come from the "M:" lines that
// MMDVM-Host, DMRGateway, MMDVM-Multi and MMDVM-IQ already write to the journal.
// - GET /api/dmr/tier2/state (read only, no password): the whole state; 503 tier3 / stopped / not_installed like
//   /api/dmr/state. The client polls it every 1.5 s while the page is visible: no SSE.
// - the source is ONE shared "nice -n 19 journalctl -f -o json -n 3000" of the four units, started by the first GET
//   while the stack is in Tier II and running, stopped after 10 min without one (or out of Tier II), restarted 3 s
//   after it dies while in use. Every (re)start begins from a clean state that the -n 3000 backlog rebuilds, plus
//   dmr-tier2-heard.json (the last 100 calls, written atomically every 5 s at most, deduplicated by key).
// - parseLine (pure) turns one journal entry into an event; Tier2Monitor folds the events into the state;
//   routeNetwork (pure) says which DMRGateway network a network call belongs to after NET_ROUTES/NETn_ROUTES.
// - times are the journal's __REALTIME_TIMESTAMP (the time inside an MMDVM line is UTC: only a fallback).
// - callsigns come from the panel's one DmrNameCache (dmrStatus.ts: two writers would clobber dmrid_cache.json).
// - demo (not Linux, or TETRA_DEMO=1): a generator writes lines in the real formats into the same parser.
// The factory takes its dependencies (stack state, Tier II marker, config, line source, cache) so the tests run the
// handler against a fake source, without journalctl.
import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import { StringDecoder } from "string_decoder";
import type { Request, Response } from "express";
import { DMR, dmrState as realDmrState, dmrTier2, dmrShared, readDmrConf, type DmrState } from "./dmrStation";
import { DMR_ID_MAX, type DmrName, type DmrNameCache } from "./dmrStatus";

export const TIER2_HEARD_MAX = 100;
export const TIER2_ALERTS_MAX = 50;
export const TIER2_TIMEOUT_DEFAULT_S = 180;     // [General] Timeout of MMDVM-Host-1.ini (gen-config.py writes 180)
export const TIER2_SAFETY_MARGIN_S = 15;        // a call open longer than Timeout + this is closed by the panel
export const TIER2_IDLE_MS = 10 * 60 * 1000;    // no GET for this long: journalctl is stopped
export const TIER2_RESTART_MS = 3000;
export const TIER2_PERSIST_MS = 5000;
export const TIER2_CACHE_MS = 5000;             // dmrState() and the config files, shared by all the pollers
export const TIER2_HOST_INI = path.posix.join(DMR.confDir, "MMDVM-Host-1.ini");
export const TIER2_HEARD_FILE = "dmr-tier2-heard.json";
export const TIER2_JOURNAL_UNITS = ["mmdvm-host@1", "dmrgateway", "mmdvm-multi", "mmdvm-iq@1"] as const;
export const TIER2_JOURNAL_ARGS = ["-n", "19", "journalctl", "-f", "-o", "json", "-n", "3000", "--no-pager",
  ...TIER2_JOURNAL_UNITS.flatMap((u) => ["-u", u])];

export type Tier2Src = "rf" | "net";
export type Tier2EndKind = "end" | "lost" | "watchdog" | "timeout" | "restart";
export type Tier2NetStatus = "up" | "down" | "connecting" | "unknown" | "off";
export interface Tier2Rssi { min: number; max: number; ave: number }
export interface Tier2Call {
  key: string; slot: 1 | 2; src: Tier2Src; kind: "voice" | "data";
  from: string; from_id: number | null; to: string; to_id: number | null; group: boolean; net: string | null;
  start: number; end: number | null; dur: number | null; ber: number | null; loss: number | null; rssi: Tier2Rssi | null;
  end_kind: Tier2EndKind | null; blocks: number | null; ta: string | null; late: boolean;
}
export interface Tier2ConfNet { n: number; name: string; address: string | null; port: number | null; routes: string | null; enabled: boolean }
export interface Tier2Net extends Tier2ConfNet { status: Tier2NetStatus; since: number | null; reason: string | null }
export interface Tier2Window {
  attached: boolean; sdr_rate: number | null; rx_hz: number | null; tx_hz: number | null; tx_gain: number | null;
  rx_lost: number | null; tx_late: number | null; min_margin_ms: number | null; at: number | null;
}
export interface Tier2Alert { ts: number; level: "info" | "warn" | "error"; text: string }
export interface Tier2Station {
  callsign: string | null; id: number | null; rx_hz: number | null; tx_hz: number | null; color_code: number | null;
  timeout_s: number | null; shared: boolean; display_level: number | null;
}
export interface Tier2Modem { tx: boolean; mode: string | null; since: number | null }

// ── The parser (pure) ──

/** One journal line as an event. Flat: each kind fills its own fields (see parseLine). */
export interface Tier2Event {
  kind: "voice_start" | "voice_end" | "watchdog" | "timeout" | "data_start" | "data_end" | "rejected" | "ta" | "gps"
    | "net" | "tx" | "mode" | "window_attach" | "window_stats" | "window_off" | "host_restart" | "modem_error";
  ts: number | null; unit: string; level: string | null; text: string;
  slot?: 1 | 2; src?: Tier2Src; from?: string; to?: string; group?: boolean; late?: boolean;
  dur?: number | null; ber?: number | null; loss?: number | null; rssi?: Tier2Rssi | null; how?: "end" | "lost";
  blocks?: number; id?: number; tg?: number | null; ta?: string; lat?: number; lon?: number;
  name?: string; status?: Tier2NetStatus; reason?: string | null; on?: boolean; mode?: string;
  pid?: number; sdr_rate?: number; rx_hz?: number; tx_hz?: number; tx_gain?: number;
  rx_lost?: number; tx_late?: number; min_margin_ms?: number | null;
}

// "M: 2026-11-09 20:12:51.006 text": the level letter and the UTC time of MMDVM's Log.cpp.
const PREFIX_RE = /^([ DMIWEF]): (\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3}) (.*)$/;
// DMRSlot.cpp: src and dst are what CDMRLookup::find gives (the callsign of DMRIds.dat, else the number; 0xFFFFFF is
// "ALL"); "TG " before dst for a group call.
const V_START = /^DMR Slot ([12]), received (RF|network) (voice header|late entry) from (.+?) to (TG )?(.+)$/;
const V_END = /^DMR Slot ([12]), received (RF|network) end of voice transmission from (.+?) to (TG )?(.+?), ([\d.]+) seconds, (?:(\d+)% packet loss, )?BER: ([-\w.]+)%(?:, RSSI: (-?\d+)\/(-?\d+)\/(-?\d+) dBm)?$/;
const V_LOST = /^DMR Slot ([12]), RF voice transmission lost from (.+?) to (TG )?(.+?), ([\d.]+) seconds, BER: ([-\w.]+)%(?:, RSSI: (-?\d+)\/(-?\d+)\/(-?\d+) dBm)?$/;
const WATCHDOG = /^DMR Slot ([12]), network watchdog has expired(?:, ([\d.]+) seconds, (\d+)% packet loss, BER: ([-\w.]+)%)?$/;
const TIMEOUT = /^DMR Slot ([12]), (RF|network) user has timed out$/;
const D_START = /^DMR Slot ([12]), received (RF|network) data header from (.+?) to (TG )?(.+?), (\d+) blocks$/;
const D_END = /^DMR Slot ([12]), ended (RF|network) data transmission(?: from (.+?) to (TG )?(.+))?$/;
const D_LOST = /^DMR Slot ([12]), RF data transmission lost from (.+?) to (TG )?(.+)$/;
const REJECTED = /^DMR Slot ([12]), RF user (\d+) rejected(?: for using TG (\d+))?$/;
const TA_RE = /^DMR Slot ([12]), Talker Alias "(.*)"$/;
const GPS_RE = /^GPS position \[(-?[\d.]+),(-?[\d.]+)\]/;
const HOST_RESTART = /^(?:MMDVM-Host-\S+ is starting|MMDVM-Host is stopping|Closing the MMDVM)$/;
const MODEM_ERROR = /^No reply from the modem/;
// DMRNetwork.cpp of DMRGateway: "<Name>, ..." with NET_NAME / NETn_NAME (no commas: gen-config.py's NET_NAME_RE).
const NET_OPEN = /^(.+?), Opening DMR Network$/;
const NET_UP = /^(.+?), Logged into the master(?: via DTC protocol)? successfully$/;
const NET_DOWN = /^(.+?), ((?:Login to the master(?: via DTC protocol)? has failed|Connection to the master has timed out|Master is closing down|Socket has failed|Could not lookup the address of the master).*)$/;
const NET_CLOSE = /^(.+?), Closing DMR Network$/;
// MMDVM-Multi (patch 012) and MMDVM-IQ.
const TX_RE = /^TX (ON|OFF)$/;
const W_ATTACH = /^Attached to the MiuraStation DMR window \S+ \(MiuraStation pid (\d+), SDR at ([\d.]+) S\/s, RX ([\d.]+) Hz, TX ([\d.]+) Hz, .*TX gain ([\d.]+)\)$/;
const W_STATS = /^MiuraStation DMR window, last minute: (\d+) RX blocks lost, (\d+) TX samples late, (?:minimum TX margin ([\d.]+) ms|nothing transmitted)$/;
const W_CLOSED = /^MiuraStation DMR window closed$/;
const W_LOST = /^MiuraStation DMR window lost: (.*?)(?:; MMDVM-Multi exits.*)?$/;
const W_FAIL = /^The MiuraStation DMR window /;   // E: not available after 60 s, centred elsewhere
const MODE_RE = /^Mode set to (.+)$/;

const num = (s: string | undefined): number | null => { if (s === undefined) return null; const n = Number(s); return Number.isFinite(n) ? n : null; };
const srcOf = (s: string): Tier2Src => (s === "RF" ? "rf" : "net");
const rssiOf = (a?: string, b?: string, c?: string): Tier2Rssi | null => (a !== undefined && b !== undefined && c !== undefined ? { min: Number(a), max: Number(b), ave: Number(c) } : null);
/** The DMR ID of a party of the log: a number, ALL (16777215) or null for a callsign. */
export const partyId = (s: string): number | null => (s === "ALL" ? DMR_ID_MAX : /^\d{1,8}$/.test(s) ? Number(s) : null);

/** One entry of "journalctl -o json" ({MESSAGE, SYSLOG_IDENTIFIER, __REALTIME_TIMESTAMP}) as an event, or null when
 *  it is none of the lines the monitor reads. MESSAGE may be a string or an array of bytes (journald's non-UTF-8
 *  form); the "M: <UTC time> " prefix is optional. Each family is read only from its unit (mmdvm-host-*,
 *  dmrgateway, mmdvm-multi, mmdvm-iq-*), any of them when there is no SYSLOG_IDENTIFIER. Never throws. Pure. */
export function parseLine(entry: unknown): Tier2Event | null {
  if (!entry || typeof entry !== "object") return null;
  const j = entry as Record<string, unknown>;
  const raw = typeof j.MESSAGE === "string" ? j.MESSAGE
    : Array.isArray(j.MESSAGE) ? Buffer.from(j.MESSAGE.filter((b) => Number.isInteger(b) && b >= 0 && b < 256) as number[]).toString("utf-8")
    : null;
  if (raw === null) return null;
  const msg = raw.replace(/[\r\n]+$/, "");
  const unit = typeof j.SYSLOG_IDENTIFIER === "string" ? j.SYSLOG_IDENTIFIER : "";
  const p = PREFIX_RE.exec(msg);
  const text = p ? p[3] : msg.trim();
  const us = Number(j.__REALTIME_TIMESTAMP);
  const utc = p ? Date.parse(`${p[2].replace(" ", "T")}Z`) : NaN;
  const ts = Number.isFinite(us) && us > 0 ? Math.floor(us / 1000) : Number.isFinite(utc) ? utc : null;
  const ev = (kind: Tier2Event["kind"], f: Partial<Tier2Event> = {}): Tier2Event => ({ kind, ts, unit, level: p ? p[1] : null, text, ...f });
  let m: RegExpExecArray | null;

  if (!unit || unit.startsWith("mmdvm-host")) {
    if (text.startsWith("DMR Slot ")) {
      if ((m = V_START.exec(text))) return ev("voice_start", { slot: +m[1] as 1 | 2, src: srcOf(m[2]), late: m[3] === "late entry", from: m[4], group: !!m[5], to: m[6] });
      if ((m = V_END.exec(text))) return ev("voice_end", { slot: +m[1] as 1 | 2, src: srcOf(m[2]), from: m[3], group: !!m[4], to: m[5], dur: num(m[6]), loss: num(m[7]), ber: num(m[8]), rssi: rssiOf(m[9], m[10], m[11]), how: "end" });
      if ((m = V_LOST.exec(text))) return ev("voice_end", { slot: +m[1] as 1 | 2, src: "rf", from: m[2], group: !!m[3], to: m[4], dur: num(m[5]), loss: null, ber: num(m[6]), rssi: rssiOf(m[7], m[8], m[9]), how: "lost" });
      if ((m = WATCHDOG.exec(text))) return ev("watchdog", { slot: +m[1] as 1 | 2, src: "net", dur: num(m[2]), loss: num(m[3]), ber: num(m[4]) });
      if ((m = TIMEOUT.exec(text))) return ev("timeout", { slot: +m[1] as 1 | 2, src: srcOf(m[2]) });
      if ((m = D_START.exec(text))) return ev("data_start", { slot: +m[1] as 1 | 2, src: srcOf(m[2]), from: m[3], group: !!m[4], to: m[5], blocks: Number(m[6]) });
      if ((m = D_END.exec(text))) return ev("data_end", { slot: +m[1] as 1 | 2, src: srcOf(m[2]), how: "end", ...(m[3] !== undefined ? { from: m[3], group: !!m[4], to: m[5] } : {}) });
      if ((m = D_LOST.exec(text))) return ev("data_end", { slot: +m[1] as 1 | 2, src: "rf", how: "lost", from: m[2], group: !!m[3], to: m[4] });
      if ((m = REJECTED.exec(text))) return ev("rejected", { slot: +m[1] as 1 | 2, src: "rf", id: Number(m[2]), tg: num(m[3]) });
      if ((m = TA_RE.exec(text))) return ev("ta", { slot: +m[1] as 1 | 2, ta: m[2] });
      return null;
    }
    if ((m = GPS_RE.exec(text))) return ev("gps", { lat: Number(m[1]), lon: Number(m[2]) });
    if (HOST_RESTART.test(text)) return ev("host_restart");
    if (MODEM_ERROR.test(text)) return ev("modem_error");
  }
  if (!unit || unit === "dmrgateway") {
    if ((m = NET_UP.exec(text))) return ev("net", { name: m[1], status: "up", reason: null });
    if ((m = NET_DOWN.exec(text))) return ev("net", { name: m[1], status: "down", reason: m[2] });
    if ((m = NET_OPEN.exec(text))) return ev("net", { name: m[1], status: "connecting", reason: null });
    if ((m = NET_CLOSE.exec(text))) return ev("net", { name: m[1], status: "off", reason: null });
  }
  if (!unit || unit === "mmdvm-multi") {
    if ((m = TX_RE.exec(text))) return ev("tx", { on: m[1] === "ON" });
    if ((m = W_STATS.exec(text))) return ev("window_stats", { rx_lost: Number(m[1]), tx_late: Number(m[2]), min_margin_ms: num(m[3]) });
    if ((m = W_ATTACH.exec(text))) return ev("window_attach", { pid: Number(m[1]), sdr_rate: Number(m[2]), rx_hz: Number(m[3]), tx_hz: Number(m[4]), tx_gain: Number(m[5]) });
    if (W_CLOSED.test(text)) return ev("window_off", { reason: null });
    if ((m = W_LOST.exec(text))) return ev("window_off", { reason: m[1] });
    if (W_FAIL.test(text) && (p?.[1] === "E" || p?.[1] === "F")) return ev("window_off", { reason: text });
  }
  if (!unit || unit.startsWith("mmdvm-iq")) {
    if ((m = MODE_RE.exec(text))) return ev("mode", { mode: m[1] });
  }
  return null;
}

// ── The networks (pure) ──

const ROUTE_RE = /^[Ss](\d+)(?::(?:[Pp](\d+)|(\d+)(?:-(\d+))?))?$/;
const TG_PREFIX_SEPARATION = 1000000;   // gen-config.py: S1:P8 = 8000001..8999999 -> 1..999999

/** The DMRGateway network of a call in `slot` to talkgroup `tg` (null: a private call, only a whole slot takes it),
 *  after NET_ROUTES / NETn_ROUTES of dmr-tier3 0.6.0: "S1"/"S2" the whole slot (PassAllTG + PassAllPC), "S1:9" or
 *  "S2:214-219" that TG or range, "S1:P8" the prefix 8 (8000001..8999999). DMRGateway tries the TGRewrite of every
 *  network first (in order), then the PassAll: the first rule that matches takes the call. The numbers are the ones
 *  of the radio side, which is what MMDVM-Host logs both ways. `nets`: the enabled ones, in order; one network =
 *  that one; nothing matches = null. Pure. */
export function routeNetwork(slot: number, tg: number | null, nets: { name: string; routes: string | null }[]): string | null {
  if (nets.length === 1) return nets[0].name;
  const rules = nets.flatMap((n) => (n.routes ?? "").split(",").map((r) => ({ net: n.name, m: ROUTE_RE.exec(r.trim()) })))
    .filter((r): r is { net: string; m: RegExpExecArray } => !!r.m && Number(r.m[1]) === slot);
  if (tg !== null) {
    for (const { net, m } of rules) {
      const lo = m[2] !== undefined ? Number(m[2]) * TG_PREFIX_SEPARATION + 1 : m[3] !== undefined ? Number(m[3]) : NaN;
      const hi = m[2] !== undefined ? Number(m[2]) * TG_PREFIX_SEPARATION + 999999 : m[3] !== undefined ? Number(m[4] ?? m[3]) : NaN;
      if (tg >= lo && tg <= hi) return net;
    }
  }
  const whole = rules.find(({ m }) => m[2] === undefined && m[3] === undefined);
  return whole ? whole.net : null;
}

/** The networks of dmr-tier3.conf: the 1 (NET_*, on with GATEWAY_ENABLED) and those of 2..4 that are on or have a
 *  server; name, server, port, routes and whether it is on, never the password. A conf of 0.5.0 (no NET_NAME nor
 *  NET_ROUTES) is network 1 "ADN" with S1,S2. Pure. */
export function tier2Nets(conf: Record<string, string> | null): Tier2ConfNet[] {
  if (!conf) return [];
  const out: Tier2ConfNet[] = [];
  for (const n of [1, 2, 3, 4]) {
    const pre = n === 1 ? "NET_" : `NET${n}_`;
    const enabled = n === 1 ? conf.GATEWAY_ENABLED !== "0" : conf[`${pre}ENABLED`] === "1";
    const address = conf[`${pre}ADDRESS`] || null;
    if (n > 1 && !enabled && !address) continue;
    const port = Number(conf[`${pre}PORT`]);
    const routes = conf[`${pre}ROUTES`] !== undefined ? conf[`${pre}ROUTES`] : n === 1 ? "S1,S2" : "";
    out.push({ n, name: conf[`${pre}NAME`] || (n === 1 ? "ADN" : `Red ${n}`), address, port: Number.isInteger(port) && port > 0 ? port : null, routes: routes || null, enabled });
  }
  return out;
}

// ── The station (MMDVM-Host-1.ini + dmr-tier3.conf) ──

/** {section: {key: value}} of an INI text (the first of a repeated key; ; and # comments). Pure. */
export function parseIni(text: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  let sec: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "").trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const s = /^\[(.+)\]$/.exec(line);
    if (s) { sec = out[s[1].trim()] ??= {}; continue; }
    const i = line.indexOf("=");
    if (i > 0) { const k = line.slice(0, i).trim(); if (!(k in sec)) sec[k] = line.slice(i + 1).trim(); }
  }
  return out;
}

const intOf = (v: string | undefined): number | null => (v !== undefined && /^-?\d+$/.test(v.trim()) ? Number(v) : null);

/** Callsign, Id, frequencies, colour code and Timeout of MMDVM-Host-1.ini (null each when missing) and DISPLAY_LEVEL
 *  of the conf (else [Log] DisplayLevel): with 3 or more the call lines are gone. */
export function readTier2Station(iniPath = TIER2_HOST_INI, conf: Record<string, string> | null = null, shared = false): Tier2Station {
  let ini: Record<string, Record<string, string>> = {};
  try { ini = parseIni(fs.readFileSync(iniPath, "utf-8")); } catch { /* not generated yet */ }
  const g = ini.General ?? {}, modem = ini.Modem ?? {}, info = ini.Info ?? {};
  return {
    callsign: g.Callsign || null, id: intOf(g.Id),
    rx_hz: intOf(modem.RXFrequency ?? info.RXFrequency), tx_hz: intOf(modem.TXFrequency ?? info.TXFrequency),
    color_code: intOf(ini.DMR?.ColorCode), timeout_s: intOf(g.Timeout), shared,
    display_level: intOf(conf?.DISPLAY_LEVEL) ?? intOf(ini.Log?.DisplayLevel),
  };
}

// ── The state ──

const levelOf = (l: string | null, dflt: Tier2Alert["level"]): Tier2Alert["level"] => (l === "E" || l === "F" ? "error" : l === "W" ? "warn" : dflt);
const EMPTY_WINDOW: Tier2Window = { attached: false, sdr_rate: null, rx_hz: null, tx_hz: null, tx_gain: null, rx_lost: null, tx_late: null, min_margin_ms: null, at: null };

export interface Tier2MonitorOpts {
  timeoutS?: () => number;
  netOf?: (slot: 1 | 2, tg: number | null) => string | null;
  heard?: Tier2Call[];        // persisted calls to start from
  onHeard?: () => void;       // heard changed (persistence)
}

/** The state of the repeater out of the events, in journal order: the call in progress per timeslot and origin
 *  (MMDVM-Host keeps the RF and the network state of a slot apart: a local radio can key up over a network call; a
 *  new header closes the previous one of its origin as lost; one open longer than Timeout + 15 s is closed as
 *  timeout), the last 100 calls (most recent first; the same call again replaces it), the DMRGateway networks by
 *  name, the modem, the MiuraStation DMR window and the last 50 alerts. */
export class Tier2Monitor {
  live: Record<string, Tier2Call | null> = { "1-rf": null, "1-net": null, "2-rf": null, "2-net": null };
  heard: Tier2Call[];
  nets = new Map<string, { status: Tier2NetStatus; since: number; reason: string | null }>();
  modem: Tier2Modem = { tx: false, mode: null, since: null };
  window: Tier2Window | null = null;
  alerts: Tier2Alert[] = [];
  private timedOut: Record<string, boolean> = {};
  /** The call on the air per timeslot: the RF one, else the network one. */
  get slots(): Record<1 | 2, Tier2Call | null> {
    return { 1: this.live["1-rf"] ?? this.live["1-net"], 2: this.live["2-rf"] ?? this.live["2-net"] };
  }
  constructor(private opts: Tier2MonitorOpts = {}) {
    this.heard = (opts.heard ?? []).slice().sort((a, b) => b.start - a.start).slice(0, TIER2_HEARD_MAX);
  }

  /** One journal entry (already JSON.parse'd). */
  line(entry: unknown) { const e = parseLine(entry); if (e) this.apply(e); }

  apply(e: Tier2Event) {
    const ts = e.ts ?? Date.now();
    this.tick(ts);
    const slot = e.slot as 1 | 2;
    const at = `${slot}-${e.src ?? "rf"}`;   // the watchdog is "net"
    const cur = slot ? this.live[at] ?? null : null;
    switch (e.kind) {
      case "voice_start": case "data_start": {
        const kind = e.kind === "voice_start" ? "voice" : "data";
        if (cur && e.late && same(cur, kind, e)) return;
        if (cur) this.close(at, ts, "lost");
        this.open(at, slot, kind, e, ts);
        return;
      }
      case "voice_end": {
        const start = ts - Math.round((e.dur ?? 0) * 1000);
        let c = cur;
        if (c && !same(c, "voice", e)) { this.close(at, Math.max(c.start, start), "lost"); c = null; }
        if (!c) this.open(at, slot, "voice", e, start);   // its header is not in the journal read
        this.close(at, ts, e.how === "end" && this.timedOut[at] ? "timeout" : e.how ?? "end", { dur: e.dur, ber: e.ber, loss: e.loss, rssi: e.rssi });
        return;
      }
      case "watchdog":
        if (cur) this.close(at, ts, "watchdog", e.dur != null ? { dur: e.dur, ber: e.ber, loss: e.loss } : {});
        return;
      case "data_end":
        if (cur?.kind === "data") this.close(at, ts, e.how ?? "end");
        return;
      case "timeout":
        if (cur) this.timedOut[at] = true;
        this.alert(ts, "warn", e.text);
        return;
      case "rejected": this.alert(ts, "warn", e.text); return;
      case "gps": this.alert(ts, "info", e.text); return;
      case "modem_error": this.alert(ts, "error", e.text); return;
      case "ta": { const c = this.slots[slot]; if (c) c.ta = e.ta ?? null; return; }
      case "host_restart": for (const k of Object.keys(this.live)) this.close(k, ts, "restart"); return;
      case "net": {
        const prev = this.nets.get(e.name!);
        // DMRGateway closes and reopens a network right after it falls: it stays down, with its reason, until it is up
        if (prev?.status === "down" && (e.status === "off" || e.status === "connecting")) return;
        this.nets.set(e.name!, { status: e.status!, since: prev && prev.status === e.status ? prev.since : ts, reason: e.reason ?? null });
        if (e.status === "down") this.alert(ts, levelOf(e.level, "warn"), e.text);
        return;
      }
      case "tx": if (this.modem.tx !== e.on || this.modem.since === null) this.modem = { ...this.modem, tx: !!e.on, since: ts }; return;
      case "mode": this.modem = { ...this.modem, mode: e.mode ?? null }; return;
      case "window_attach":
        this.window = { ...EMPTY_WINDOW, attached: true, sdr_rate: e.sdr_rate ?? null, rx_hz: e.rx_hz ?? null, tx_hz: e.tx_hz ?? null, tx_gain: e.tx_gain ?? null, at: ts };
        return;
      case "window_stats":
        this.window = { ...(this.window ?? EMPTY_WINDOW), attached: true, rx_lost: e.rx_lost ?? null, tx_late: e.tx_late ?? null, min_margin_ms: e.min_margin_ms ?? null, at: ts };
        return;
      case "window_off":
        this.window = { ...(this.window ?? EMPTY_WINDOW), attached: false, at: ts };
        this.alert(ts, levelOf(e.level, "warn"), e.text);
        return;
    }
  }

  /** The safety close: a call open longer than Timeout + 15 s lost its end line (a gap in the journal, a level change). */
  tick(now: number) {
    const limit = ((this.opts.timeoutS?.() ?? TIER2_TIMEOUT_DEFAULT_S) + TIER2_SAFETY_MARGIN_S) * 1000;
    for (const k of Object.keys(this.live)) {
      const c = this.live[k];
      if (c && now - c.start > limit) this.close(k, Math.min(now, c.start + limit), "timeout");
    }
  }

  private open(at: string, slot: 1 | 2, kind: "voice" | "data", e: Tier2Event, start: number) {
    const from = e.from ?? "", to = e.to ?? "", group = !!e.group, src = e.src ?? "rf";
    const to_id = partyId(to);
    this.live[at] = {
      key: `${slot}-${start}`, slot, src, kind, from, from_id: partyId(from), to, to_id, group,
      net: src === "net" ? this.opts.netOf?.(slot, group ? to_id : null) ?? null : null,
      start, end: null, dur: null, ber: null, loss: null, rssi: null, end_kind: null,
      blocks: kind === "data" ? e.blocks ?? null : null, ta: null, late: !!e.late,
    };
    this.timedOut[at] = false;
  }

  private close(at: string, end: number, kind: Tier2EndKind, st: { dur?: number | null; ber?: number | null; loss?: number | null; rssi?: Tier2Rssi | null } = {}) {
    const c = this.live[at];
    if (!c) return;
    this.live[at] = null;
    this.timedOut[at] = false;
    c.end = Math.max(end, c.start);
    c.end_kind = kind;
    c.dur = st.dur ?? Math.round((c.end - c.start) / 100) / 10;
    c.ber = st.ber ?? null;
    c.loss = st.loss ?? null;
    c.rssi = st.rssi ?? null;
    // the same call read again (a restart with the persisted list, or its header outside the backlog read), or the
    // end line of one the safety close had already closed (any end then): replaced
    const i = this.heard.findIndex((h) => h.key === c.key || (h.slot === c.slot && h.kind === c.kind && h.src === c.src && h.from === c.from
      && h.to === c.to && h.end !== null && (h.end_kind === "timeout" || Math.abs(h.end - c.end!) <= 1000) && Math.abs(h.start - c.start) <= 1000));
    if (i >= 0) this.heard[i] = c; else this.heard.push(c);
    this.heard.sort((a, b) => b.start - a.start);
    if (this.heard.length > TIER2_HEARD_MAX) this.heard.length = TIER2_HEARD_MAX;
    this.opts.onHeard?.();
  }

  /** Most recent first; the same text again (a login retried every few seconds) only moves its time. */
  private alert(ts: number, level: Tier2Alert["level"], text: string) {
    if (this.alerts[0]?.text === text) { this.alerts[0] = { ts, level, text }; return; }
    this.alerts.unshift({ ts, level, text });
    if (this.alerts.length > TIER2_ALERTS_MAX) this.alerts.length = TIER2_ALERTS_MAX;
  }
}

const same = (c: Tier2Call, kind: "voice" | "data", e: Tier2Event) =>
  c.kind === kind && c.src === e.src && c.from === e.from && c.to === e.to && c.group === !!e.group;

// ── Persistence (dmr-tier2-heard.json) ──

const validCall = (c: any): c is Tier2Call => !!c && typeof c === "object" && typeof c.key === "string" && (c.slot === 1 || c.slot === 2)
  && typeof c.from === "string" && typeof c.to === "string" && Number.isFinite(c.start) && Number.isFinite(c.end);

/** The persisted calls (up to 100), or [] without a readable file. */
export function loadHeard(file: string | null | undefined): Tier2Call[] {
  if (!file) return [];
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf-8"));
    return Array.isArray(j) ? j.filter(validCall).slice(0, TIER2_HEARD_MAX) : [];
  } catch { return []; }
}

/** Atomic: tmp + rename. */
export function saveHeard(file: string, heard: Tier2Call[]) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(heard), "utf-8");
  fs.renameSync(tmp, file);
}

// ── The line source ──

/** Starts reading: onLine for each line, onExit when the source ends by itself; returns the stop. */
export type LineSource = (onLine: (line: string) => void, onExit: (why: string) => void) => () => void;

/** A chunk -> lines splitter (UTF-8 safe across chunks; a runaway line without a newline is dropped). */
export function lineSplitter(onLine: (line: string) => void, maxLine = 1 << 20) {
  const dec = new StringDecoder("utf8");
  let buf = "";
  return (chunk: Buffer | string) => {
    buf += typeof chunk === "string" ? chunk : dec.write(chunk);
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    if (buf.length > maxLine) buf = "";
    for (const l of lines) if (l.trim()) onLine(l);
  };
}

/** nice -n 19 journalctl -f -o json -n 3000 of the four units of Tier II. */
export const journalSource: LineSource = (onLine, onExit) => {
  const p = spawn("nice", TIER2_JOURNAL_ARGS, { stdio: ["ignore", "pipe", "ignore"] });
  let done = false;
  const exit = (why: string) => { if (!done) { done = true; onExit(why); } };
  p.stdout?.on("data", lineSplitter(onLine));
  p.on("error", (e) => exit(e.message));
  p.on("close", (code) => exit(`journalctl ha terminado (código ${code})`));
  return () => { done = true; p.kill(); };
};

// ── The handler ──

export interface DmrTier2Deps {
  dmrState: () => DmrState;
  tier2: () => boolean;
  names: Pick<DmrNameCache, "lookup">;
  config: () => { station: Tier2Station; nets: Tier2ConfNet[] };
  source: LineSource;
  heardFile?: string | null;
  demo?: boolean;
  now?: () => number;
  idleMs?: number; restartMs?: number; persistMs?: number; cacheMs?: number;
}

const NO_STACK: DmrState = { installed: false, exists: false, enabled: false, version: null, active: false, degraded: false, missing: [] };
const NO_STATION: Tier2Station = { callsign: null, id: null, rx_hz: null, tx_hz: null, color_code: null, timeout_s: null, shared: false, display_level: null };

export function createDmrTier2(deps: DmrTier2Deps) {
  const now = deps.now ?? Date.now;
  const cacheMs = deps.cacheMs ?? TIER2_CACHE_MS;
  let stackMemo: { at: number; v: DmrState } | null = null;
  let cfgMemo: { at: number; v: ReturnType<DmrTier2Deps["config"]> } | null = null;
  const stack = (): DmrState => {
    const t = now();
    if (!stackMemo || t - stackMemo.at >= cacheMs) {
      let v = NO_STACK;
      try { v = deps.dmrState(); } catch { /* no systemd */ }
      stackMemo = { at: t, v };
    }
    return stackMemo.v;
  };
  const cfg = () => {
    const t = now();
    if (!cfgMemo || t - cfgMemo.at >= cacheMs) {
      let v: ReturnType<DmrTier2Deps["config"]> = { station: NO_STATION, nets: [] };
      try { v = deps.config(); } catch { /* unreadable conf */ }
      cfgMemo = { at: t, v };
    }
    return cfgMemo.v;
  };

  let monitor = new Tier2Monitor();
  let running = false, lastUse = 0, dirty = false;
  let stopSource: (() => void) | null = null;
  let restartTimer: NodeJS.Timeout | null = null, sweepTimer: NodeJS.Timeout | null = null, saveTimer: NodeJS.Timeout | null = null;

  function save() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (!dirty || !deps.heardFile) return;
    dirty = false;
    try { saveHeard(deps.heardFile, monitor.heard); }
    catch (e: any) { console.error(`dmr tier2: no se ha podido escribir ${deps.heardFile}: ${e?.message}`); }
  }
  const onHeard = () => {
    if (!deps.heardFile) return;
    dirty = true;
    if (!saveTimer) { saveTimer = setTimeout(save, deps.persistMs ?? TIER2_PERSIST_MS); saveTimer.unref?.(); }
  };
  const feed = (line: string) => {
    let j: unknown;
    try { j = JSON.parse(line); } catch { return; }   // not a journal entry
    try { monitor.line(j); } catch (e: any) { console.error(`dmr tier2: línea no procesada: ${e?.message}`); }
  };
  /** A clean state (the persisted calls + the backlog of the source) and the source. */
  function connect() {
    save();
    monitor = new Tier2Monitor({
      timeoutS: () => cfg().station.timeout_s ?? TIER2_TIMEOUT_DEFAULT_S,
      netOf: (slot, tg) => routeNetwork(slot, tg, cfg().nets.filter((n) => n.enabled)),
      heard: loadHeard(deps.heardFile), onHeard,
    });
    stopSource = deps.source(feed, (why) => {
      stopSource = null;
      if (!running) return;
      console.error(`dmr tier2: ${why}; se vuelve a leer el journal en ${(deps.restartMs ?? TIER2_RESTART_MS) / 1000} s`);
      restartTimer = setTimeout(() => { restartTimer = null; if (running) connect(); }, deps.restartMs ?? TIER2_RESTART_MS);
      restartTimer.unref?.();
    });
  }
  function start() {
    running = true;
    connect();
    sweepTimer = setInterval(sweep, 30000);
    sweepTimer.unref?.();
  }
  function stop() {
    running = false;
    if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
    if (sweepTimer) { clearInterval(sweepTimer); sweepTimer = null; }
    stopSource?.();
    stopSource = null;
    save();
  }
  /** Stops the source after idleMs without a GET, or out of Tier II. */
  function sweep() {
    if (running && (now() - lastUse > (deps.idleMs ?? TIER2_IDLE_MS) || !deps.tier2())) stop();
  }

  /** GET /api/dmr/tier2/state */
  function state(_req: Request, res: Response) {
    const st = stack();
    if (!st.installed) return res.status(503).json({ ok: false, reason: "not_installed", state: st, message: `La pila ${DMR.pkg} no está instalada` });
    if (!deps.tier2()) {
      if (running) stop();
      return res.status(503).json({ ok: false, reason: "tier3", state: st, message: "La estación DMR está en Tier III (DMR_TIER=3): este monitor es solo para Tier II (repetidor convencional)" });
    }
    if (!st.active) return res.status(503).json({ ok: false, reason: "stopped", state: st, message: `La pila ${DMR.name} está parada` });
    const t = now();
    lastUse = t;
    if (!running) start();
    monitor.tick(t);
    const { station, nets } = cfg();
    const m = monitor;
    const ids: number[] = [];
    for (const c of [m.slots[1], m.slots[2], ...m.heard]) {
      if (!c) continue;
      if (c.from_id !== null) ids.push(c.from_id);
      if (!c.group && c.to_id !== null && c.to_id < DMR_ID_MAX) ids.push(c.to_id);
    }
    const names: Record<string, DmrName> = deps.names.lookup(ids);
    res.json({
      ok: true, demo: !!deps.demo, now: t, stack: st, station,
      slots: { "1": m.slots[1], "2": m.slots[2] },
      heard: m.heard,
      nets: nets.map((n): Tier2Net => {
        const s = m.nets.get(n.name);
        return { ...n, status: n.enabled ? s?.status ?? "unknown" : "off", since: s?.since ?? null, reason: n.enabled && s?.status === "down" ? s.reason : null };
      }),
      modem: m.modem,
      window: station.shared ? m.window : null,
      alerts: m.alerts,
      names,
    });
  }

  return { state, stop, sweep, save, get running() { return running; }, get monitor() { return monitor; } };
}

// ── Demo (not Linux, or TETRA_DEMO=1) ──

const DEMO_USERS = [
  { id: 2141234, callsign: "EA1ABC", name: "Luis", city: "Oviedo" },
  { id: 2142345, callsign: "EA2BCD", name: "Iker", city: "Bilbao" },
  { id: 2143456, callsign: "EA3CDE", name: "Jordi", city: "Girona" },
  { id: 2144567, callsign: "EA4DEF", name: "Carmen", city: "Madrid" },
  { id: 2145678, callsign: "EA5EFG", name: "Vicente", city: "Valencia" },
  { id: 2145119, callsign: "EB5JKL", name: "Pilar", city: "Alicante" },
  { id: 2146789, callsign: "EA6FGH", name: "Toni", city: "Palma" },
  { id: 2147890, callsign: "EA7GHI", name: "Manuel", city: "Sevilla" },
  { id: 2148901, callsign: "EA8HIJ", name: "Yaiza", city: "Las Palmas" },
  { id: 2149012, callsign: "EA9IJK", name: "Ahmed", city: "Ceuta" },
];
const DEMO_TGS: Record<1 | 2, number[]> = { 1: [214, 2140], 2: [91, 9] };
export const DEMO_STACK: DmrState = { installed: true, exists: true, enabled: true, version: "0.6.0", active: true, degraded: false, missing: [] };
export const DEMO_STATION: Tier2Station = { callsign: "ED5ZAA", id: 214500, rx_hz: 430825000, tx_hz: 438425000, color_code: 1, timeout_s: 180, shared: true, display_level: 2 };
export const DEMO_NETS: Tier2ConfNet[] = [
  { n: 1, name: "ADN", address: "10.33.1.50", port: 62037, routes: "S1,S2", enabled: true },
  { n: 2, name: "Red 2", address: "192.0.2.20", port: 62031, routes: "S2:91", enabled: true },
];
export const DEMO_NAMES: Pick<DmrNameCache, "lookup"> = {
  lookup(ids) {
    const out: Record<string, DmrName> = {};
    for (const id of Array.from(ids)) {
      const u = DEMO_USERS.find((x) => x.id === id);
      if (u) out[String(id)] = { callsign: u.callsign, name: u.name, city: u.city, country: "Spain" };
    }
    return out;
  },
};
const DEMO_BACKLOG_MS = 20 * 60 * 1000;

/** The demo's journal: begin(t) the start of the stack, tick(t) one second of traffic (both slots, RF and network,
 *  ends, losses, watchdogs, data, the TX of the modem, the window's minute, the network 2 falling and coming back,
 *  now and then a rejection or a GPS fix), each line a "journalctl -o json" entry in the real formats. */
export function demoGenerator(rand: () => number = Math.random) {
  const pick = <T,>(a: T[]): T => a[Math.floor(rand() * a.length)];
  const line = (t: number, unit: string, text: string, level = "M") => JSON.stringify({
    __REALTIME_TIMESTAMP: String(Math.round(t) * 1000), SYSLOG_IDENTIFIER: unit,
    MESSAGE: `${level}: ${new Date(t).toISOString().replace("T", " ").slice(0, 23)} ${text}`,
  });
  type Live = { start: number; until: number; rf: boolean; data: boolean; from: string; to: string };
  const slots: Record<1 | 2, { call: Live | null; next: number }> = { 1: { call: null, next: 0 }, 2: { call: null, next: 0 } };
  let tx = false, txMinute = false, lastStats = 0, net: "up" | "down" | "opening" = "up", netNext = 0;
  const ber = () => (rand() < 0.7 ? rand() * 0.9 : rand() < 0.67 ? 1 + rand() * 3 : 5 + rand() * 4).toFixed(1);
  const end = (t: number, s: 1 | 2, c: Live): string[] => {
    const dur = ((t - c.start) / 1000).toFixed(1);
    const head = `DMR Slot ${s}, `;
    if (c.data) return [line(t, "mmdvm-host-1", c.rf ? `${head}ended RF data transmission from ${c.from} to ${c.to}` : `${head}ended network data transmission`)];
    if (c.rf) {
      if (rand() < 0.08) return [line(t, "mmdvm-host-1", `${head}RF voice transmission lost from ${c.from} to ${c.to}, ${dur} seconds, BER: ${ber()}%`)];
      const min = -(70 + Math.floor(rand() * 25)), max = min + 5 + Math.floor(rand() * 10);
      const rssi = rand() < 0.5 ? `, RSSI: ${min}/${max}/${Math.round((min + max) / 2)} dBm` : "";
      return [line(t, "mmdvm-host-1", `${head}received RF end of voice transmission from ${c.from} to ${c.to}, ${dur} seconds, BER: ${ber()}%${rssi}`)];
    }
    const loss = rand() < 0.8 ? 0 : 1 + Math.floor(rand() * 5);
    if (rand() < 0.06) return [line(t, "mmdvm-host-1", `${head}network watchdog has expired, ${dur} seconds, ${loss}% packet loss, BER: 0.0%`)];
    return [line(t, "mmdvm-host-1", `${head}received network end of voice transmission from ${c.from} to ${c.to}, ${dur} seconds, ${loss}% packet loss, BER: ${ber()}%`)];
  };
  return {
    begin(t: number): string[] {
      lastStats = t; netNext = t + 120000 + rand() * 120000;
      return [
        line(t, "mmdvm-multi", "Attached to the MiuraStation DMR window /dev/shm/miurastation-dmr (MiuraStation pid 4242, SDR at 600000 S/s, RX 430825000 Hz, TX 438425000 Hz, residual RX -7.3 Hz / TX 0.0 Hz, TX gain 0.500)"),
        line(t + 2, "mmdvm-host-1", "MMDVM-Host-20260713 is starting", "I"),
        line(t + 3, "mmdvm-iq-1", "Mode set to Idle"),
        line(t + 10, "dmrgateway", "ADN, Opening DMR Network"),
        line(t + 11, "dmrgateway", "Red 2, Opening DMR Network"),
        line(t + 400, "dmrgateway", "ADN, Logged into the master successfully"),
        line(t + 450, "dmrgateway", "Red 2, Logged into the master successfully"),
      ];
    },
    tick(t: number): string[] {
      const out: string[] = [];
      for (const s of [1, 2] as const) {
        const st = slots[s];
        if (st.call && t >= st.call.until) { out.push(...end(t, s, st.call)); st.call = null; st.next = t + 3000 + rand() * 12000; }
        else if (!st.call && t >= st.next && rand() < 0.12) {
          const u = pick(DEMO_USERS);
          if (rand() < 0.05) {
            const rf = rand() < 0.5;
            const c: Live = rf ? { start: t, until: t + 1000, rf, data: true, from: String(u.id), to: String(pick(DEMO_USERS).id) }
              : { start: t, until: t + 1000, rf, data: true, from: "16776907", to: "ALL" };
            out.push(line(t, "mmdvm-host-1", `DMR Slot ${s}, received ${rf ? "RF" : "network"} data header from ${c.from} to ${c.to}, ${rf ? 2 : 3} blocks`));
            st.call = c;
            continue;
          }
          const rf = rand() < 0.35;
          const priv = rf && rand() < 0.1;
          const from = rf && rand() < 0.2 ? u.callsign : String(u.id);
          const to = priv ? String(pick(DEMO_USERS.filter((x) => x !== u)).id) : `TG ${pick(DEMO_TGS[s])}`;
          const late = !rf && rand() < 0.1;
          st.call = { start: t, until: t + 2000 + rand() * 18000, rf, data: false, from, to };
          out.push(line(t, "mmdvm-host-1", `DMR Slot ${s}, received ${rf ? "RF" : "network"} ${late ? "late entry" : "voice header"} from ${from} to ${to}`));
          if (rand() < 0.4) out.push(line(t + 1, "mmdvm-host-1", `DMR Slot ${s}, Talker Alias "${u.callsign} ${u.name}"`));
        }
      }
      const busy = !!(slots[1].call || slots[2].call);
      if (busy && !tx) { out.push(line(t + 2, "mmdvm-iq-1", "Mode set to DMR"), line(t + 3, "mmdvm-multi", "TX ON")); tx = true; txMinute = true; }
      if (!busy && tx) { out.push(line(t + 2, "mmdvm-multi", "TX OFF"), line(t + 3, "mmdvm-iq-1", "Mode set to Idle")); tx = false; }
      if (t - lastStats >= 60000) {
        lastStats = t;
        const lost = rand() < 0.9 ? 0 : 1 + Math.floor(rand() * 3);
        out.push(line(t + 4, "mmdvm-multi", `MiuraStation DMR window, last minute: ${lost} RX blocks lost, 0 TX samples late, ${txMinute ? `minimum TX margin ${(30 + rand() * 10).toFixed(1)} ms` : "nothing transmitted"}`));
        txMinute = tx;
      }
      if (t >= netNext) {
        if (net === "up") { out.push(line(t + 5, "dmrgateway", "Red 2, Connection to the master has timed out, retrying connection", "E")); net = "down"; netNext = t + 15000; }
        else if (net === "down") { out.push(line(t + 5, "dmrgateway", "Red 2, Opening DMR Network")); net = "opening"; netNext = t + 5000; }
        else { out.push(line(t + 5, "dmrgateway", "Red 2, Logged into the master successfully")); net = "up"; netNext = t + 240000 + rand() * 120000; }
      }
      if (rand() < 1 / 300) out.push(line(t + 6, "mmdvm-host-1", `DMR Slot 1, RF user ${2140000 + Math.floor(rand() * 9999)} rejected for using TG 9990`));
      if (rand() < 1 / 400) out.push(line(t + 7, "mmdvm-host-1", "GPS position [39.469900,-0.376300] (Position error 15m)"));
      return out;
    },
  };
}

/** The demo as a line source: the last 20 minutes at once (the -n backlog), then one tick per second. */
export function demoSource(rand: () => number = Math.random, clock: () => number = Date.now): LineSource {
  return (onLine) => {
    const gen = demoGenerator(rand);
    const t0 = clock();
    gen.begin(t0 - DEMO_BACKLOG_MS).forEach(onLine);
    for (let t = t0 - DEMO_BACKLOG_MS + 1000; t < t0; t += 1000) gen.tick(t).forEach(onLine);
    const timer = setInterval(() => gen.tick(clock()).forEach(onLine), 1000);
    timer.unref?.();
    return () => clearInterval(timer);
  };
}

export const tier2Demo = () => process.platform !== "linux" || process.env.TETRA_DEMO === "1";

/** The production wiring: the real stack, MMDVM-Host-1.ini and dmr-tier3.conf, journalctl, the panel's one name
 *  cache and dmr-tier2-heard.json in the cwd; in demo the simulated stack and lines (nothing written). */
export function dmrTier2Routes(names: DmrNameCache) {
  if (tier2Demo()) {
    return createDmrTier2({
      demo: true, dmrState: () => DEMO_STACK, tier2: () => true, names: DEMO_NAMES,
      config: () => ({ station: DEMO_STATION, nets: DEMO_NETS }), source: demoSource(),
    });
  }
  return createDmrTier2({
    dmrState: realDmrState, tier2: () => dmrTier2(), names,
    config: () => { const conf = readDmrConf(); return { station: readTier2Station(TIER2_HOST_INI, conf, dmrShared()), nets: tier2Nets(conf) }; },
    source: journalSource, heardFile: path.join(process.cwd(), TIER2_HEARD_FILE),
  });
}
