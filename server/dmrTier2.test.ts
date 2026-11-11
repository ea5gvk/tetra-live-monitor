// node --test via tsx:  npm test
// The DMR Tier II monitor: the parser against real journal entries of the Pi .75 (Tier II, MIURA+DMR) and synthetic
// ones of every LogMessage it reads (DMRSlot.cpp, DMRNetwork.cpp, patch 012 of MMDVM-Multi), the reducer (both
// slots, lost, watchdog, timeout, MMDVM-Host restarted mid-call, the safety close, a network falling and coming back,
// the talker alias), routeNetwork after NET_ROUTES, the handler against a fake line source (no journalctl) and the
// persistence of the last heard in a temporary directory.
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
  parseLine, partyId, routeNetwork, tier2Nets, parseIni, readTier2Station, Tier2Monitor, loadHeard, saveHeard, lineSplitter,
  createDmrTier2, demoGenerator, demoSource, DEMO_STACK, DEMO_STATION, DEMO_NETS, DEMO_NAMES, TIER2_JOURNAL_ARGS, TIER2_HEARD_MAX,
  type Tier2Event, type Tier2Station, type Tier2ConfNet, type LineSource,
} from "./dmrTier2";

// The study's fixture (journalctl -o json of the .75): _real:true are real lines, the rest follow DMRSlot.cpp /
// DMRNetwork.cpp exactly.
const FIXTURE = String.raw`{"__REALTIME_TIMESTAMP":"1794255171006780","SYSLOG_IDENTIFIER":"mmdvm-host-1","MESSAGE":"M: 2026-11-09 20:12:51.006 DMR Slot 2, received network voice header from 2149451 to TG 214","_real":true}
{"__REALTIME_TIMESTAMP":"1794255171077850","SYSLOG_IDENTIFIER":"mmdvm-host-1","MESSAGE":"M: 2026-11-09 20:12:51.077 DMR Slot 2, received network end of voice transmission from 2149451 to TG 214, 0.1 seconds, 0% packet loss, BER: 0.0%","_real":true}
{"__REALTIME_TIMESTAMP":"1794238721981591","SYSLOG_IDENTIFIER":"dmrgateway","MESSAGE":"M: 2026-11-09 15:38:41.981 ADN, Logged into the master successfully","_real":true}
{"__REALTIME_TIMESTAMP":"1794255171012000","SYSLOG_IDENTIFIER":"mmdvm-iq-1","MESSAGE":"M: 2026-11-09 20:12:51.012 Mode set to DMR","_real":true}
{"__REALTIME_TIMESTAMP":"1794255171056000","SYSLOG_IDENTIFIER":"mmdvm-multi","MESSAGE":"M: 2026-11-09 20:12:51.056 TX ON","_real":true}
{"__REALTIME_TIMESTAMP":"1794255174414000","SYSLOG_IDENTIFIER":"mmdvm-multi","MESSAGE":"M: 2026-11-09 20:12:54.414 TX OFF","_real":true}
{"__REALTIME_TIMESTAMP":"1794254073729000","SYSLOG_IDENTIFIER":"mmdvm-multi","MESSAGE":"M: 2026-11-09 19:54:33.729 MiuraStation DMR window, last minute: 0 RX blocks lost, 0 TX samples late, minimum TX margin 37.5 ms","_real":true}
{"__REALTIME_TIMESTAMP":"1794238715345000","SYSLOG_IDENTIFIER":"mmdvm-host-1","MESSAGE":"W: 2026-11-09 15:38:35.345 Cannot open ID lookup file - /var/lib/dmr-tier3/DMRIds.dat","_real":true}
{"__REALTIME_TIMESTAMP":"1794200000000000","SYSLOG_IDENTIFIER":"mmdvm-host-2","MESSAGE":"M: 2026-11-09 04:53:20.000 DMR Slot 1, received network data header from 16776907 to ALL, 3 blocks","_real":true}
{"__REALTIME_TIMESTAMP":"1794200000500000","SYSLOG_IDENTIFIER":"mmdvm-host-2","MESSAGE":"M: 2026-11-09 04:53:20.500 DMR Slot 1, ended network data transmission","_real":true}
{"__REALTIME_TIMESTAMP":"1794256000000000","SYSLOG_IDENTIFIER":"mmdvm-host-1","MESSAGE":"M: 2026-11-09 20:26:40.000 DMR Slot 1, received RF voice header from EA5GVK to TG 214","_real":false}
{"__REALTIME_TIMESTAMP":"1794256004200000","SYSLOG_IDENTIFIER":"mmdvm-host-1","MESSAGE":"M: 2026-11-09 20:26:44.200 DMR Slot 1, received RF end of voice transmission from EA5GVK to TG 214, 4.2 seconds, BER: 0.4%, RSSI: -63/-51/-55 dBm","_real":false}
{"__REALTIME_TIMESTAMP":"1794256010000000","SYSLOG_IDENTIFIER":"mmdvm-host-1","MESSAGE":"M: 2026-11-09 20:26:50.000 DMR Slot 2, received RF voice header from 2145007 to 2147005","_real":false}
{"__REALTIME_TIMESTAMP":"1794256013000000","SYSLOG_IDENTIFIER":"mmdvm-host-1","MESSAGE":"M: 2026-11-09 20:26:53.000 DMR Slot 2, RF voice transmission lost from 2145007 to 2147005, 3.0 seconds, BER: 6.1%","_real":false}
{"__REALTIME_TIMESTAMP":"1794256020000000","SYSLOG_IDENTIFIER":"mmdvm-host-1","MESSAGE":"M: 2026-11-09 20:27:00.000 DMR Slot 2, received network late entry from 2142345 to TG 2140","_real":false}
{"__REALTIME_TIMESTAMP":"1794256032000000","SYSLOG_IDENTIFIER":"mmdvm-host-1","MESSAGE":"M: 2026-11-09 20:27:12.000 DMR Slot 2, network watchdog has expired, 12.0 seconds, 4% packet loss, BER: 0.0%","_real":false}
{"__REALTIME_TIMESTAMP":"1794256040000000","SYSLOG_IDENTIFIER":"mmdvm-host-1","MESSAGE":"M: 2026-11-09 20:27:20.000 DMR Slot 1, RF user 1234567 rejected for using TG 9990","_real":false}
{"__REALTIME_TIMESTAMP":"1794256050000000","SYSLOG_IDENTIFIER":"mmdvm-host-1","MESSAGE":"M: 2026-11-09 20:27:30.000 DMR Slot 1, received RF data header from 2145007 to 2147005, 2 blocks","_real":false}
{"__REALTIME_TIMESTAMP":"1794256051000000","SYSLOG_IDENTIFIER":"mmdvm-host-1","MESSAGE":"M: 2026-11-09 20:27:31.000 DMR Slot 1, ended RF data transmission from 2145007 to 2147005","_real":false}
{"__REALTIME_TIMESTAMP":"1794256060000000","SYSLOG_IDENTIFIER":"dmrgateway","MESSAGE":"W: 2026-11-09 20:27:40.000 Red 2, Login to the master has failed, retrying login ...","_real":false}
{"__REALTIME_TIMESTAMP":"1794256070000000","SYSLOG_IDENTIFIER":"dmrgateway","MESSAGE":"E: 2026-11-09 20:27:50.000 ADN, Connection to the master has timed out, retrying connection","_real":false}
{"__REALTIME_TIMESTAMP":"1794256080000000","SYSLOG_IDENTIFIER":"mmdvm-host-1","MESSAGE":"M: 2026-11-09 20:28:00.000 GPS position [40.416000,-3.703000] (Position error 20m)","_real":false}
{"__REALTIME_TIMESTAMP":"1794229377542000","SYSLOG_IDENTIFIER":"mmdvm-multi","MESSAGE":"M: 2026-11-09 13:02:57.542 Attached to the MiuraStation DMR window /dev/shm/miurastation-dmr (MiuraStation pid 727839, SDR at 600000 S/s, RX 430812500 Hz, TX 438412500 Hz, residual RX -7.3 Hz / TX 0.0 Hz, TX gain 0.500)","_real":true}
{"__REALTIME_TIMESTAMP":"1794229457608000","SYSLOG_IDENTIFIER":"mmdvm-multi","MESSAGE":"M: 2026-11-09 13:04:17.608 MiuraStation DMR window closed","_real":true}`;
const FIXTURE_ENTRIES = FIXTURE.split("\n").map((l) => JSON.parse(l));

