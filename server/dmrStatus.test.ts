// node --test via tsx:  npm test
// The DMR dashboard's server side against a fake dmrtc status server on 127.0.0.1: /state with names from a
// temporary cache, the 503s, the relayed SSE with the panel events, the command whitelist and its checks, and the
// callsign cache (one query per ID, background, on disk).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as http from "http";
import type { AddressInfo } from "net";
import express from "express";
import type { DmrState } from "./dmrStation";
import {
  DMR_COMMANDS, DMR_ID_MAX, DMRTC_CFG, DMRTC_DEFAULT_PORT, parseControlPort, dmrtcUpstream, intArg, validateDmrCmd,
  parseRadioidUser, collectDmrIds, eventDmrIds, DmrNameCache, createDmrStatus, NAMES_QUEUE_MAX, type DmrName,
} from "./dmrStatus";

const UP: DmrState = { installed: true, exists: true, enabled: true, version: "0.3.0", active: true, degraded: false, missing: [] };
const DOWN: DmrState = { ...UP, active: false, enabled: false };

const STATE = {
  version: "0.3.0-1+de1663d", uptime_s: 42, headless: true, started: "2026-10-31T10:00:00.000Z", now: "2026-10-31T10:00:42.000Z",
  config: { system_code: 8, channel_number: 3 },
  channels: [{ channel_id: 1, physical_id: 0, logical_channel: 338, slots: [
    { slot: 1, index: 0, control: true, enabled: true, busy: false, state: "control", call: null },
    { slot: 2, index: 1, control: false, enabled: true, busy: true, state: "busy", call: { src: 2147005, dst: 2147006, type: "private", local: true } },
  ] }],
  registered: [{ id: 2147001, talkgroups: [214], dgna: [], registered_at: "2026-10-31T10:00:10.000Z", last_seen: "2026-10-31T10:00:40.000Z" }, { id: 2147002, talkgroups: [], dgna: [9] }],
  calls_active: [{ channel_id: 1, slot: 2, src: 2147005, dst: 2147006, type: "private" }, { channel_id: 2, slot: 1, src: 2147003, dst: 214, type: "group" }],
  private_calls: [{ dst: 2147008, src: 2147007 }],
  gateway: { enabled: true, logged_in: true },
  stats: { registrations: 2 },
  last_events: [
    { id: 1, ts: "2026-10-31T10:00:10.000Z", type: "registration", radio_id: 2147001, new: true },
    { id: 2, ts: "2026-10-31T10:00:11.000Z", type: "sms", src: 2147004, dst: 214, group: true, text: "hola" },
    { id: 3, ts: "2026-10-31T10:00:12.000Z", type: "sms", src: 2147004, dst: 2147009, group: false, text: "hola" },
    { id: 4, ts: "2026-10-31T10:00:13.000Z", type: "call_end", src: 2147010, dst: 91, type2: "x", duration_s: 3 },
    { id: 5, ts: "2026-10-31T10:00:14.000Z", type: "ping", radio_id: 2147011, ms: 120, ok: true },
    { id: 1500, ts: "2026-10-31T10:00:14.500Z", type: "ping", ok: false, timeout: true },
    { id: 6, ts: "2026-10-31T10:00:15.000Z", type: "mass_registration", cleared: [2147012, 50] },
  ],
};

test("control_port of dmrtc.cfg, else 4939; the cfg sits next to dmrtc.log", () => {
  assert.equal(DMRTC_CFG, "/var/lib/dmr-tier3/.config/dmrtc/dmrtc.cfg");
  assert.equal(parseControlPort("log_level = 2;\ncontrol_port = 4939;\nmmdvm_listen_port = 62031;\n"), 4939);
  assert.equal(parseControlPort("  control_port=5000 ;"), 5000);
  assert.equal(parseControlPort("control_port = 0;"), null);
  assert.equal(parseControlPort("control_port = 70000;"), null);
  assert.equal(parseControlPort("# control_port = 1;\nxcontrol_port = 2;"), null);
  assert.equal(parseControlPort(""), null);
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tlm-dmrtc-cfg-"));
  const cfg = path.join(d, "dmrtc.cfg");
  assert.deepEqual(dmrtcUpstream(cfg), { host: "127.0.0.1", port: DMRTC_DEFAULT_PORT }, "no cfg: the default");
  fs.writeFileSync(cfg, "control_port = 4940;\n");
  assert.deepEqual(dmrtcUpstream(cfg), { host: "127.0.0.1", port: 4940 });
  fs.rmSync(d, { recursive: true, force: true });
});

