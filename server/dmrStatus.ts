// The DMR dashboard's server side: the panel's client of the status server that dmrtc runs with "-h -s" on
// 127.0.0.1:control_port (4939; GET /health, /state, /events; POST /cmd, no authentication: the panel puts it).
// - /api/dmr/state: the /state JSON of dmrtc as is, plus "names" (the callsigns of the IDs in it that the cache
//   knows) and "panel" (when and how fast it was fetched); 503 when the stack is stopped or dmrtc does not answer.
// - /api/dmr/events: the /events SSE stream relayed byte for byte, framed by the panel's own "panel" events
//   ({connected:true} first, {connected:false, reason} last); the upstream socket dies with the client.
// - /api/dmr/cmd: the system password, a closed list of commands whose arguments are checked here (never a free
//   string to dmrtc), relayed to /cmd.
// - /api/dmr/names: the callsign cache (dmrid_cache.json in the panel's cwd), filled in the background from
//   radioid.net: one query per ID every 24 h at most (failures included), two at a time, never on the request path.
// Plain http.request of Node (no keep-alive, timeouts, destroyed on close); the handlers take their dependencies
// (dmrState, password, upstream address, cache) so the tests run them against a fake dmrtc.
import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import type { Request, Response } from "express";
import { DMR, dmrState as realDmrState, type DmrState } from "./dmrStation";

export const DMRTC_HOST = "127.0.0.1";
export const DMRTC_DEFAULT_PORT = 4939;
// gen-config.py writes "control_port = 4939;" (libconfig) in dmrtc.cfg, next to dmrtc.log.
export const DMRTC_CFG = path.posix.join(path.posix.dirname(DMR.dmrtcLog), "dmrtc.cfg");
export const DMR_ID_MAX = 16777215;
export const DMR_SMS_MAX = 1000;        // dmrtc: 'text' too long (max 1000 characters); it chunks in 46
export const DMR_DGNA_MAX = 15;         // dmrtc: at most 15 talkgroups per DGNA
export const DMR_CHANNEL_MAX = 32;      // dmrtc: index 0..63 = 32 channels x 2 slots (it also checks channel_number)
export const DMR_STATE_TIMEOUT_MS = 2000;
export const DMR_CMD_TIMEOUT_MS = 5000;
export const DMR_EVENTS_IDLE_MS = 60000; // dmrtc comments ": ping" every 15 s: silence this long = dead upstream
export const RADIOID_TTL_MS = 24 * 3600 * 1000;
export const RADIOID_TIMEOUT_MS = 4000;
export const RADIOID_MIN_ID = 1000;      // below that: talkgroups and lab IDs, never a radioid.net user
export const NAMES_QUERY_MAX = 200;

export interface Upstream { host: string; port: number }

/** The control_port of a dmrtc.cfg text ("control_port = 4939;"), or null. Pure. */
export function parseControlPort(text: string): number | null {
  const m = /^\s*control_port\s*=\s*(\d{1,5})\s*;/m.exec(text);
  if (!m) return null;
  const port = Number(m[1]);
  return port >= 1 && port <= 65535 ? port : null;
}

/** Where dmrtc listens: 127.0.0.1 and the control_port of its cfg (4939 when the cfg is missing or odd). */
export function dmrtcUpstream(cfgPath = DMRTC_CFG): Upstream {
  let port: number | null = null;
  try { port = parseControlPort(fs.readFileSync(cfgPath, "utf-8")); } catch { /* no cfg yet */ }
  return { host: DMRTC_HOST, port: port ?? DMRTC_DEFAULT_PORT };
}

// ── The HTTP client (one request, no keep-alive, a hard deadline) ──

export interface UpstreamReply { status: number; text: string; latency_ms: number }
const UPSTREAM_BODY_MAX = 4 * 1024 * 1024;