// Real lines of the .75 as "journalctl -o short" shows them (host, unit[pid]: MESSAGE).
const SHORT_RE = /^(\S+) \S+ ([^\s[]+)\[\d+\]: (.*)$/;
const short = (l: string) => { const m = SHORT_RE.exec(l)!; return { MESSAGE: m[3], SYSLOG_IDENTIFIER: m[2], __REALTIME_TIMESTAMP: String(Date.parse(m[1]) * 1000) }; };

/** Each key of `want` equals the same key of `got`. */
function like(got: unknown, want: Record<string, unknown>, msg?: string) {
  assert.ok(got && typeof got === "object", `${msg ?? ""}: null`);
  for (const [k, v] of Object.entries(want)) assert.deepEqual((got as any)[k], v, `${msg ?? ""} .${k}`);
}

const T0 = 1794256000000;
const utc = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(0, 23);
const entry = (ms: number, unit: string, text: string, level = "M") => ({ __REALTIME_TIMESTAMP: String(ms * 1000), SYSLOG_IDENTIFIER: unit, MESSAGE: `${level}: ${utc(ms)} ${text}` });
const host = (ms: number, text: string, level = "M") => entry(ms, "mmdvm-host-1", text, level);
const ev = (text: string, unit = "mmdvm-host-1", level = "M") => parseLine(entry(T0, unit, text, level)) as Tier2Event;

test("parser: the 24 entries of the study's fixture (real and synthetic)", () => {
  const got = FIXTURE_ENTRIES.map(parseLine);
  const want: (Record<string, unknown> | null)[] = [
    { kind: "voice_start", ts: 1794255171006, slot: 2, src: "net", from: "2149451", to: "214", group: true, late: false, level: "M", unit: "mmdvm-host-1" },
    { kind: "voice_end", slot: 2, src: "net", from: "2149451", to: "214", group: true, dur: 0.1, loss: 0, ber: 0, rssi: null, how: "end" },
    { kind: "net", name: "ADN", status: "up", reason: null },
    { kind: "mode", mode: "DMR" },
    { kind: "tx", on: true },
    { kind: "tx", on: false },
    { kind: "window_stats", rx_lost: 0, tx_late: 0, min_margin_ms: 37.5 },
    null,   // W: Cannot open ID lookup file
    { kind: "data_start", slot: 1, src: "net", from: "16776907", to: "ALL", group: false, blocks: 3 },
    { kind: "data_end", slot: 1, src: "net", how: "end" },
    { kind: "voice_start", slot: 1, src: "rf", from: "EA5GVK", to: "214", group: true, late: false },
    { kind: "voice_end", slot: 1, src: "rf", from: "EA5GVK", dur: 4.2, ber: 0.4, loss: null, rssi: { min: -63, max: -51, ave: -55 }, how: "end" },
    { kind: "voice_start", slot: 2, src: "rf", from: "2145007", to: "2147005", group: false },
    { kind: "voice_end", slot: 2, src: "rf", from: "2145007", to: "2147005", group: false, dur: 3, ber: 6.1, rssi: null, how: "lost" },
    { kind: "voice_start", slot: 2, src: "net", from: "2142345", to: "2140", group: true, late: true },
    { kind: "watchdog", slot: 2, dur: 12, loss: 4, ber: 0 },
    { kind: "rejected", slot: 1, id: 1234567, tg: 9990 },
    { kind: "data_start", slot: 1, src: "rf", from: "2145007", to: "2147005", group: false, blocks: 2 },
    { kind: "data_end", slot: 1, src: "rf", from: "2145007", to: "2147005", how: "end" },
    { kind: "net", name: "Red 2", status: "down", reason: "Login to the master has failed, retrying login ...", level: "W" },
    { kind: "net", name: "ADN", status: "down", reason: "Connection to the master has timed out, retrying connection", level: "E" },
    { kind: "gps", lat: 40.416, lon: -3.703 },
    { kind: "window_attach", pid: 727839, sdr_rate: 600000, rx_hz: 430812500, tx_hz: 438412500, tx_gain: 0.5 },
    { kind: "window_off", reason: null },
  ];
  assert.equal(got.length, want.length);
  want.forEach((w, i) => (w === null ? assert.equal(got[i], null, `#${i}`) : like(got[i], w, `#${i}`)));
});

test("parser: real lines of the .75 that are not traffic, and the units each family is read from", () => {
  const cases: [string, Record<string, unknown> | null][] = [
    ["2026-11-09T14:02:15+01:00 TMO-EA5GVK mmdvm-host-1[727697]: I: 2026-11-09 13:02:15.802 MMDVM-Host-20260713 is starting", { kind: "host_restart", level: "I" }],
    ["2026-11-09T14:02:52+01:00 TMO-EA5GVK mmdvm-host-1[727697]: I: 2026-11-09 13:02:52.396 MMDVM-Host is stopping", { kind: "host_restart" }],
    ["2026-11-09T14:02:52+01:00 TMO-EA5GVK mmdvm-host-1[727697]: M: 2026-11-09 13:02:52.856 Closing the MMDVM", { kind: "host_restart" }],
    // MMDVM-Host's own link to DMRGateway, not one of its networks
    ["2026-11-09T14:02:52+01:00 TMO-EA5GVK mmdvm-host-1[727697]: M: 2026-11-09 13:02:52.856 DMR, Closing DMR Network", null],
    ["2026-11-09T14:09:22+01:00 TMO-EA5GVK mmdvm-host-2[729553]: W: 2026-11-09 13:09:22.469 DMR Slot 1, unhandled network CSBK type - 0x28", null],
    ["2026-11-09T14:02:15+01:00 TMO-EA5GVK mmdvm-host-1[727697]: MQTT Error connecting: Connection refused", null],
    ["2026-11-09T14:02:17+01:00 TMO-EA5GVK mmdvm-host-1[727697]: I: 2026-11-09 13:02:17.853 Loaded 0 RSSI data mapping points from /var/lib/dmr-tier3/RSSI.dat", null],
    ["2026-11-09T14:02:56+01:00 TMO-EA5GVK dmrgateway[727831]: M: 2026-11-09 13:02:56.137 ADN XU4, Opening DMR Network", { kind: "net", name: "ADN XU4", status: "connecting" }],
    ["2026-11-09T14:02:15+01:00 TMO-EA5GVK dmrgateway[727694]: M: 2026-11-09 13:02:15.803 MMDVM Network, Opening", null],
    ["2026-11-09T14:02:25+01:00 TMO-EA5GVK dmrgateway[727694]: M: 2026-11-09 13:02:25.817 ADN, Logged into the master via DTC protocol successfully", { kind: "net", name: "ADN", status: "up" }],
    ["2026-11-09T14:05:34+01:00 TMO-EA5GVK dmrgateway[728110]: M: 2026-11-09 13:05:34.909 Pi45 b, Closing DMR Network", { kind: "net", name: "Pi45 b", status: "off" }],
    ["2026-11-09T14:02:52+01:00 TMO-EA5GVK mmdvm-multi[727695]: M: 2026-11-09 13:02:52.457 TX off", null],
    ["2026-11-09T14:02:17+01:00 TMO-EA5GVK mmdvm-multi[727695]: M: 2026-11-09 13:02:17.930 TX ON", { kind: "tx", on: true, ts: Date.parse("2026-11-09T13:02:17Z") }],
    ["2026-11-09T14:02:15+01:00 TMO-EA5GVK mmdvm-multi[727695]: I: 2026-11-09 13:02:15.798 Waiting up to 60 s for the MiuraStation DMR window /dev/shm/miurastation-dmr", null],
    ["2026-11-09T14:02:17+01:00 TMO-EA5GVK mmdvm-iq-1[727696]: M: 2026-11-09 13:02:17.843 Mode set to Idle", { kind: "mode", mode: "Idle" }],
    ["2026-11-09T14:02:52+01:00 TMO-EA5GVK mmdvm-iq-2[727699]: M: 2026-11-09 13:02:52.398 TX OFF", null],
    ["2026-11-09T14:02:52+01:00 TMO-EA5GVK systemd[1]: Stopped target dmr-tier3.target - DMR Tier III (dmrtc + MMDVM-Multi + MMDVM-IQ/Host por canal + DMRGateway; Tier II sin dmrtc).", null],
    ["2026-11-09T21:12:51+01:00 TMO-EA5GVK mmdvm-host-1[737023]: M: 2026-11-09 20:12:51.077 DMR Slot 2, received network end of voice transmission from 2149451 to TG 214, 0.1 seconds, 0% packet loss, BER: 0.0%", { kind: "voice_end", dur: 0.1 }],
  ];
  for (const [l, want] of cases) {
    const got = parseLine(short(l));
    if (want === null) assert.equal(got, null, l); else like(got, want, l);
  }
  // each family only from its own unit
  assert.equal(ev("TX ON", "mmdvm-iq-1"), null);
  assert.equal(ev("ADN, Opening DMR Network", "mmdvm-host-1"), null);
  assert.equal(ev("Mode set to DMR", "mmdvm-multi"), null);
  assert.equal(ev("DMR Slot 1, received RF voice header from 1 to TG 9", "dmrgateway"), null);
});

test("parser: every LogMessage read, ID or callsign, ALL, RSSI or not, private calls, no prefix, bytes, garbage", () => {
  like(ev("DMR Slot 1, received RF late entry from EA5GVK to TG 214"), { kind: "voice_start", src: "rf", late: true, from: "EA5GVK", to: "214", group: true });
  like(ev("DMR Slot 2, received network voice header from 2149451 to 2145007"), { kind: "voice_start", src: "net", group: false, to: "2145007" });
  like(ev("DMR Slot 1, received RF end of voice transmission from EA5GVK to 2147005, 1.2 seconds, BER: 0.0%"), { kind: "voice_end", group: false, to: "2147005", dur: 1.2, ber: 0, rssi: null, loss: null });
  like(ev("DMR Slot 1, RF voice transmission lost from 2145007 to TG 9, 0.5 seconds, BER: 12.3%, RSSI: -90/-80/-85 dBm"), { kind: "voice_end", how: "lost", to: "9", group: true, ber: 12.3, rssi: { min: -90, max: -80, ave: -85 } });
  like(ev("DMR Slot 1, network watchdog has expired"), { kind: "watchdog", slot: 1, dur: null, loss: null, ber: null });
  like(ev("DMR Slot 2, RF user has timed out"), { kind: "timeout", slot: 2, src: "rf" });
  like(ev("DMR Slot 1, network user has timed out"), { kind: "timeout", slot: 1, src: "net" });
  like(ev("DMR Slot 1, RF user 2145007 rejected"), { kind: "rejected", id: 2145007, tg: null });
  like(ev("DMR Slot 2, received network data header from 2145007 to TG 214, 4 blocks"), { kind: "data_start", group: true, to: "214", blocks: 4 });
  like(ev("DMR Slot 2, RF data transmission lost from 2145007 to 2147005"), { kind: "data_end", how: "lost", src: "rf" });
  like(ev("DMR Slot 2, ended RF data transmission"), { kind: "data_end", how: "end", src: "rf", from: undefined });
  like(ev('DMR Slot 1, Talker Alias "EA5GVK Quini"'), { kind: "ta", slot: 1, ta: "EA5GVK Quini" });
  like(ev("No reply from the modem for some time, resetting it", "mmdvm-host-1", "E"), { kind: "modem_error", level: "E" });
  for (const [t, reason] of [
    ["Red 3, Socket has failed, retrying connection to the master", "Socket has failed, retrying connection to the master"],
    ["XU4, Master is closing down", "Master is closing down"],
    ["Pi45, Could not lookup the address of the master", "Could not lookup the address of the master"],
    ["ADN, Login to the master via DTC protocol has failed, retrying network ...", "Login to the master via DTC protocol has failed, retrying network ..."],
    ["ADN, Socket has failed when writing data to the master, retrying connection", "Socket has failed when writing data to the master, retrying connection"],
  ]) like(ev(t, "dmrgateway", "E"), { kind: "net", status: "down", reason }, t);
  like(ev("MiuraStation DMR window, last minute: 2 RX blocks lost, 5 TX samples late, nothing transmitted", "mmdvm-multi"), { kind: "window_stats", rx_lost: 2, tx_late: 5, min_margin_ms: null });
  like(ev("MiuraStation DMR window lost: MiuraStation pid 42 is gone; MMDVM-Multi exits so that systemd starts it again", "mmdvm-multi", "W"), { kind: "window_off", reason: "MiuraStation pid 42 is gone" });
  like(ev("The MiuraStation DMR window /dev/shm/miurastation-dmr is not available after 60 s: No such file or directory", "mmdvm-multi", "E"), { kind: "window_off" });
  assert.equal(ev("The MiuraStation DMR window is set for 2 carriers and MMDVM-Multi has 1 channels", "mmdvm-multi", "W"), null);
  // no "M: <time> " prefix, no unit, no realtime (the UTC time of the line), MESSAGE as bytes
  like(parseLine({ MESSAGE: "DMR Slot 1, received RF voice header from 2145007 to TG 9", SYSLOG_IDENTIFIER: "mmdvm-host-1", __REALTIME_TIMESTAMP: "1794256000000123" }),
    { kind: "voice_start", level: null, ts: 1794256000000, to: "9" });
  like(parseLine({ MESSAGE: "M: 2026-11-09 20:12:51.006 TX ON" }), { kind: "tx", unit: "", ts: Date.UTC(2026, 10, 9, 20, 12, 51, 6) });
  like(parseLine({ MESSAGE: Array.from(Buffer.from("M: 2026-11-09 20:12:51.006 Mode set to DMR")), SYSLOG_IDENTIFIER: "mmdvm-iq-1" }), { kind: "mode", mode: "DMR" });
  for (const g of [null, undefined, 42, "x", [], {}, { MESSAGE: 5 }, { MESSAGE: "" }, { MESSAGE: "M: garbage" }, { MESSAGE: "DMR Slot 3, received RF voice header from 1 to TG 9" }]) {
    assert.equal(parseLine(g), null, JSON.stringify(g));
  }
  assert.equal(partyId("ALL"), 16777215);
  assert.equal(partyId("2145007"), 2145007);
  assert.equal(partyId("EA5GVK"), null);
});

test("reducer: calls on both slots, talker alias, the order of the last heard", () => {
  const mon = new Tier2Monitor({ netOf: (slot, tg) => (slot === 2 && tg === 91 ? "Red 2" : "ADN") });
  mon.line(host(T0, "DMR Slot 1, received RF voice header from 2145007 to TG 214"));
  mon.line(host(T0 + 500, "DMR Slot 2, received network voice header from 2149451 to TG 91"));
  like(mon.slots[1], { key: `1-${T0}`, src: "rf", kind: "voice", from_id: 2145007, to_id: 214, group: true, net: null, start: T0, end: null, end_kind: null, late: false });
  like(mon.slots[2], { src: "net", net: "Red 2", start: T0 + 500 });
  mon.line(host(T0 + 1000, 'DMR Slot 1, Talker Alias "EA5GVK Quini"'));
  assert.equal(mon.slots[1]!.ta, "EA5GVK Quini");
  mon.line(host(T0 + 3000, "DMR Slot 2, received network end of voice transmission from 2149451 to TG 91, 2.5 seconds, 1% packet loss, BER: 0.2%"));
  assert.equal(mon.slots[2], null);
  like(mon.heard[0], { key: `2-${T0 + 500}`, end: T0 + 3000, dur: 2.5, loss: 1, ber: 0.2, end_kind: "end", net: "Red 2" });
  mon.line(host(T0 + 4000, "DMR Slot 1, received RF end of voice transmission from 2145007 to TG 214, 4.0 seconds, BER: 0.3%, RSSI: -80/-70/-75 dBm"));
  assert.deepEqual(mon.heard.map((c) => c.slot), [2, 1], "most recent start first");
  like(mon.heard[1], { ta: "EA5GVK Quini", rssi: { min: -80, max: -70, ave: -75 }, dur: 4, loss: null });
  // a private call: no TG for the routes
  const seen: (number | null)[] = [];
  const m2 = new Tier2Monitor({ netOf: (_s, tg) => { seen.push(tg); return "ADN"; } });
  m2.line(host(T0, "DMR Slot 1, received network voice header from 2149451 to 2145007"));
  m2.line(host(T0, "DMR Slot 2, received network voice header from 2149451 to TG 214"));
  assert.deepEqual(seen, [null, 214]);
});

test("reducer: lost, watchdog with and without figures, user timed out, a header closes the open call, end without header", () => {
  const mon = new Tier2Monitor();
  mon.line(host(T0, "DMR Slot 1, received RF voice header from 2145007 to TG 214"));
  mon.line(host(T0 + 3000, "DMR Slot 1, RF voice transmission lost from 2145007 to TG 214, 3.0 seconds, BER: 6.1%"));
  like(mon.heard[0], { end_kind: "lost", dur: 3, ber: 6.1 });
  mon.line(host(T0 + 4000, "DMR Slot 2, received network late entry from 2142345 to TG 2140"));
  mon.line(host(T0 + 16000, "DMR Slot 2, network watchdog has expired, 12.0 seconds, 4% packet loss, BER: 0.0%"));
  like(mon.heard[0], { end_kind: "watchdog", dur: 12, loss: 4, ber: 0, late: true });
  mon.line(host(T0 + 20000, "DMR Slot 2, received network voice header from 2142345 to TG 2140"));
  mon.line(host(T0 + 22000, "DMR Slot 2, network watchdog has expired"));
  like(mon.heard[0], { end_kind: "watchdog", dur: 2, loss: null, ber: null });
  const n = mon.heard.length;
  mon.line(host(T0 + 23000, "DMR Slot 2, network watchdog has expired"));
  assert.equal(mon.heard.length, n, "a watchdog with no call open adds nothing");
  // timed out: the call goes on until its end line, which is then "timeout"
  mon.line(host(T0 + 30000, "DMR Slot 1, received RF voice header from 2145007 to TG 214"));
  mon.line(host(T0 + 210000, "DMR Slot 1, RF user has timed out"));
  assert.ok(mon.slots[1], "still open after the timeout line");
  like(mon.alerts[0], { level: "warn", text: "DMR Slot 1, RF user has timed out", ts: T0 + 210000 });
  mon.line(host(T0 + 212000, "DMR Slot 1, received RF end of voice transmission from 2145007 to TG 214, 182.0 seconds, BER: 0.1%"));
  like(mon.heard[0], { end_kind: "timeout", dur: 182 });
  // a new header of the same origin in a busy slot closes the previous call as lost; a late entry of the same call changes nothing
  mon.line(host(T0 + 300000, "DMR Slot 1, received network voice header from 2149451 to TG 214"));
  mon.line(host(T0 + 301000, "DMR Slot 1, received network late entry from 2149451 to TG 214"));
  assert.equal(mon.slots[1]!.start, T0 + 300000);
  mon.line(host(T0 + 302000, "DMR Slot 1, received network voice header from 2145007 to TG 9"));
  like(mon.heard[0], { from: "2149451", end_kind: "lost", end: T0 + 302000, dur: 2 });
  like(mon.slots[1], { from: "2145007", to: "9", src: "net" });
  // an end whose header is not in the journal read: the call starts dur before it
  const m2 = new Tier2Monitor();
  m2.line(host(T0 + 5000, "DMR Slot 2, received network end of voice transmission from 2149451 to TG 214, 4.5 seconds, 0% packet loss, BER: 0.0%"));
  like(m2.heard[0], { key: `2-${T0 + 500}`, start: T0 + 500, end: T0 + 5000, dur: 4.5, end_kind: "end" });
  // data: header + end, and the data lost
  m2.line(host(T0 + 6000, "DMR Slot 1, received RF data header from 2145007 to 2147005, 2 blocks"));
  like(m2.slots[1], { kind: "data", blocks: 2 });
  m2.line(host(T0 + 6500, "DMR Slot 1, ended RF data transmission from 2145007 to 2147005"));
  like(m2.heard[0], { kind: "data", end_kind: "end", blocks: 2, dur: 0.5 });
  m2.line(host(T0 + 7000, "DMR Slot 1, received RF data header from 2145007 to 2147005, 3 blocks"));
  m2.line(host(T0 + 7300, "DMR Slot 1, RF data transmission lost from 2145007 to 2147005"));
  like(m2.heard[0], { kind: "data", end_kind: "lost", blocks: 3 });
});

test("reducer: MMDVM-Host restarted mid-call closes both slots; the safety close after Timeout + 15 s", () => {
  const mon = new Tier2Monitor({ timeoutS: () => 10 });
  mon.line(host(T0, "DMR Slot 1, received RF voice header from 2145007 to TG 214"));
  mon.line(host(T0 + 1000, "DMR Slot 2, received network voice header from 2149451 to TG 91"));
  mon.line(host(T0 + 2000, "MMDVM-Host is stopping", "I"));
  assert.deepEqual([mon.slots[1], mon.slots[2]], [null, null]);
  assert.deepEqual(mon.heard.map((c) => [c.slot, c.end_kind, c.end]), [[2, "restart", T0 + 2000], [1, "restart", T0 + 2000]]);
  mon.line(host(T0 + 3000, "DMR Slot 1, received RF voice header from 2145007 to TG 214"));
  mon.line(host(T0 + 4000, "MMDVM-Host-20260713 is starting", "I"));
  like(mon.heard[0], { end_kind: "restart", start: T0 + 3000 });
  // safety: 10 s + 15 s
  mon.line(host(T0 + 10000, "DMR Slot 2, received network voice header from 2149451 to TG 91"));
  mon.tick(T0 + 10000 + 24000);
  assert.ok(mon.slots[2], "not yet");
  mon.tick(T0 + 10000 + 26000);
  assert.equal(mon.slots[2], null);
  like(mon.heard[0], { end_kind: "timeout", end: T0 + 10000 + 25000, dur: 25 });
  // a later line does it too (the backlog), with the end bounded to the limit
  mon.line(host(T0 + 50000, "DMR Slot 1, received RF voice header from 2145007 to TG 214"));
  mon.line(entry(T0 + 50000 + 3600000, "mmdvm-multi", "TX OFF"));
  like(mon.heard[0], { end_kind: "timeout", end: T0 + 50000 + 25000 });
});

test("reducer: a network falls and comes back, the modem, the window, the alerts", () => {
  const mon = new Tier2Monitor();
  const gw = (ms: number, text: string, level = "M") => mon.line(entry(ms, "dmrgateway", text, level));
  gw(T0, "ADN, Opening DMR Network");
  like(mon.nets.get("ADN"), { status: "connecting", since: T0 });
  gw(T0 + 400, "ADN, Logged into the master successfully");
  like(mon.nets.get("ADN"), { status: "up", since: T0 + 400, reason: null });
  gw(T0 + 60000, "ADN, Connection to the master has timed out, retrying connection", "E");
  like(mon.nets.get("ADN"), { status: "down", since: T0 + 60000, reason: "Connection to the master has timed out, retrying connection" });
  like(mon.alerts[0], { level: "error", text: "ADN, Connection to the master has timed out, retrying connection" });
  // DMRNetwork.cpp closes and reopens it at once (close(false); open()): still down, with its reason
  gw(T0 + 60000, "ADN, Closing DMR Network");
  gw(T0 + 60000, "ADN, Opening DMR Network");
  like(mon.nets.get("ADN"), { status: "down", since: T0 + 60000, reason: "Connection to the master has timed out, retrying connection" });
  gw(T0 + 70000, "ADN, Login to the master has failed, retrying login ...", "W");
  gw(T0 + 80000, "ADN, Login to the master has failed, retrying login ...", "W");
  like(mon.nets.get("ADN"), { status: "down", since: T0 + 60000, reason: "Login to the master has failed, retrying login ..." });
  assert.equal(mon.alerts.length, 2, "the same retry is one alert");
  like(mon.alerts[0], { level: "warn", ts: T0 + 80000 });
  gw(T0 + 90000, "ADN, Opening DMR Network");
  gw(T0 + 90500, "ADN, Logged into the master successfully");
  like(mon.nets.get("ADN"), { status: "up", since: T0 + 90500 });
  gw(T0 + 100000, "ADN, Closing DMR Network");
  like(mon.nets.get("ADN"), { status: "off" });
  // modem
  mon.line(entry(T0 + 1000, "mmdvm-multi", "TX ON"));
  mon.line(entry(T0 + 1001, "mmdvm-iq-1", "Mode set to DMR"));
  assert.deepEqual(mon.modem, { tx: true, mode: "DMR", since: T0 + 1000 });
  mon.line(entry(T0 + 5000, "mmdvm-multi", "TX OFF"));
  assert.deepEqual(mon.modem, { tx: false, mode: "DMR", since: T0 + 5000 });
  // window
  assert.equal(mon.window, null);
  mon.line(FIXTURE_ENTRIES[22]);
  like(mon.window, { attached: true, sdr_rate: 600000, rx_hz: 430812500, tx_hz: 438412500, tx_gain: 0.5, rx_lost: null });
  mon.line(entry(T0 + 200000, "mmdvm-multi", "MiuraStation DMR window, last minute: 1 RX blocks lost, 0 TX samples late, minimum TX margin 36.0 ms"));
  like(mon.window, { attached: true, rx_lost: 1, tx_late: 0, min_margin_ms: 36, sdr_rate: 600000, at: T0 + 200000 });
  mon.line(entry(T0 + 260000, "mmdvm-multi", "MiuraStation DMR window lost: MiuraStation pid 42 is gone; MMDVM-Multi exits so that systemd starts it again", "W"));
  like(mon.window, { attached: false, rx_lost: 1 });
  like(mon.alerts[0], { level: "warn" });
  // rejected, GPS, modem
  mon.line(host(T0 + 270000, "DMR Slot 1, RF user 1234567 rejected for using TG 9990"));
  mon.line(host(T0 + 271000, "GPS position [40.416000,-3.703000] (Position error 20m)"));
  mon.line(host(T0 + 272000, "No reply from the modem for some time, resetting it", "E"));
  assert.deepEqual(mon.alerts.slice(0, 3).map((a) => a.level), ["error", "info", "warn"]);
  for (let i = 0; i < 80; i++) mon.line(host(T0 + 300000 + i, `DMR Slot 1, RF user ${2140000 + i} rejected`));
  assert.equal(mon.alerts.length, 50);
});

test("reducer: a local radio keys up over a network call on the same slot (MMDVM-Host keeps RF and network apart)", () => {
  const mon = new Tier2Monitor();
  mon.line(host(T0, "DMR Slot 2, received network voice header from 2141234 to TG 214"));
  mon.line(host(T0 + 4000, "DMR Slot 2, received RF voice header from 2145678 to TG 214"));
  like(mon.slots[2], { src: "rf", from: "2145678" }, "the RF one on the air");
  like(mon.live["2-net"], { src: "net", from: "2141234", end: null });
  mon.line(host(T0 + 10000, "DMR Slot 2, received network end of voice transmission from 2141234 to TG 214, 10.0 seconds, 0% packet loss, BER: 0.0%"));
  like(mon.slots[2], { src: "rf", from: "2145678", end: null });
  mon.line(host(T0 + 11500, "DMR Slot 2, received RF end of voice transmission from 2145678 to TG 214, 7.5 seconds, BER: 0.3%"));
  assert.equal(mon.slots[2], null);
  assert.deepEqual(mon.heard.map((c) => [c.src, c.from, c.start, c.end, c.end_kind]),
    [["rf", "2145678", T0 + 4000, T0 + 11500, "end"], ["net", "2141234", T0, T0 + 10000, "end"]]);
  // the network watchdog closes only the network call; a restart of MMDVM-Host closes both
  mon.line(host(T0 + 20000, "DMR Slot 1, received network voice header from 2141234 to TG 214"));
  mon.line(host(T0 + 21000, "DMR Slot 1, received RF voice header from 2145678 to TG 9"));
  mon.line(host(T0 + 22000, "DMR Slot 1, network watchdog has expired, 2.0 seconds, 0% packet loss, BER: 0.0%"));
  like(mon.heard[0], { src: "net", end_kind: "watchdog", dur: 2 });
  like(mon.slots[1], { src: "rf", from: "2145678", end: null });
  mon.line(host(T0 + 23000, "DMR Slot 1, received network voice header from 2141234 to TG 214"));
  mon.line(host(T0 + 24000, "MMDVM-Host is stopping", "I"));
  assert.deepEqual(Object.values(mon.live), [null, null, null, null]);
  assert.deepEqual(mon.heard.slice(0, 2).map((c) => [c.src, c.end_kind]), [["net", "restart"], ["rf", "restart"]]);
});

test("reducer: the end line of a call the safety close had closed replaces it", () => {
  const mon = new Tier2Monitor({ timeoutS: () => 180 });
  mon.line(host(T0 + 37, "DMR Slot 2, received network voice header from 2141234 to TG 214"));
  mon.line(host(T0 + 180000, "DMR Slot 2, network user has timed out"));
  mon.tick(T0 + 200000);
  like(mon.heard[0], { end_kind: "timeout", end: T0 + 37 + 195000 });
  mon.line(host(T0 + 300077, "DMR Slot 2, received network end of voice transmission from 2141234 to TG 214, 300.0 seconds, 0% packet loss, BER: 0.0%"));
  assert.equal(mon.heard.length, 1);
  like(mon.heard[0], { start: T0 + 77, end: T0 + 300077, dur: 300 });
});

test("reducer: at most 100 calls, the same call read again replaces it (persisted list + backlog)", () => {
  const lines: object[] = [];
  for (let i = 0; i < 120; i++) {
    const t = T0 + i * 10000;
    lines.push(host(t, `DMR Slot ${1 + (i % 2)}, received network voice header from ${2140000 + i} to TG 214`));
    lines.push(host(t + 2000, `DMR Slot ${1 + (i % 2)}, received network end of voice transmission from ${2140000 + i} to TG 214, 2.0 seconds, 0% packet loss, BER: 0.0%`));
  }
  const a = new Tier2Monitor();
  lines.forEach((l) => a.line(l));
  assert.equal(a.heard.length, TIER2_HEARD_MAX);
  assert.equal(a.heard[0].from, "2140119");
  assert.equal(a.heard[99].from, "2140020");
  const b = new Tier2Monitor({ heard: JSON.parse(JSON.stringify(a.heard)) });
  lines.slice(200).forEach((l) => b.line(l));       // the last 20 calls again
  assert.equal(b.heard.length, TIER2_HEARD_MAX);
  assert.deepEqual(b.heard.map((c) => c.key), a.heard.map((c) => c.key));
  // the same call with its header outside the read: still one
  const c = new Tier2Monitor({ heard: JSON.parse(JSON.stringify(a.heard)) });
  c.line(lines[239]);
  assert.equal(c.heard.length, TIER2_HEARD_MAX);
  assert.equal(c.heard.filter((h) => h.from === "2140119").length, 1);
});

test("routeNetwork: whole slots, TG and ranges, prefixes, the TGRewrite of every network before any PassAll", () => {
  assert.equal(routeNetwork(1, 9, [{ name: "ADN", routes: "S1" }]), "ADN", "one network: that one");
  assert.equal(routeNetwork(2, 9, [{ name: "ADN", routes: null }]), "ADN");
  assert.equal(routeNetwork(1, 9, []), null);
  const p8 = [{ name: "ADN", routes: "S1,S2" }, { name: "BM", routes: "S1:P8" }];
  assert.equal(routeNetwork(1, 8000214, p8), "BM");
  assert.equal(routeNetwork(1, 8999999, p8), "BM");
  assert.equal(routeNetwork(1, 9000000, p8), "ADN");
  assert.equal(routeNetwork(1, 214, p8), "ADN");
  assert.equal(routeNetwork(2, 8000214, p8), "ADN", "the prefix is only on slot 1");
  assert.equal(routeNetwork(1, null, p8), "ADN", "a private call: the whole slot");
  const tg = [{ name: "A", routes: "S1" }, { name: "B", routes: " S2:214-219 , s2:9" }];
  assert.equal(routeNetwork(2, 216, tg), "B");
  assert.equal(routeNetwork(2, 9, tg), "B");
  assert.equal(routeNetwork(2, 91, tg), null, "slot 2 has no whole-slot rule");
  assert.equal(routeNetwork(2, null, tg), null);
  assert.equal(routeNetwork(1, 216, tg), "A");
  assert.equal(routeNetwork(2, 91, [{ name: "A", routes: "S2" }, { name: "B", routes: "S2:91" }]), "B", "B's TGRewrite before A's PassAll");
  assert.equal(routeNetwork(1, 9, [{ name: "A", routes: "S3,foo,S1:x" }, { name: "B", routes: "S1" }]), "B", "bad rules ignored");
});

test("routeNetwork: the slot and TG changes of 0.7.0 (S1:9>S2:91) go by the radio side, before any whole slot", () => {
  const nets = [{ name: "ADN", routes: "S1,S2" }, { name: "BM", routes: "S1:9>S2:91, S1:214-219>S2:3214,S1:P8>S2,s2:8>s2:9" }];
  assert.equal(routeNetwork(1, 9, nets), "BM", "S1:9>S2:91: the radios dial TG 9 on slot 1");
  assert.equal(routeNetwork(2, 91, nets), "ADN", "TG 91 on slot 2 of the radios: the network side does not count");
  assert.equal(routeNetwork(2, 9, nets), "ADN", "S2:8>S2:9: TG 9 of the radios is not BM's");
  assert.equal(routeNetwork(2, 8, nets), "BM");
  assert.equal(routeNetwork(1, 214, nets), "BM");
  assert.equal(routeNetwork(1, 219, nets), "BM");
  assert.equal(routeNetwork(1, 220, nets), "ADN");
  assert.equal(routeNetwork(2, 3214, nets), "ADN");
  assert.equal(routeNetwork(2, 216, nets), "ADN");
  assert.equal(routeNetwork(1, 8000214, nets), "BM", "S1:P8>S2");
  assert.equal(routeNetwork(2, 8000214, nets), "ADN");
  assert.equal(routeNetwork(1, null, nets), "ADN", "a private call: the whole slot");
  assert.equal(routeNetwork(2, null, nets), "ADN");
  // the whole slot of an earlier network does not take a TG that a later one changes, nor the other way round
  const s2 = [{ name: "A", routes: "S2" }, { name: "B", routes: "S1:9>S2:91" }];
  assert.equal(routeNetwork(1, 9, s2), "B");
  assert.equal(routeNetwork(2, 91, s2), "A");
  assert.equal(routeNetwork(1, 10, s2), null, "slot 1 has no whole-slot rule");
  assert.equal(routeNetwork(1, 9, [{ name: "A", routes: "S1" }, { name: "B", routes: "S1:9>S1" }]), "B", "S1:9>S1 is S1:9");
  assert.equal(routeNetwork(1, 9, [{ name: "A", routes: "S1" }, { name: "B", routes: "S1:9>S1:9" }]), "B");
  const bad = [{ name: "A", routes: "S1>S2,S1:9>,S1:9>S2:,S1:9>2,S1:9>S2:91-95,S1:9>>S2,S1:P8>S2:5,S2>S2" }, { name: "B", routes: "S1" }];
  assert.equal(routeNetwork(1, 9, bad), "B", "bad rules ignored");
  assert.equal(routeNetwork(1, 8000001, bad), "B");
  assert.equal(routeNetwork(1, null, bad), "B", "S1>S2 is not a whole slot");
  assert.equal(routeNetwork(2, null, bad), null, "nor S2>S2 (gen-config rejects it too)");
});

test("tier2Nets and readTier2Station: the networks of the conf without passwords, the station of MMDVM-Host-1.ini", () => {
  const conf = {
    GATEWAY_ENABLED: "1", NET_NAME: "ADN", NET_ADDRESS: "10.33.1.50", NET_PORT: "62037", NET_PASSWORD: "secreto1", NET_ROUTES: "S1,S2",
    NET2_ENABLED: "1", NET2_NAME: "Pi45", NET2_ADDRESS: "10.33.1.45", NET2_PORT: "62031", NET2_PASSWORD: "secreto2", NET2_ROUTES: "S1:P8",
    NET3_ENABLED: "0", NET3_NAME: "Red 3", NET3_ADDRESS: "", NET3_PORT: "62031", NET3_PASSWORD: "",
    NET4_ENABLED: "0", NET4_NAME: "Red 4", NET4_ADDRESS: "bm.example", NET4_PORT: "x", NET4_ROUTES: "S2", DISPLAY_LEVEL: "3",
  };
  const nets = tier2Nets(conf);
  assert.deepEqual(nets, [
    { n: 1, name: "ADN", address: "10.33.1.50", port: 62037, routes: "S1,S2", enabled: true },
    { n: 2, name: "Pi45", address: "10.33.1.45", port: 62031, routes: "S1:P8", enabled: true },
    { n: 4, name: "Red 4", address: "bm.example", port: null, routes: "S2", enabled: false },
  ]);
  assert.ok(!JSON.stringify(nets).includes("secreto"));
  assert.deepEqual(tier2Nets({ NET_ADDRESS: "10.33.1.50", NET_PORT: "62037" }), [{ n: 1, name: "ADN", address: "10.33.1.50", port: 62037, routes: "S1,S2", enabled: true }], "a 0.5.0 conf");
  assert.equal(tier2Nets({ GATEWAY_ENABLED: "0" })[0].enabled, false);
  assert.deepEqual(tier2Nets(null), []);

  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tlm-t2-ini-"));
  const ini = path.join(d, "MMDVM-Host-1.ini");
  fs.writeFileSync(ini, "# generado\r\n[General]\r\nCallsign=EA5GVK\r\nId=2145007\r\nTimeout=180\r\n\r\n[Log]\r\nDisplayLevel=2\r\n[MQTT]\r\nPassword=mmdvm\r\n[Modem]\r\nRXFrequency=430825000\r\nTXFrequency=438425000\r\n[DMR]\r\nEnable=1\r\nColorCode=0\r\n");
  assert.deepEqual(readTier2Station(ini, conf, true), { callsign: "EA5GVK", id: 2145007, rx_hz: 430825000, tx_hz: 438425000, color_code: 0, timeout_s: 180, shared: true, display_level: 3 });
  assert.equal(readTier2Station(ini, null, false).display_level, 2, "without the conf: the ini's [Log]");
  assert.deepEqual(readTier2Station(path.join(d, "none.ini"), null, false), { callsign: null, id: null, rx_hz: null, tx_hz: null, color_code: null, timeout_s: null, shared: false, display_level: null });
  assert.deepEqual(parseIni("x=1\n[A]\nk = v \nk=w\n; c\n[B]\nz=\n"), { A: { k: "v" }, B: { z: "" } });
  fs.rmSync(d, { recursive: true, force: true });
});

test("lineSplitter: lines across chunks, UTF-8 split in two, blank lines skipped; the journalctl command", () => {
  const got: string[] = [];
  const split = lineSplitter((l) => got.push(l));
  const bytes = Buffer.from('{"MESSAGE":"Talker Alias \\"EA5GVK Señal\\""}\n\n{"a":1}\n{"b"');
  const cut = bytes.indexOf(Buffer.from("ñ")) + 1;   // in the middle of the ñ
  split(bytes.subarray(0, cut));
  split(bytes.subarray(cut));
  split(":2}\n");
  assert.deepEqual(got, ['{"MESSAGE":"Talker Alias \\"EA5GVK Señal\\""}', '{"a":1}', '{"b":2}']);
  assert.deepEqual(TIER2_JOURNAL_ARGS, ["-n", "19", "journalctl", "-f", "-o", "json", "-n", "3000", "--no-pager", "-u", "mmdvm-host@1", "-u", "dmrgateway", "-u", "mmdvm-multi", "-u", "mmdvm-iq@1"]);
});

// ── The handler against a fake line source ──

const UP: DmrState = { installed: true, exists: true, enabled: true, version: "0.6.0", active: true, degraded: false, missing: [] };
const STATION: Tier2Station = { callsign: "EA5GVK", id: 2145007, rx_hz: 430825000, tx_hz: 438425000, color_code: 0, timeout_s: 180, shared: false, display_level: 2 };
const NETS: Tier2ConfNet[] = [
  { n: 1, name: "ADN", address: "10.33.1.50", port: 62037, routes: "S1,S2", enabled: true },
  { n: 2, name: "Pi45", address: "10.33.1.45", port: 62031, routes: "S1:P8", enabled: true },
  { n: 3, name: "Red 3", address: "10.0.0.3", port: 62031, routes: "S2", enabled: false },
];

function fakeSource() {
  const f = { starts: 0, stops: 0, backlog: [] as string[], push: (_l: string) => {}, exit: (_w: string) => {} };
  const source: LineSource = (onLine, onExit) => { f.starts++; f.push = onLine; f.exit = onExit; f.backlog.forEach(onLine); return () => { f.stops++; }; };
  return { f, source };
}
const fakeNames = () => {
  const asked: number[][] = [];
  return { asked, lookup(ids: Iterable<number>) { const a = Array.from(ids); asked.push(a); return a.includes(2145007) ? { "2145007": { callsign: "EA5GVK", name: "Quini" } } : {}; } };
};

async function serve(h: { state: (req: any, res: any) => void }) {
  const app = express();
  app.get("/api/dmr/tier2/state", h.state);
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = async () => { const r = await fetch(`${base}/api/dmr/tier2/state`); return { status: r.status, j: await r.json() as any }; };
  return { get, close: () => new Promise<void>((r) => server.close(() => r())) };
}

test("handler: 503 not_installed / tier3 / stopped without starting anything, 200 in Tier II with the whole state", async () => {
  const { f, source } = fakeSource();
  const names = fakeNames();
  const p = { state: { ...UP, installed: false } as DmrState, tier2: true, clock: T0 + 60000, station: STATION };
  const h = createDmrTier2({ dmrState: () => p.state, tier2: () => p.tier2, names, config: () => ({ station: p.station, nets: NETS }), source, now: () => p.clock, cacheMs: 0, restartMs: 20 });
  const s = await serve(h);
  try {
    let r = await s.get();
    assert.deepEqual([r.status, r.j.ok, r.j.reason], [503, false, "not_installed"]);
    p.state = UP; p.tier2 = false;
    r = await s.get();
    assert.deepEqual([r.status, r.j.reason, r.j.state.version], [503, "tier3", "0.6.0"]);
    p.tier2 = true; p.state = { ...UP, active: false };
    r = await s.get();
    assert.deepEqual([r.status, r.j.reason], [503, "stopped"]);
    assert.equal(f.starts, 0, "no journal read while it does not apply");

    p.state = UP;
    f.backlog = [
      JSON.stringify(entry(T0, "dmrgateway", "ADN, Opening DMR Network")),
      JSON.stringify(entry(T0 + 400, "dmrgateway", "ADN, Logged into the master successfully")),
      JSON.stringify(entry(T0 + 500, "dmrgateway", "Pi45, Login to the master has failed, retrying login ...", "W")),
      "not json", "{}", "[1,2]",
      JSON.stringify(host(T0 + 1000, "DMR Slot 1, received RF voice header from 2145007 to 2147005")),
      JSON.stringify(host(T0 + 4000, "DMR Slot 1, received RF end of voice transmission from 2145007 to 2147005, 3.0 seconds, BER: 0.1%")),
      JSON.stringify(host(T0 + 5000, "DMR Slot 1, received network voice header from 2149451 to TG 8000214")),
      JSON.stringify(host(T0 + 6000, "DMR Slot 2, received network data header from 16776907 to ALL, 3 blocks")),
      JSON.stringify(entry(T0 + 5001, "mmdvm-multi", "TX ON")),
      JSON.stringify(FIXTURE_ENTRIES[6]),
    ];
    r = await s.get();
    assert.equal(r.status, 200);
    assert.equal(f.starts, 1);
    const j = r.j;
    assert.deepEqual([j.ok, j.demo, j.now], [true, false, T0 + 60000]);
    assert.deepEqual(j.stack, UP);
    assert.deepEqual(j.station, STATION);
    like(j.slots["1"], { src: "net", from: "2149451", to_id: 8000214, net: "Pi45", end: null });
    like(j.slots["2"], { kind: "data", from_id: 16776907, to: "ALL", to_id: 16777215, net: "ADN", blocks: 3 });
    assert.equal(j.heard.length, 1);
    like(j.heard[0], { src: "rf", from_id: 2145007, to_id: 2147005, group: false, net: null, dur: 3, ber: 0.1, end_kind: "end" });
    assert.deepEqual(j.nets.map((n: any) => [n.name, n.status, n.reason]), [["ADN", "up", null], ["Pi45", "down", "Login to the master has failed, retrying login ..."], ["Red 3", "off", null]]);
    assert.ok(!("password" in j.nets[0]));
    assert.deepEqual(j.modem, { tx: true, mode: null, since: T0 + 5001 });
    assert.equal(j.window, null, "not shared: no window");
    like(j.alerts[0], { level: "warn", text: "Pi45, Login to the master has failed, retrying login ..." });
    assert.deepEqual(j.names, { "2145007": { callsign: "EA5GVK", name: "Quini" } });
    // the radios asked: from always, the private dst; never a TG nor ALL
    assert.deepEqual(names.asked.at(-1)!.slice().sort(), [16776907, 2145007, 2147005, 2149451].sort());

    // live lines after the start, the shared window
    f.push(JSON.stringify(host(T0 + 7000, "DMR Slot 1, received network end of voice transmission from 2149451 to TG 8000214, 2.0 seconds, 0% packet loss, BER: 0.0%")));
    p.station = { ...STATION, shared: true };
    r = await s.get();
    assert.equal(f.starts, 1, "one source for every poller");
    assert.equal(r.j.slots["1"], null);
    assert.deepEqual(r.j.heard.map((c: any) => c.net), ["Pi45", null]);
    like(r.j.window, { attached: true, rx_lost: 0, min_margin_ms: 37.5 });

    // the source dies: back in restartMs with a clean state rebuilt from its backlog
    f.exit("journalctl ha terminado (código 1)");
    await new Promise((res) => setTimeout(res, 60));
    assert.equal(f.starts, 2);
    r = await s.get();
    assert.equal(r.j.heard.length, 1, "rebuilt from the backlog (the live line was not in it)");

    // out of Tier II: stopped at once
    p.tier2 = false;
    r = await s.get();
    assert.equal(r.status, 503);
    assert.equal(f.stops, 1);
    assert.equal(h.running, false);

    // idle: stopped after idleMs without a GET
    p.tier2 = true;
    await s.get();
    assert.equal(f.starts, 3);
    p.clock += 9 * 60000; h.sweep();
    assert.equal(h.running, true);
    p.clock += 2 * 60000; h.sweep();
    assert.equal(h.running, false);
    assert.equal(f.stops, 2);
  } finally {
    h.stop();
    await s.close();
  }
});

test("persistence: dmr-tier2-heard.json written atomically at most every persistMs, loaded and deduplicated at the next start", async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tlm-t2-heard-"));
  const file = path.join(d, "dmr-tier2-heard.json");
  const backlog = [
    JSON.stringify(host(T0, "DMR Slot 1, received RF voice header from 2145007 to TG 214")),
    JSON.stringify(host(T0 + 2000, "DMR Slot 1, received RF end of voice transmission from 2145007 to TG 214, 2.0 seconds, BER: 0.0%")),
    JSON.stringify(host(T0 + 3000, "DMR Slot 2, received network voice header from 2149451 to TG 91")),
    JSON.stringify(host(T0 + 6000, "DMR Slot 2, received network end of voice transmission from 2149451 to TG 91, 3.0 seconds, 0% packet loss, BER: 0.0%")),
  ];
  const mk = (b: string[]) => {
    const { f, source } = fakeSource();
    f.backlog = b;
    const h = createDmrTier2({ dmrState: () => UP, tier2: () => true, names: fakeNames(), config: () => ({ station: STATION, nets: NETS }), source, heardFile: file, now: () => T0 + 60000, cacheMs: 0, persistMs: 50 });
    return { f, h };
  };
  const a = mk(backlog);
  const s = await serve(a.h);
  try {
    await s.get();
    assert.ok(!fs.existsSync(file), "not at once");
    await new Promise((r) => setTimeout(r, 120));
    const saved = JSON.parse(fs.readFileSync(file, "utf-8"));
    assert.deepEqual(saved.map((c: any) => c.key), [`2-${T0 + 3000}`, `1-${T0}`]);
    assert.deepEqual(fs.readdirSync(d), ["dmr-tier2-heard.json"], "no temporary file left");
  } finally { a.h.stop(); await s.close(); }
  // a restart: the file + the same backlog (and one more call) = no duplicates
  const b = mk([...backlog,
    JSON.stringify(host(T0 + 10000, "DMR Slot 1, received RF voice header from 2145007 to TG 9")),
    JSON.stringify(host(T0 + 11000, "DMR Slot 1, received RF end of voice transmission from 2145007 to TG 9, 1.0 seconds, BER: 0.0%"))]);
  const s2 = await serve(b.h);
  try {
    const r = await s2.get();
    assert.deepEqual(r.j.heard.map((c: any) => c.key), [`1-${T0 + 10000}`, `2-${T0 + 3000}`, `1-${T0}`]);
    b.h.stop();
    assert.equal(loadHeard(file).length, 3, "stop() writes what is pending");
  } finally { b.h.stop(); await s2.close(); }
  // a broken or foreign file: an empty start, never a crash
  fs.writeFileSync(file, "{oops");
  assert.deepEqual(loadHeard(file), []);
  fs.writeFileSync(file, JSON.stringify([{ key: 1 }, null, { key: "1-5", slot: 1, from: "a", to: "b", start: 1, end: 2 }]));
  assert.equal(loadHeard(file).length, 1);
  saveHeard(file, []);
  assert.deepEqual(loadHeard(file), []);
  assert.deepEqual(loadHeard(null), []);
  fs.rmSync(d, { recursive: true, force: true });
});