test("commands: the closed list, each argument checked, the panel's names mapped to dmrtc's, nothing else passed", () => {
  assert.equal(DMR_COMMANDS.length, 13);
  assert.equal(DMR_ID_MAX, 16777215);
  assert.equal(intArg("2147001", 1, DMR_ID_MAX), 2147001);
  assert.equal(intArg(16777216, 1, DMR_ID_MAX), null);
  assert.equal(intArg("1e3", 1, DMR_ID_MAX), null);
  assert.equal(intArg(1.5, 1, DMR_ID_MAX), null);
  assert.equal(intArg(true, 0, 1), null);
  const bad = (body: unknown, re: RegExp) => { const v = validateDmrCmd(body); assert.equal(v.ok, false, JSON.stringify(body)); assert.match((v as any).error, re, JSON.stringify(body)); };
  const good = (body: unknown) => { const v = validateDmrCmd(body); assert.equal(v.ok, true, JSON.stringify(v)); return (v as any).cmd; };
  bad(null, /Cuerpo no válido/);
  bad([], /Cuerpo no válido/);
  bad({}, /Comando no admitido$/);
  bad({ cmd: "stop" }, /Comando no admitido: stop/);
  bad({ cmd: "run; rm -rf /" }, /Comando no admitido: run\?\?rm\?-rf\?\?$/);
  bad({ cmd: "sendUDTMultipartMessage", text: "x", dst: 1 }, /Comando no admitido/, );
  bad({ cmd: "resetAuth" }, /Comando no admitido/);
  bad({ cmd: { toString: () => "pingRadio" } }, /Comando no admitido/);
  // no-argument commands: nothing of the body goes through
  for (const cmd of ["requestMassRegistration", "announceLocalTime", "announceSystemFreqs", "announceSystemMessage", "announceAdjacentSites", "requestStatusSnapshot"]) {
    assert.deepEqual(good({ cmd, password: "x", dst: 1, foo: "bar" }), { cmd });
  }
  // SMS
  assert.deepEqual(good({ cmd: "sendUDTShortMessage", password: "pw", dst: "2147001", text: " Hola ", extra: 1 }), { cmd: "sendUDTShortMessage", text: "Hola", dst: 2147001, group: false });
  assert.deepEqual(good({ cmd: "sendUDTShortMessage", dst: 214, text: "Hola", group: true, src: 0 }), { cmd: "sendUDTShortMessage", text: "Hola", dst: 214, group: true, src: 0 });
  assert.deepEqual(good({ cmd: "sendUDTShortMessage", dst: 214, text: "x".repeat(1000) }).text.length, 1000);
  bad({ cmd: "sendUDTShortMessage", dst: 2147001 }, /text: obligatorio/);
  bad({ cmd: "sendUDTShortMessage", dst: 2147001, text: "   " }, /text: obligatorio/);
  bad({ cmd: "sendUDTShortMessage", dst: 2147001, text: 5 }, /text: obligatorio/);
  bad({ cmd: "sendUDTShortMessage", dst: 2147001, text: "x".repeat(1001) }, /text: demasiado largo \(máximo 1000/);
  bad({ cmd: "sendUDTShortMessage", dst: 2147001, text: "a\x00b" }, /caracteres de control/);
  bad({ cmd: "sendUDTShortMessage", text: "Hola" }, /dst: debe ser un entero entre 1 y 16777215/);
  bad({ cmd: "sendUDTShortMessage", dst: 0, text: "Hola" }, /dst: debe ser/);
  bad({ cmd: "sendUDTShortMessage", dst: 16777216, text: "Hola" }, /dst: debe ser/);
  bad({ cmd: "sendUDTShortMessage", dst: "2147001; id", text: "Hola" }, /dst: debe ser/);
  bad({ cmd: "sendUDTShortMessage", dst: 1, text: "Hola", group: "yes" }, /group: debe ser true o false/);
  bad({ cmd: "sendUDTShortMessage", dst: 1, text: "Hola", src: -1 }, /src: debe ser un entero entre 0/);
  // DGNA: dgids -> talkgroups, up to 15, empty clears
  assert.deepEqual(good({ cmd: "sendUDTDGNA", dst: 2147001, dgids: [9, "214", 91], attach: true }), { cmd: "sendUDTDGNA", dst: 2147001, talkgroups: [9, 214, 91], attach: true });
  assert.deepEqual(good({ cmd: "sendUDTDGNA", dst: 2147001 }), { cmd: "sendUDTDGNA", dst: 2147001, talkgroups: [], attach: true });
  assert.deepEqual(good({ cmd: "sendUDTDGNA", dst: 2147001, talkgroups: [1], attach: false }).talkgroups, [1], "dmrtc's own name is accepted too");
  bad({ cmd: "sendUDTDGNA", dgids: [1] }, /dst: debe ser/);
  bad({ cmd: "sendUDTDGNA", dst: 2147001, dgids: "1 2 3" }, /dgids: debe ser una lista/);
  bad({ cmd: "sendUDTDGNA", dst: 2147001, dgids: [1.5] }, /dgids: debe ser una lista/);
  bad({ cmd: "sendUDTDGNA", dst: 2147001, dgids: [0] }, /dgids: debe ser una lista/);
  bad({ cmd: "sendUDTDGNA", dst: 2147001, dgids: ["a"] }, /dgids: debe ser una lista/);
  bad({ cmd: "sendUDTDGNA", dst: 2147001, dgids: Array.from({ length: 16 }, (_, i) => i + 1) }, /hasta 15/);
  bad({ cmd: "sendUDTDGNA", dst: 2147001, dgids: [1], attach: 1 }, /attach: debe ser/);
  // ping, status, auth, poll
  assert.deepEqual(good({ cmd: "pingRadio", id: 2147001 }), { cmd: "pingRadio", id: 2147001, group: false });
  assert.deepEqual(good({ cmd: "pingRadio", id: 214, group: true }), { cmd: "pingRadio", id: 214, group: true });
  bad({ cmd: "pingRadio" }, /id: debe ser/);
  bad({ cmd: "pingRadio", id: 1, group: "no" }, /group: debe ser/);
  assert.deepEqual(good({ cmd: "pollStatus", id: "2147001" }), { cmd: "pollStatus", id: 2147001 });
  assert.deepEqual(good({ cmd: "sendAuthCheck", id: 2147001, group: true }), { cmd: "sendAuthCheck", id: 2147001 });
  bad({ cmd: "pollStatus", id: 0 }, /id: debe ser/);
  bad({ cmd: "sendAuthCheck", id: "x" }, /id: debe ser/);
  assert.deepEqual(good({ cmd: "pollData", id: 2147001 }), { cmd: "pollData", id: 2147001, format: "nmea" });
  assert.deepEqual(good({ cmd: "pollData", id: 2147001, poll_format: "Status", src: 5 }), { cmd: "pollData", id: 2147001, format: "status", src: 5 });
  assert.deepEqual(good({ cmd: "pollData", id: 2147001, poll_format: 7 }), { cmd: "pollData", id: 2147001, format: 7 });
  assert.deepEqual(good({ cmd: "pollData", id: 2147001, format: "ip" }).format, "ip");
  bad({ cmd: "pollData", id: 2147001, poll_format: "gps" }, /poll_format: debe ser uno de nmea, binary/);
  bad({ cmd: "pollData", id: 2147001, poll_format: 16 }, /poll_format: debe ser/);
  bad({ cmd: "pollData", poll_format: "nmea" }, /id: debe ser/);
  // slots
  assert.deepEqual(good({ cmd: "setChannelEnabled", channel_id: 3, slot: 2, enabled: false, index: 5 }), { cmd: "setChannelEnabled", channel_id: 3, slot: 2, enabled: false }, "index never passed: channel_id + slot only");
  bad({ cmd: "setChannelEnabled", channel_id: 0, slot: 1, enabled: true }, /channel_id: debe ser un entero entre 1 y 32/);
  bad({ cmd: "setChannelEnabled", channel_id: 33, slot: 1, enabled: true }, /channel_id: debe ser/);
  bad({ cmd: "setChannelEnabled", slot: 1, enabled: true }, /channel_id: debe ser/);
  bad({ cmd: "setChannelEnabled", channel_id: 1, slot: 3, enabled: true }, /slot: debe ser 1 o 2/);
  bad({ cmd: "setChannelEnabled", channel_id: 1, slot: 0, enabled: true }, /slot: debe ser 1 o 2/);
  bad({ cmd: "setChannelEnabled", channel_id: 1, slot: 1 }, /enabled: debe ser true o false/);
  bad({ cmd: "setChannelEnabled", channel_id: 1, slot: 1, enabled: "true" }, /enabled: debe ser true o false/);
});

test("radioid.net answers and the IDs worth asking for (the src always, the dst only when it is a radio)", () => {
  assert.deepEqual(parseRadioidUser({ count: 1, results: [{ callsign: "ea5gvk", fname: "Joaquin ", surname: "", city: "Valencia", country: "Spain", id: 2147001 }] }),
    { callsign: "EA5GVK", name: "Joaquin", city: "Valencia", country: "Spain" });
  assert.deepEqual(parseRadioidUser({ callsign: "EB1CU", name: "Andoni" }), { callsign: "EB1CU", name: "Andoni" }, "a bare record");
  assert.deepEqual(parseRadioidUser({ callsign: "EB1CU", fname: "A", surname: "B", name: "ignored" }), { callsign: "EB1CU", name: "A B" });
  assert.equal(parseRadioidUser({ count: 0, results: [] }), null);
  assert.equal(parseRadioidUser({ results: [{ callsign: "" }] }), null);
  assert.equal(parseRadioidUser(null), null);
  assert.equal(parseRadioidUser("x"), null);
  assert.deepEqual(collectDmrIds(STATE).sort(), [2147001, 2147002, 2147003, 2147004, 2147005, 2147006, 2147007, 2147008, 2147009, 2147010, 2147011, 2147012, 50].sort(),
    "registered, private calls' dst, group calls' src only, private SMS dst, pings, mass registration; never a TG nor the event counter (1500)");
  assert.deepEqual(collectDmrIds(null), []);
  assert.deepEqual(collectDmrIds({ registered: "x", calls_active: [null, {}], last_events: [{ type: "log", msg: "x" }] }), []);
  assert.deepEqual(eventDmrIds({ type: "call_start", src: 2147001, dst: 2147002, type2: 0, ...{ type: "call_start" } }), [2147001], "a group call: the dst is a TG");
  assert.deepEqual(eventDmrIds({ type: "call_start", src: 2147001, dst: 2147002, ...{ type: "call_start" }, ...{} }), [2147001]);
  assert.deepEqual(eventDmrIds({ type: "deregistration", id: "2147003" }), [2147003], "no ts: not a pushed event, id is the radio");
  assert.deepEqual(eventDmrIds({ id: 1200, ts: "2026-10-31T10:00:14.000Z", type: "deregistration" }), [], "the event counter over the radio's id (3a)");
  assert.deepEqual(eventDmrIds({ id: 2147003, event_id: 1200, ts: "2026-10-31T10:00:14.000Z", type: "registration", new: false }), [2147003], "the counter moved to event_id");
  assert.deepEqual(eventDmrIds({ id: 1200, ts: "2026-10-31T10:00:14.000Z", type: "position", radio_id: 2147004, text: "$GPGGA" }), [2147004]);
  assert.deepEqual(eventDmrIds({ type: "announce", text: "x" }), []);
});

test("name cache: served from disk, misses queued in the background two at a time, one query per ID per TTL (failures too), written atomically", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tlm-dmrid-"));
  const file = path.join(d, "dmrid_cache.json");
  const fresh = Date.now() - 1000, stale = Date.now() - 25 * 3600 * 1000;
  fs.writeFileSync(file, JSON.stringify({ "2147001": { callsign: "EA5GVK", name: "Joaquin", ts: fresh }, "2147002": { callsign: "", ts: fresh }, "2147003": { callsign: "EA1OLD", ts: stale }, bogus: 1, "2147004": "x" }));
  const asked: number[] = [];
  let inflight = 0, maxInflight = 0;
  const fetcher = async (id: number): Promise<DmrName | null> => {
    asked.push(id); inflight++; maxInflight = Math.max(maxInflight, inflight);
    await new Promise((r) => setTimeout(r, 20));
    inflight--;
    if (id === 2147003) return { callsign: "EA1NEW" };
    if (id === 2147005) return { callsign: "EA5NEW", city: "Alicante" };
    if (id === 2147006) throw new Error("timeout");
    return null;
  };
  const cache = new DmrNameCache(file, fetcher, { concurrency: 2 });
  const got = cache.lookup([2147001, 2147002, 2147003, 2147005, 2147006, 2147007, 214, 50, 2147001]);
  assert.deepEqual(got, { "2147001": { callsign: "EA5GVK", name: "Joaquin" }, "2147003": { callsign: "EA1OLD" } }, "what is known now: the stale one too, the miss and the TG not");
  assert.equal(cache.pending, 4, "the stale one and the three unknown are queued; the fresh miss is not; a TG never");
  await cache.flush();
  assert.deepEqual(asked.sort(), [2147003, 2147005, 2147006, 2147007]);
  assert.equal(maxInflight, 2);
  assert.deepEqual(cache.lookup([2147003, 2147005, 2147006, 2147007]), { "2147003": { callsign: "EA1NEW" }, "2147005": { callsign: "EA5NEW", city: "Alicante" } });
  assert.equal(cache.pending, 0, "a failure and a miss are not asked again within the TTL");
  cache.lookup([2147005, 2147006, 2147007]);
  await cache.flush();
  assert.equal(asked.length, 4, "nothing asked twice");
  cache.save();
  const onDisk = JSON.parse(fs.readFileSync(file, "utf-8"));
  assert.equal(onDisk["2147005"].callsign, "EA5NEW");
  assert.equal(onDisk["2147006"].callsign, "", "a failure is remembered with its time");
  assert.ok(typeof onDisk["2147006"].ts === "number" && Date.now() - onDisk["2147006"].ts < 5000);
  assert.equal(onDisk["2147001"].name, "Joaquin");
  assert.equal(onDisk.bogus, undefined);
  assert.deepEqual(fs.readdirSync(d), ["dmrid_cache.json"], "no temporary file left");
  // a second instance reads it back
  const again = new DmrNameCache(file, async () => { throw new Error("never"); });
  assert.deepEqual(again.get(2147005), { callsign: "EA5NEW", city: "Alicante" });
  assert.equal(again.get(2147006), null);
  assert.equal(again.lookup([2147005, 2147006]) && again.pending, 0);
  // an unreadable cache starts empty
  const none = new DmrNameCache(path.join(d, "missing", "x.json"), async () => null);
  assert.deepEqual(none.lookup([2147001]), {});
  await none.flush();
  none.save();
  fs.rmSync(d, { recursive: true, force: true });
});