export function upstreamRequest(up: Upstream, opts: { method: "GET" | "POST"; path: string; body?: string; timeoutMs: number }): Promise<UpstreamReply> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    let done = false;
    const finish = (err: Error | null, reply?: UpstreamReply) => {
      if (done) return;
      done = true;
      clearTimeout(deadline);
      if (err) reject(err); else resolve(reply!);
    };
    const headers: Record<string, string> = { Accept: "application/json", Connection: "close" };
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json; charset=utf-8";
      headers["Content-Length"] = String(Buffer.byteLength(opts.body));
    }
    const req = http.request({ host: up.host, port: up.port, path: opts.path, method: opts.method, headers, agent: false, timeout: opts.timeoutMs }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size > UPSTREAM_BODY_MAX) { req.destroy(new Error("respuesta demasiado grande")); return; }
        chunks.push(c);
      });
      res.on("end", () => finish(null, { status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf-8"), latency_ms: Date.now() - t0 }));
      res.on("error", (e) => finish(e));
    });
    const deadline = setTimeout(() => req.destroy(new Error(`sin respuesta en ${opts.timeoutMs} ms`)), opts.timeoutMs);
    req.on("timeout", () => req.destroy(new Error(`sin respuesta en ${opts.timeoutMs} ms`)));
    req.on("error", (e: NodeJS.ErrnoException) => finish(new Error(e.code === "ECONNREFUSED" ? `conexión rechazada en ${up.host}:${up.port}` : e.message)));
    req.end(opts.body);
  });
}

// ── The commands (closed list, arguments checked here) ──

export const DMR_COMMANDS = [
  "requestMassRegistration", "sendUDTShortMessage", "sendUDTDGNA", "pingRadio", "pollStatus", "pollData", "sendAuthCheck",
  "announceLocalTime", "announceSystemFreqs", "announceSystemMessage", "announceAdjacentSites", "setChannelEnabled",
  "requestStatusSnapshot",
] as const;
export type DmrCommand = typeof DMR_COMMANDS[number];
export const DMR_POLL_FORMATS = ["nmea", "binary", "address", "4bcd", "iso7", "iso8", "ip", "utf16", "status"] as const;

export type CmdCheck = { ok: true; cmd: Record<string, unknown> } | { ok: false; error: string };

/** An integer in [min, max] from a number or a numeric string (dmrtc takes both), else null. */
export function intArg(v: unknown, min: number, max: number): number | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "boolean") return null;
  const n = typeof v === "number" ? v : typeof v === "string" && /^\s*\d{1,10}\s*$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}
const boolArg = (v: unknown, dflt: boolean): boolean | null => (v === undefined || v === null ? dflt : typeof v === "boolean" ? v : null);
const idErr = (name: string) => `${name}: debe ser un entero entre 1 y ${DMR_ID_MAX}`;

/** The body of POST /api/dmr/cmd as the JSON for dmrtc's /cmd, or the error (in Spanish) that stops it. Only the
 *  commands of DMR_COMMANDS, only their arguments, each checked against the ranges of the dmrtc API; `password`
 *  and anything else in the body is dropped. The panel's names (dgids, poll_format) become dmrtc's (talkgroups,
 *  format). Pure. */