test("demo: the generator writes only lines the parser knows, and the handler answers demo:true with a coherent stack", async () => {
  let seed = 7;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const gen = demoGenerator(rand);
  const mon = new Tier2Monitor({ netOf: (slot, tg) => routeNetwork(slot, tg, DEMO_NETS) });
  const all = [...gen.begin(T0)];
  for (let t = T0 + 1000; t < T0 + 30 * 60000; t += 1000) all.push(...gen.tick(t));
  for (const l of all) {
    assert.ok(parseLine(JSON.parse(l)), l);
    mon.line(JSON.parse(l));
  }
  assert.ok(mon.heard.length >= 50, `heard ${mon.heard.length}`);
  for (const k of ["rf", "net"]) assert.ok(mon.heard.some((c) => c.src === k), k);
  assert.ok(mon.heard.some((c) => c.net === "Red 2") && mon.heard.some((c) => c.net === "ADN"));
  assert.ok(mon.heard.some((c) => c.end_kind === "lost" || c.end_kind === "watchdog"));
  assert.ok(mon.heard.some((c) => c.kind === "data"));
  assert.ok(all.some((l) => l.includes("Red 2, Connection to the master has timed out")), "network 2 falls");
  assert.equal(mon.nets.get("ADN")?.status, "up");
  like(mon.window, { attached: true });
  for (const c of mon.heard) assert.ok(c.from_id === null || (c.from_id >= 2140000 && c.from_id <= 16777215));

  const h = createDmrTier2({ demo: true, dmrState: () => DEMO_STACK, tier2: () => true, names: DEMO_NAMES, config: () => ({ station: DEMO_STATION, nets: DEMO_NETS }), source: demoSource(rand) });
  const s = await serve(h);
  try {
    const r = await s.get();
    assert.equal(r.status, 200);
    assert.deepEqual([r.j.demo, r.j.stack.active, r.j.station.shared], [true, true, true]);
    assert.ok(r.j.heard.length > 10);
    assert.ok(r.j.window && r.j.window.attached);
    assert.ok(Object.keys(r.j.names).length > 0);
  } finally { h.stop(); await s.close(); }
});