test("name cache: the queue is capped and expired misses are dropped from the file", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tlm-dmrid-"));
  const file = path.join(d, "dmrid_cache.json");
  const stale = Date.now() - 25 * 3600 * 1000;
  fs.writeFileSync(file, JSON.stringify({ "2147001": { callsign: "EA5GVK", ts: stale }, "2147002": { callsign: "", ts: stale }, "2147003": { callsign: "", ts: Date.now() } }));
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => { release = r; });
  const asked: number[] = [];
  const cache = new DmrNameCache(file, async (id) => { asked.push(id); await gate; return null; }, { concurrency: 2 });
  assert.equal(cache.get(2147001)?.callsign, "EA5GVK", "a stale hit is kept (served while it is refreshed)");
  assert.equal(cache.lookup([2147003]) && cache.pending, 0, "a fresh miss is not asked again");
  // a flood of unknown IDs (what /api/dmr/names could bring without a password): the queue stops at the cap
  const flood = Array.from({ length: NAMES_QUEUE_MAX + 300 }, (_, i) => 3000000 + i);
  cache.lookup(flood);
  assert.equal(cache.pending, NAMES_QUEUE_MAX + 2, "the cap plus the two in flight");
  cache.lookup([2147002]);
  assert.equal(cache.pending, NAMES_QUEUE_MAX + 2, "the expired miss has to wait for room");
  release();
  await cache.flush();
  assert.equal(asked.length, NAMES_QUEUE_MAX + 2);
  cache.save();
  const onDisk = JSON.parse(fs.readFileSync(file, "utf-8"));
  assert.equal(onDisk["2147002"], undefined, "the expired miss was dropped at load");
  assert.equal(onDisk["2147003"].callsign, "", "the fresh miss stays");
  fs.rmSync(d, { recursive: true, force: true });
});