export function validateDmrCmd(body: unknown): CmdCheck {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Cuerpo no válido" };
  const b = body as Record<string, unknown>;
  const name = typeof b.cmd === "string" ? b.cmd : "";
  if (!(DMR_COMMANDS as readonly string[]).includes(name)) {
    const shown = name.replace(/[^\w.-]/g, "?").slice(0, 40);
    return { ok: false, error: `Comando no admitido${shown ? `: ${shown}` : ""}` };
  }
  const cmd = name as DmrCommand;
  const out: Record<string, unknown> = { cmd };
  switch (cmd) {
    case "requestMassRegistration": case "announceLocalTime": case "announceSystemFreqs": case "announceSystemMessage":
    case "announceAdjacentSites": case "requestStatusSnapshot":
      break;
    case "sendUDTShortMessage": {
      const text = typeof b.text === "string" ? b.text.trim() : "";
      if (!text) return { ok: false, error: `text: obligatorio (1..${DMR_SMS_MAX} caracteres)` };
      if (text.length > DMR_SMS_MAX) return { ok: false, error: `text: demasiado largo (máximo ${DMR_SMS_MAX} caracteres)` };
      if (/[\x00-\x08\x0b-\x1f\x7f]/.test(text)) return { ok: false, error: "text: no puede tener caracteres de control" };
      const dst = intArg(b.dst, 1, DMR_ID_MAX);
      if (dst === null) return { ok: false, error: idErr("dst") };
      const group = boolArg(b.group, false);
      if (group === null) return { ok: false, error: "group: debe ser true o false" };
      out.text = text; out.dst = dst; out.group = group;
      if (b.src !== undefined && b.src !== null && b.src !== "") {
        const src = intArg(b.src, 0, DMR_ID_MAX);
        if (src === null) return { ok: false, error: `src: debe ser un entero entre 0 y ${DMR_ID_MAX}` };
        out.src = src;
      }
      break;
    }
    case "sendUDTDGNA": {
      const dst = intArg(b.dst, 1, DMR_ID_MAX);
      if (dst === null) return { ok: false, error: idErr("dst") };
      const raw = b.dgids !== undefined ? b.dgids : b.talkgroups;
      const list = raw === undefined || raw === null ? [] : raw;
      const err = `dgids: debe ser una lista de hasta ${DMR_DGNA_MAX} enteros entre 1 y ${DMR_ID_MAX} (vacía = borrar las DGNA de la radio)`;
      if (!Array.isArray(list) || list.length > DMR_DGNA_MAX) return { ok: false, error: err };
      const tgs: number[] = [];
      for (const v of list) {
        const n = intArg(v, 1, DMR_ID_MAX);
        if (n === null) return { ok: false, error: err };
        tgs.push(n);
      }
      const attach = boolArg(b.attach, true);
      if (attach === null) return { ok: false, error: "attach: debe ser true o false" };
      out.dst = dst; out.talkgroups = tgs; out.attach = attach;
      break;
    }
    case "pingRadio": {
      const id = intArg(b.id, 1, DMR_ID_MAX);
      if (id === null) return { ok: false, error: idErr("id") };
      const group = boolArg(b.group, false);
      if (group === null) return { ok: false, error: "group: debe ser true o false" };
      out.id = id; out.group = group;
      break;
    }
    case "pollStatus": case "sendAuthCheck": {
      const id = intArg(b.id, 1, DMR_ID_MAX);
      if (id === null) return { ok: false, error: idErr("id") };
      out.id = id;
      break;
    }
    case "pollData": {
      const id = intArg(b.id, 1, DMR_ID_MAX);
      if (id === null) return { ok: false, error: idErr("id") };
      const raw = b.poll_format !== undefined ? b.poll_format : b.format;
      let format: string | number = "nmea";
      if (raw !== undefined && raw !== null && raw !== "") {
        const asInt = intArg(raw, 0, 15);
        const asName = typeof raw === "string" ? raw.trim().toLowerCase() : "";
        if (asInt !== null) format = asInt;
        else if ((DMR_POLL_FORMATS as readonly string[]).includes(asName)) format = asName;
        else return { ok: false, error: `poll_format: debe ser uno de ${DMR_POLL_FORMATS.join(", ")} o un entero 0..15` };
      }
      out.id = id; out.format = format;
      if (b.src !== undefined && b.src !== null && b.src !== "") {
        const src = intArg(b.src, 0, DMR_ID_MAX);
        if (src === null) return { ok: false, error: `src: debe ser un entero entre 0 y ${DMR_ID_MAX}` };
        out.src = src;
      }
      break;
    }
    case "setChannelEnabled": {
      const channel = intArg(b.channel_id, 1, DMR_CHANNEL_MAX);
      if (channel === null) return { ok: false, error: `channel_id: debe ser un entero entre 1 y ${DMR_CHANNEL_MAX}` };
      const slot = intArg(b.slot, 1, 2);
      if (slot === null) return { ok: false, error: "slot: debe ser 1 o 2" };
      if (typeof b.enabled !== "boolean") return { ok: false, error: "enabled: debe ser true o false" };
      out.channel_id = channel; out.slot = slot; out.enabled = b.enabled;
      break;
    }
  }
  return { ok: true, cmd: out };
}

// ── The callsign cache (radioid.net) ──

export interface DmrName { callsign: string; name?: string; city?: string; country?: string }
interface CacheEntry extends Partial<DmrName> { ts: number }
export type NameFetcher = (id: number) => Promise<DmrName | null>;

/** The user record of radioid.net's /api/dmr/user/?id= answer ({results:[{callsign, fname, surname, city,
 *  country}]}, or the record itself), or null when it has none. Pure. */
export function parseRadioidUser(j: any): DmrName | null {
  const rec = j && typeof j === "object" ? (Array.isArray(j.results) ? j.results[0] : j) : null;
  const callsign = typeof rec?.callsign === "string" ? rec.callsign.trim().toUpperCase() : "";
  if (!callsign) return null;
  const out: DmrName = { callsign };
  const name = [rec.fname, rec.surname].filter((s) => typeof s === "string" && s.trim()).map((s: string) => s.trim()).join(" ")
    || (typeof rec.name === "string" ? rec.name.trim() : "");
  if (name) out.name = name;
  if (typeof rec.city === "string" && rec.city.trim()) out.city = rec.city.trim();
  if (typeof rec.country === "string" && rec.country.trim()) out.country = rec.country.trim();
  return out;
}

export async function fetchRadioidUser(id: number, timeoutMs = RADIOID_TIMEOUT_MS): Promise<DmrName | null> {
  const r = await fetch(`https://radioid.net/api/dmr/user/?id=${id}`, {
    signal: AbortSignal.timeout(timeoutMs), headers: { Accept: "application/json", "User-Agent": "tetra-live-monitor" },
  });
  if (!r.ok) throw new Error(`radioid.net HTTP ${r.status}`);
  return parseRadioidUser(await r.json());
}

/** {id: {callsign, name, city, country, ts}} on disk; an ID is asked to the fetcher once per TTL at most, found
 *  or not (ts with an empty callsign = a miss, not retried before the TTL), `concurrency` at a time, in the
 *  background: lookup() answers from memory at once and queues what is missing or stale. */