// ── Against a fake dmrtc: the handlers in an Express app ──

interface Fake { server: http.Server; port: number; cmds: any[]; eventsOpen: number; eventsClosed: number; hold: boolean; close: () => Promise<void> }
function fakeDmrtc(): Promise<Fake> {
  const f: Fake = { server: null as any, port: 0, cmds: [], eventsOpen: 0, eventsClosed: 0, hold: false, close: () => Promise.resolve() };
  f.server = http.createServer((req, res) => {
    const json = (code: number, body: unknown) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", Connection: "close" }); res.end(JSON.stringify(body)); };
    if (req.method === "GET" && req.url === "/state") return json(200, STATE);
    if (req.method === "GET" && req.url === "/slow") return; // never answers
    if (req.method === "GET" && req.url === "/events") {
      f.eventsOpen++;
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
      res.write(`event: hello\ndata: ${JSON.stringify(STATE)}\n\n`);
      res.write(`id: 7\nevent: registration\ndata: {"id":2147001,"new":true,"ts":"2026-10-31T10:00:10.000Z","type":"registration"}\n\n`);
      res.write(`: ping 2026-10-31T10:00:11.000Z\n\n`);
      res.write(`id: 8\nevent: call_start\ndata: {"src":2147005,"dst":214,"type":"call_start"}\n\n`);
      res.on("close", () => f.eventsClosed++);
      if (!f.hold) setTimeout(() => res.end(), 50);
      return;
    }
    if (req.method === "POST" && req.url === "/cmd") {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        const b = JSON.parse(body);
        f.cmds.push(b);
        if (b.cmd === "sendAuthCheck") return json(400, { ok: false, cmd: b.cmd, error: "'id' is not in auth_keys" });
        if (b.cmd === "pollStatus") { res.writeHead(500, { "Content-Type": "text/plain" }); return res.end("boom"); }
        json(200, { ok: true, cmd: b.cmd, queued: true, echo: b });
      });
      return;
    }
    json(404, { ok: false, error: "not found" });
  });
  return new Promise((resolve) => f.server.listen(0, "127.0.0.1", () => {
    f.port = (f.server.address() as AddressInfo).port;
    f.close = () => new Promise((r) => { f.server.closeAllConnections(); f.server.close(() => r()); });
    resolve(f);
  }));
}