export class DmrNameCache {
  private entries = new Map<number, CacheEntry>();
  private queue: number[] = [];
  private queued = new Set<number>();
  private running = 0;
  private dirty = false;
  private saveTimer: NodeJS.Timeout | null = null;
  private idle: (() => void)[] = [];
  readonly file: string;
  readonly ttlMs: number;
  readonly concurrency: number;
  constructor(file: string, private fetcher: NameFetcher, opts: { ttlMs?: number; concurrency?: number } = {}) {
    this.file = file;
    this.ttlMs = opts.ttlMs ?? RADIOID_TTL_MS;
    this.concurrency = Math.max(1, opts.concurrency ?? 2);
    this.load();
  }
  private load() {
    try {
      const j = JSON.parse(fs.readFileSync(this.file, "utf-8"));
      for (const [k, v] of Object.entries(j ?? {})) {
        const id = Number(k);
        if (Number.isInteger(id) && v && typeof v === "object" && typeof (v as any).ts === "number") {
          const e = v as CacheEntry;
          this.entries.set(id, { ts: e.ts, callsign: typeof e.callsign === "string" ? e.callsign : "", ...(e.name ? { name: e.name } : {}), ...(e.city ? { city: e.city } : {}), ...(e.country ? { country: e.country } : {}) });
        }
      }
    } catch { /* no cache yet, or unreadable: starts empty */ }
  }
  /** Written at most once a second, atomically (tmp + rename). */
  private scheduleSave() {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => { this.saveTimer = null; this.save(); }, 1000);
    this.saveTimer.unref?.();
  }
  save() {
    if (!this.dirty) return;
    this.dirty = false;
    const obj: Record<string, CacheEntry> = {};
    this.entries.forEach((e, id) => { obj[String(id)] = e; });
    try {
      const tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(obj), "utf-8");
      fs.renameSync(tmp, this.file);
    } catch (e: any) { console.error(`dmrid_cache: no se ha podido escribir ${this.file}: ${e?.message}`); }
  }
  /** The known names of `ids` (misses and strangers left out); the unknown and the stale ones are queued. */
  lookup(ids: Iterable<number>): Record<string, DmrName> {
    const out: Record<string, DmrName> = {};
    const now = Date.now();
    for (const id of Array.from(new Set(ids))) {
      if (!Number.isInteger(id) || id < RADIOID_MIN_ID || id > DMR_ID_MAX) continue;
      const e = this.entries.get(id);
      if (e?.callsign) {
        const { ts: _ts, ...name } = e;
        out[String(id)] = name as DmrName;
      }
      if (!e || now - e.ts >= this.ttlMs) this.enqueue(id);
    }
    return out;
  }
  get(id: number): DmrName | null {
    const e = this.entries.get(id);
    if (!e?.callsign) return null;
    const { ts: _ts, ...name } = e;
    return name as DmrName;
  }
  get pending(): number { return this.queue.length + this.running; }
  private enqueue(id: number) {
    if (this.queued.has(id)) return;
    this.queued.add(id);
    this.queue.push(id);
    this.pump();
  }
  private pump() {
    while (this.running < this.concurrency && this.queue.length) {
      const id = this.queue.shift()!;
      this.running++;
      // the ts is set before asking: a slow or failing fetcher never gets the same ID twice within the TTL
      const prev = this.entries.get(id);
      this.entries.set(id, { ...(prev ?? {}), callsign: prev?.callsign ?? "", ts: Date.now() });
      this.fetcher(id).then((name) => {
        this.entries.set(id, { ...(name ?? { callsign: "" }), ts: Date.now() });
      }, () => {
        this.entries.set(id, { callsign: prev?.callsign ?? "", ts: Date.now() });
      }).finally(() => {
        this.running--;
        this.queued.delete(id);
        this.scheduleSave();
        this.pump();
        if (this.pending === 0) { const w = this.idle; this.idle = []; w.forEach((f) => f()); }
      });
    }
  }
  /** Resolves when nothing is queued nor running (tests). */
  flush(): Promise<void> { return this.pending === 0 ? Promise.resolve() : new Promise((r) => this.idle.push(r)); }
}

/** The radio IDs of a /state (registered, calls, private calls, the slots' calls, last_events): the src always,
 *  the dst only when it is a radio (a private call, an SMS to a radio); never the event counter. Pure. */