interface Panel { base: string; close: () => Promise<void>; state: DmrState; upstreamPort: number; cache: DmrNameCache; dir: string; release: () => void }
async function panel(fake: Fake): Promise<Panel> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tlm-dmr-panel-"));
  const file = path.join(dir, "dmrid_cache.json");
  fs.writeFileSync(file, JSON.stringify({ "2147001": { callsign: "EA5GVK", name: "Joaquin", ts: Date.now() } }));
  const asked: number[] = [];
  // the fetcher waits for release(): the test sees the queue while the request has already been answered
  let release = () => {};
  let gate = new Promise<void>((r) => { release = r; });
  const cache = new DmrNameCache(file, async (id) => { asked.push(id); await gate; return id === 2147005 ? { callsign: "EA5NEW" } : null; });
  const p: Panel = { base: "", close: () => Promise.resolve(), state: UP, upstreamPort: fake.port, cache, dir, release: () => { release(); gate = Promise.resolve(); } };
  const h = createDmrStatus({ dmrState: () => p.state, getPassword: () => "pw", upstream: () => ({ host: "127.0.0.1", port: p.upstreamPort }), names: cache });
  const app = express();
  app.use(express.json());
  app.get("/api/dmr/state", h.state);
  app.get("/api/dmr/events", h.events);
  app.post("/api/dmr/cmd", h.cmd);
  app.get("/api/dmr/names", h.names);
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  p.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  p.close = () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); cache.save(); fs.rmSync(dir, { recursive: true, force: true }); });
  return p;
}
/** The whole SSE body of a GET, or what arrived before `until` matched (then the client hangs up). */
function sse(url: string, until?: RegExp): Promise<{ status: number; headers: http.IncomingHttpHeaders; text: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let text = "";
      res.setEncoding("utf-8");
      res.on("data", (c) => { text += c; if (until && until.test(text)) { req.destroy(); resolve({ status: res.statusCode!, headers: res.headers, text }); } });
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, text }));
      res.on("error", () => resolve({ status: res.statusCode!, headers: res.headers, text }));
    });
    req.on("error", (e) => { if (!until) reject(e); });
  });
}
const panelEvents = (text: string) => text.split("\n\n").filter((b) => b.startsWith("event: panel\n")).map((b) => JSON.parse(b.replace(/^event: panel\ndata: /, "")));
const post = (base: string, body: unknown) => fetch(`${base}/api/dmr/cmd`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("GET /api/dmr/state: dmrtc's JSON as is plus names (from the cache, the rest queued) and panel; 503 stopped / unreachable", async () => {
  const fake = await fakeDmrtc();
  const p = await panel(fake);
  try {
    let r = await fetch(`${p.base}/api/dmr/state`);
    assert.equal(r.status, 200);
    let j: any = await r.json();
    assert.equal(j.version, STATE.version);
    assert.deepEqual(j.registered, STATE.registered);
    assert.deepEqual(j.last_events, STATE.last_events, "as is");
    assert.deepEqual(j.names, { "2147001": { callsign: "EA5GVK", name: "Joaquin" } }, "only what the cache knows");
    assert.ok(typeof j.panel.latency_ms === "number" && j.panel.latency_ms >= 0 && j.panel.latency_ms < 2000);
    assert.ok(!Number.isNaN(Date.parse(j.panel.fetched_at)) && j.panel.fetched_at.endsWith("Z"));
    assert.equal(j.panel.port, fake.port);
    assert.ok(p.cache.pending > 0, "the unknown IDs are being resolved in the background");
    p.release();
    await p.cache.flush();
    r = await fetch(`${p.base}/api/dmr/state`);
    j = await r.json();
    assert.deepEqual(j.names, { "2147001": { callsign: "EA5GVK", name: "Joaquin" }, "2147005": { callsign: "EA5NEW" } }, "resolved by the next call");
    assert.equal(p.cache.pending, 0);
    // names endpoint
    r = await fetch(`${p.base}/api/dmr/names?ids=2147001,2147005,2147099,%202147001`);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { "2147001": { callsign: "EA5GVK", name: "Joaquin" }, "2147005": { callsign: "EA5NEW" } });
    for (const q of ["", "ids=", "ids=abc", "ids=2147001,x;y", "ids=0", "ids=16777216", `ids=${Array.from({ length: 201 }, (_, i) => 1000 + i).join(",")}`]) {
      r = await fetch(`${p.base}/api/dmr/names?${q}`);
      assert.equal(r.status, 400, q);
      assert.match((await r.json()).message, /ids/);
    }
    // stopped
    p.state = DOWN;
    r = await fetch(`${p.base}/api/dmr/state`);
    assert.equal(r.status, 503);
    j = await r.json();
    assert.equal(j.ok, false);
    assert.equal(j.reason, "stopped");
    assert.deepEqual(j.state, DOWN);
    assert.match(j.message, /parada/);
    // degraded counts as stopped (active false)
    p.state = { ...UP, active: false, degraded: true, missing: ["dmrtc.service"] };
    j = await (await fetch(`${p.base}/api/dmr/state`)).json();
    assert.equal(j.reason, "stopped");
    assert.deepEqual(j.state.missing, ["dmrtc.service"]);
    // unreachable: the port is closed
    p.state = UP;
    const closed = await fakeDmrtc();
    const deadPort = closed.port;
    await closed.close();
    p.upstreamPort = deadPort;
    r = await fetch(`${p.base}/api/dmr/state`);
    assert.equal(r.status, 503);
    j = await r.json();
    assert.equal(j.reason, "unreachable");
    assert.deepEqual(j.state, UP);
    assert.match(j.message, /dmrtc no responde en 127\.0\.0\.1:\d+/);
  } finally {
    await p.close();
    await fake.close();
  }
});