export function collectDmrIds(state: any): number[] {
  const ids = new Set<number>();
  const add = (v: unknown) => { const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN; if (Number.isInteger(n) && n > 0) ids.add(n); };
  const isPrivate = (t: unknown) => typeof t === "string" && t.startsWith("private");
  const call = (c: any) => { if (c && typeof c === "object") { add(c.src); if (isPrivate(c.type)) add(c.dst); } };
  if (!state || typeof state !== "object") return [];
  for (const r of Array.isArray(state.registered) ? state.registered : []) add(r?.id);
  for (const c of Array.isArray(state.calls_active) ? state.calls_active : []) call(c);
  for (const p of Array.isArray(state.private_calls) ? state.private_calls : []) { add(p?.src); add(p?.dst); }
  for (const ch of Array.isArray(state.channels) ? state.channels : []) for (const s of Array.isArray(ch?.slots) ? ch.slots : []) call(s?.call);
  for (const e of Array.isArray(state.last_events) ? state.last_events : []) addEventIds(e, add, call);
  return Array.from(ids);
}
/** The radio IDs of one /events event (same rules). */
export function eventDmrIds(e: any): number[] {
  const ids = new Set<number>();
  const add = (v: unknown) => { const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN; if (Number.isInteger(n) && n > 0) ids.add(n); };
  const call = (c: any) => { if (c && typeof c === "object") { add(c.src); if (typeof c.type === "string" && c.type.startsWith("private")) add(c.dst); } };
  addEventIds(e, add, call);
  return Array.from(ids);
}
function addEventIds(e: any, add: (v: unknown) => void, call: (c: any) => void) {
  if (!e || typeof e !== "object") return;
  switch (e.type) {
    case "registration": case "deregistration": case "ping": case "position":
      // dmrtc's pushEvent writes the event counter over "id" (3a): the radio is trusted under radio_id, or under
      // id when the counter has moved to event_id (or the object is not an event at all: no ts)
      if (e.radio_id !== undefined) add(e.radio_id);
      else if (e.event_id !== undefined || e.ts === undefined) add(e.id);
      break;
    case "call_start": case "call_end": case "call_stats": call(e); break;
    case "call_rejected": add(e.src); break;
    case "sms": add(e.src); if (e.group === false) add(e.dst); break;
    case "mass_registration": for (const id of Array.isArray(e.cleared) ? e.cleared : []) add(id); break;
  }
}

// ── The handlers ──

export interface DmrStatusDeps {
  dmrState: () => DmrState;
  getPassword: () => string;
  upstream: () => Upstream;
  names: DmrNameCache;
}

export function createDmrStatus(deps: DmrStatusDeps) {
  const stateOf = (): DmrState => {
    try { return deps.dmrState(); }
    catch { return { installed: false, exists: false, enabled: false, version: null, active: false, degraded: false, missing: [] }; }
  };
  const unreachable = (res: Response, state: DmrState, message: string) =>
    res.status(503).json({ ok: false, reason: state.active ? "unreachable" : "stopped", state, message });

  /** GET /api/dmr/state */
  async function state(_req: Request, res: Response) {
    const st = stateOf();
    if (!st.active) return res.status(503).json({ ok: false, reason: "stopped", state: st, message: `La pila ${DMR.name} está parada` });
    const up = deps.upstream();
    let r: UpstreamReply;
    try { r = await upstreamRequest(up, { method: "GET", path: "/state", timeoutMs: DMR_STATE_TIMEOUT_MS }); }
    catch (e: any) { return unreachable(res, st, `dmrtc no responde en ${up.host}:${up.port}: ${e?.message}`); }
    if (r.status !== 200) return unreachable(res, st, `dmrtc ha contestado HTTP ${r.status} a /state`);
    let json: any;
    try { json = JSON.parse(r.text); } catch { return unreachable(res, st, "dmrtc ha devuelto un /state que no es JSON"); }
    if (!json || typeof json !== "object" || Array.isArray(json)) return unreachable(res, st, "dmrtc ha devuelto un /state que no es un objeto");
    const names = deps.names.lookup(collectDmrIds(json));
    res.json({ ...json, names, panel: { fetched_at: new Date().toISOString(), latency_ms: r.latency_ms, host: up.host, port: up.port } });
  }

  /** GET /api/dmr/events (SSE) */
  function events(req: Request, res: Response) {
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    const panel = (data: Record<string, unknown>) => { if (!res.writableEnded) res.write(`event: panel\ndata: ${JSON.stringify({ ...data, ts: new Date().toISOString() })}\n\n`); };
    const st = stateOf();
    if (!st.active) {
      panel({ connected: false, reason: "stopped", state: st });
      res.end();
      return;
    }
    const up = deps.upstream();
    let finished = false, relayed = false;
    const upReq = http.request({ host: up.host, port: up.port, path: "/events", method: "GET", agent: false, timeout: DMR_EVENTS_IDLE_MS, headers: { Accept: "text/event-stream", Connection: "close" } });
    const finish = (reason: string) => {
      if (finished) return;
      finished = true;
      upReq.destroy();
      if (!res.writableEnded) {
        // a blank line first: whatever partial event the upstream left is closed before ours
        if (relayed) res.write("\n\n");
        panel({ connected: false, reason });
        res.end();
      }
    };
    upReq.on("response", (upRes) => {
      if (upRes.statusCode !== 200) { upRes.resume(); finish(`dmrtc ha contestado HTTP ${upRes.statusCode} a /events`); return; }
      panel({ connected: true, host: up.host, port: up.port });
      upRes.on("data", (chunk: Buffer) => {
        if (finished) return;
        relayed = true;
        if (!res.write(chunk)) { upRes.pause(); res.once("drain", () => upRes.resume()); }
      });
      upRes.on("end", () => finish("upstream closed"));
      upRes.on("close", () => finish("upstream closed"));
      upRes.on("error", (e) => finish(e.message));
    });
    upReq.on("timeout", () => finish(`sin datos de dmrtc en ${DMR_EVENTS_IDLE_MS / 1000} s`));
    upReq.on("error", (e: NodeJS.ErrnoException) => finish(e.code === "ECONNREFUSED" ? "unreachable" : e.message));
    upReq.end();
    // res "close" only: since Node 16 the request's own "close" means "body consumed", not "client gone"
    res.on("close", () => { finished = true; upReq.destroy(); });
  }

  /** POST /api/dmr/cmd */
  async function cmd(req: Request, res: Response) {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    if (!body.password || body.password !== deps.getPassword()) return res.status(401).json({ ok: false, message: "Contraseña incorrecta" });
    const v = validateDmrCmd(body);
    if (!v.ok) return res.status(400).json({ ok: false, message: v.error });
    const up = deps.upstream();
    let r: UpstreamReply;
    try { r = await upstreamRequest(up, { method: "POST", path: "/cmd", body: JSON.stringify(v.cmd), timeoutMs: DMR_CMD_TIMEOUT_MS }); }
    catch (e: any) { return unreachable(res, stateOf(), `dmrtc no responde en ${up.host}:${up.port}: ${e?.message}`); }
    let json: any = null;
    try { json = JSON.parse(r.text); } catch { /* not JSON */ }
    if (!json || typeof json !== "object") return unreachable(res, stateOf(), `dmrtc ha contestado HTTP ${r.status} a /cmd sin JSON`);
    const status = r.status === 200 ? 200 : r.status >= 400 && r.status <= 599 ? r.status : 502;
    const message = status === 200 ? undefined : `dmrtc ha rechazado el comando: ${typeof json.error === "string" ? json.error : `HTTP ${r.status}`}`;
    res.status(status).json({ ...(message ? { message } : {}), ...json, ok: status === 200 && json.ok !== false, cmd: v.cmd.cmd });
  }

  /** GET /api/dmr/names?ids=1,2,3 */
  function names(req: Request, res: Response) {
    const raw = typeof req.query.ids === "string" ? req.query.ids : "";
    const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (!parts.length || parts.length > NAMES_QUERY_MAX) return res.status(400).json({ message: `ids: de 1 a ${NAMES_QUERY_MAX} IDs DMR separados por comas` });
    const ids: number[] = [];
    for (const p of parts) {
      const n = intArg(p, 1, DMR_ID_MAX);
      if (n === null) return res.status(400).json({ message: `ids: '${p.replace(/[^\w.-]/g, "?").slice(0, 20)}' no es un ID DMR` });
      ids.push(n);
    }
    res.json(deps.names.lookup(ids));
  }

  return { state, events, cmd, names };
}

/** The production wiring: the real dmrState, the control_port of dmrtc.cfg, dmrid_cache.json in the cwd. */
export function dmrStatusRoutes(getPassword: () => string) {
  const names = new DmrNameCache(path.join(process.cwd(), "dmrid_cache.json"), fetchRadioidUser);
  return createDmrStatus({ dmrState: realDmrState, getPassword, upstream: () => dmrtcUpstream(), names });
}