test("GET /api/dmr/events: panel {connected:true}, the upstream stream byte for byte, panel {connected:false} at the end; stopped; the upstream dies with the client", async () => {
  const fake = await fakeDmrtc();
  const p = await panel(fake);
  try {
    let r = await sse(`${p.base}/api/dmr/events`);
    assert.equal(r.status, 200);
    assert.match(String(r.headers["content-type"]), /^text\/event-stream/);
    assert.equal(r.headers["cache-control"], "no-cache, no-store");
    const blocks = r.text.split("\n\n").filter(Boolean);
    assert.match(blocks[0], /^event: panel\ndata: \{"connected":true,"host":"127\.0\.0\.1","port":\d+,"ts":"[^"]+"\}$/);
    assert.equal(blocks[1], `event: hello\ndata: ${JSON.stringify(STATE)}`);
    assert.equal(blocks[2], `id: 7\nevent: registration\ndata: {"id":2147001,"new":true,"ts":"2026-10-31T10:00:10.000Z","type":"registration"}`);
    assert.equal(blocks[3], `: ping 2026-10-31T10:00:11.000Z`, "comments pass as they are");
    assert.equal(blocks[4], `id: 8\nevent: call_start\ndata: {"src":2147005,"dst":214,"type":"call_start"}`);
    assert.match(blocks[5], /^event: panel\ndata: \{"connected":false,"reason":"upstream closed","ts":"[^"]+"\}$/);
    assert.equal(blocks.length, 6);
    assert.equal(fake.eventsOpen, 1);
    // stopped: one panel event and the end, nothing opened upstream
    p.state = DOWN;
    r = await sse(`${p.base}/api/dmr/events`);
    assert.equal(r.status, 200);
    const pe = panelEvents(r.text);
    assert.equal(pe.length, 1);
    assert.equal(pe[0].connected, false);
    assert.equal(pe[0].reason, "stopped");
    assert.deepEqual(pe[0].state, DOWN);
    assert.equal(r.text.split("\n\n").filter(Boolean).length, 1);
    assert.equal(fake.eventsOpen, 1);
    // unreachable
    p.state = UP;
    const closed = await fakeDmrtc();
    const deadPort = closed.port;
    await closed.close();
    p.upstreamPort = deadPort;
    r = await sse(`${p.base}/api/dmr/events`);
    assert.deepEqual(panelEvents(r.text).map((e) => [e.connected, e.reason]), [[false, "unreachable"]]);
    // the client hangs up on a stream that never ends: the upstream connection is closed
    p.upstreamPort = fake.port;
    fake.hold = true;
    const before = fake.eventsClosed;
    r = await sse(`${p.base}/api/dmr/events`, /event: call_start/);
    assert.equal(fake.eventsOpen, 2);
    assert.match(r.text, /"connected":true/);
    for (let i = 0; i < 50 && fake.eventsClosed === before; i++) await new Promise((w) => setTimeout(w, 20));
    assert.equal(fake.eventsClosed, before + 1, "upstream /events closed after the client left");
  } finally {
    await p.close();
    await fake.close();
  }
});

test("POST /api/dmr/cmd: the password, the whitelist and the checks before anything reaches dmrtc; the checked JSON relayed; dmrtc's refusals and silence", async () => {
  const fake = await fakeDmrtc();
  const p = await panel(fake);
  try {
    let r = await post(p.base, { cmd: "requestMassRegistration" });
    assert.equal(r.status, 401);
    assert.deepEqual(await r.json(), { ok: false, message: "Contraseña incorrecta" });
    r = await post(p.base, { password: "nope", cmd: "requestMassRegistration" });
    assert.equal(r.status, 401);
    r = await post(p.base, { password: "pw", cmd: "resetAuth" });
    assert.equal(r.status, 400);
    assert.match((await r.json()).message, /Comando no admitido: resetAuth/);
    r = await post(p.base, { password: "pw" });
    assert.equal(r.status, 400);
    r = await post(p.base, { password: "pw", cmd: "sendUDTShortMessage", dst: 16777216, text: "x" });
    assert.equal(r.status, 400);
    assert.match((await r.json()).message, /dst: debe ser/);
    r = await post(p.base, { password: "pw", cmd: "sendUDTShortMessage", dst: 2147001, text: "" });
    assert.equal(r.status, 400);
    assert.match((await r.json()).message, /text: obligatorio/);
    r = await post(p.base, { password: "pw", cmd: "sendUDTShortMessage", dst: 2147001, text: "x".repeat(1001) });
    assert.equal(r.status, 400);
    r = await post(p.base, { password: "pw", cmd: "sendUDTDGNA", dst: 2147001, dgids: [1, "b"] });
    assert.equal(r.status, 400);
    assert.match((await r.json()).message, /dgids/);
    r = await post(p.base, { password: "pw", cmd: "setChannelEnabled", channel_id: 0, slot: 1, enabled: true });
    assert.equal(r.status, 400);
    r = await post(p.base, { password: "pw", cmd: "setChannelEnabled", channel_id: 1, slot: 3, enabled: true });
    assert.equal(r.status, 400);
    assert.deepEqual(fake.cmds, [], "nothing reached dmrtc");
    // relayed: only the checked arguments, dmrtc's names
    r = await post(p.base, { password: "pw", cmd: "sendUDTShortMessage", dst: "2147001", text: " Hola ", group: false, extra: "no" });
    assert.equal(r.status, 200);
    let j: any = await r.json();
    assert.equal(j.ok, true);
    assert.equal(j.cmd, "sendUDTShortMessage");
    assert.equal(j.queued, true);
    assert.deepEqual(j.echo, { cmd: "sendUDTShortMessage", text: "Hola", dst: 2147001, group: false });
    r = await post(p.base, { password: "pw", cmd: "sendUDTDGNA", dst: 2147001, dgids: [9, 214], attach: true });
    assert.equal(r.status, 200);
    assert.deepEqual((await r.json()).echo, { cmd: "sendUDTDGNA", dst: 2147001, talkgroups: [9, 214], attach: true });
    r = await post(p.base, { password: "pw", cmd: "pollData", id: 2147001, poll_format: "status" });
    assert.deepEqual((await r.json()).echo, { cmd: "pollData", id: 2147001, format: "status" });
    r = await post(p.base, { password: "pw", cmd: "setChannelEnabled", channel_id: 3, slot: 2, enabled: false });
    assert.deepEqual((await r.json()).echo, { cmd: "setChannelEnabled", channel_id: 3, slot: 2, enabled: false });
    r = await post(p.base, { password: "pw", cmd: "announceLocalTime", id: 5 });
    assert.deepEqual((await r.json()).echo, { cmd: "announceLocalTime" });
    assert.equal(fake.cmds.length, 5);
    assert.ok(fake.cmds.every((c) => !("password" in c) && !("extra" in c)), "the password never leaves the panel");
    // dmrtc refuses (400) and fails (500 without JSON)
    r = await post(p.base, { password: "pw", cmd: "sendAuthCheck", id: 2147001 });
    assert.equal(r.status, 400);
    j = await r.json();
    assert.equal(j.ok, false);
    assert.equal(j.error, "'id' is not in auth_keys");
    assert.match(j.message, /dmrtc ha rechazado el comando: 'id' is not in auth_keys/);
    r = await post(p.base, { password: "pw", cmd: "pollStatus", id: 2147001 });
    assert.equal(r.status, 503);
    j = await r.json();
    assert.equal(j.ok, false);
    assert.equal(j.reason, "unreachable");
    assert.match(j.message, /HTTP 500 a \/cmd sin JSON/);
    // the port closed: unreachable with the stack up, stopped with it down
    const closed = await fakeDmrtc();
    const deadPort = closed.port;
    await closed.close();
    p.upstreamPort = deadPort;
    r = await post(p.base, { password: "pw", cmd: "requestMassRegistration" });
    assert.equal(r.status, 503);
    j = await r.json();
    assert.equal(j.reason, "unreachable");
    assert.match(j.message, /dmrtc no responde/);
    p.state = DOWN;
    r = await post(p.base, { password: "pw", cmd: "requestMassRegistration" });
    assert.equal(r.status, 503);
    assert.equal((await r.json()).reason, "stopped");
  } finally {
    await p.close();
    await fake.close();
  }
});
