// node --test via tsx:  npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { parse } from "smol-toml";
import { mergeAppendOnly, verifyMerge, mergeConfigFile, backupWithRotation, reorderNewSections, spliceTableBlock, findWhitelist, tomlBroken } from "./configMerge";

const BASE = `# Station config
config_version = "0.6"
stack_mode = "Bs"

[phy_io]
backend = "SoapySdr"

[phy_io.soapysdr]
tx_freq = 438200000
rx_freq = 430600000
# device = "driver=plutosdr,uri=ip:192.168.42.42"
# device = "driver=lime,serial=123456789"
# tx_gain_pad = 50.0

[cell_info]
main_carrier = 1528
# Local SSI ranges
local_ssi_ranges = [
    [0, 90],
]
# hangtime_secs = 5

# [cell_info.sds_command_control]
# authorized_issis = [2260570]
#
# [[cell_info.sds_command_control.commands]]
# status_code = 33001
# action = "restart"

[security]
# authentication_required = true changes that:
issi_whitelist = []

# [recovery]
# enabled = true

[net_info]
mcc = 901
`;

// New version of the template: new keys (commented and active), new tables, [security] and gain keys.
const NEW = BASE
  .replace(`stack_mode = "Bs"\n`, `stack_mode = "Bs"\n# debug_log = "./verbose_log.txt"\n`)
  .replace(`# tx_gain_pad = 50.0\n`, `# tx_gain_pad = 50.0\ntx_gain_dac = 9\n`)
  .replace(`main_carrier = 1528\n`, `main_carrier = 1528\n# Parrot (private echo) service\n# parrot_enabled = false\n# Brand new option\nnew_flag = true\n`)
  .replace(`issi_whitelist = []\n`, `issi_whitelist = []\ntea2_key = "00"\n`)
  .replace(`# [recovery]\n# enabled = true\n`, `[recovery]\n# enabled = true\n# Recovery doc\nrecovery_new = 7\n`)
  .replace(`mcc = 901\n`, `mcc = 901\n\n# OPTIONAL: WAP gateway\n# [wap]\n# enabled = false\n# mtu = 576\n\n# A new table\n[foo]\nbar = 1\n\n[[foo.arr]]\nx = 1\n`);

const USER = `# Station config
config_version = "0.6"
stack_mode = "Bs"

[phy_io]
backend = "SoapySdr"

[phy_io.soapysdr]
tx_freq = 438700000
rx_freq = 431100000
device = "driver=sx"
tx_gain_dac= 9
tx_gain_mixer = 28   # 2 dB below max

[cell_info]
main_carrier = 1600
name = "Canal #1"   # a string with a hash
local_ssi_ranges = [
    [0, 6]
]

[cell_info.sds_command_control]
authorized_issis = [2145007, 2145016]

[[cell_info.sds_command_control.commands]]
status_code = 33001
action = "restart"

[[cell_info.sds_command_control.commands]]
status_code = 33010
action = "ip"

[security]
authentication_required = true
issi_whitelist = [2145007]
k = "0123456789ABCDEF"

# [recovery]
# enabled = true

[net_info]
mcc = 214
`;

const crlf = (s: string) => s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
const lines = (s: string) => s.split("\n");
const count = (s: string, re: RegExp) => (s.match(new RegExp(re, "gm")) || []).length;

function props(user: string, nw: string, base: string | null) {
  const r = mergeAppendOnly(user, nw, base);
  if (r.changed) assert.equal(verifyMerge(user, r.merged), null);
  assert.equal(mergeAppendOnly(r.merged, nw, base).changed, false, "idempotent");
  return r;
}

test("same template: nothing changes", () => {
  for (const u of [USER, crlf(USER), USER.trimEnd()]) assert.equal(mergeAppendOnly(u, BASE, BASE).changed, false);
});

test("append only: original lines kept in order, values kept, idempotent", () => {
  const r = props(USER, NEW, BASE);
  assert.ok(r.changed);
  const m = r.merged;
  const it = lines(m)[Symbol.iterator]();
  for (const l of lines(USER)) { let ok = false; for (const x of it) if (x === l) { ok = true; break; } assert.ok(ok, l); }
  const p: any = parse(m);
  assert.deepEqual(p.cell_info.local_ssi_ranges, [[0, 6]]);             // "[0, 6]" without comma is no header
  assert.equal(p.cell_info.name, "Canal #1");
  assert.equal(p.cell_info.sds_command_control.commands.length, 2);     // [[...]] untouched
  assert.equal(p.phy_io.soapysdr.tx_gain_mixer, 28);
  assert.equal(count(m, /^tx_gain_dac\s*=/), 1);                          // gains never inserted
  assert.equal(count(m, /^\s*#?\s*device\s*=/), 1);                       // no duplicate device
  assert.equal(p.cell_info.new_flag, true);                               // new active key, active table: active
  assert.equal(count(m, /^new_flag = true$/), 1);
  assert.match(m, /# Brand new option\nnew_flag = true\n/);              // with its doc comment
  assert.equal(count(m, /^# parrot_enabled = false$/), 1);
  assert.match(m, /^# debug_log = /m);                                    // top level, commented as in the template
  assert.ok(m.indexOf("# debug_log") < m.indexOf("[phy_io]"));
  assert.match(m, /^# recovery_new = 7$/m);                               // table commented by the user: commented
  assert.match(m, /^# \[wap\]$/m);                                        // new commented table
  assert.equal(p.foo.bar, 1);                                             // new active table (base known)
  assert.equal(p.foo.arr, undefined);                                     // new active [[...]]: never
  assert.ok(r.review.some((x) => x.includes("[foo.arr]")));
  assert.ok(!/hangtime_secs/.test(m));                                    // deleted by the user: not back
  assert.ok(r.skippedDeleted.includes("[cell_info] hangtime_secs"));
  assert.ok(!/tea2_key/.test(m));                                         // [security] never written
  assert.deepEqual(r.security, ["[security] tea2_key"]);                  // names only
  const sec = (s: string) => s.slice(s.indexOf("[security]"), s.indexOf("# [recovery]"));
  assert.equal(sec(m), sec(USER));
  assert.ok(r.unknownKept.some((x) => x.startsWith("[cell_info] name") && x.includes("estricta")));
  assert.ok(r.unknownKept.some((x) => x.startsWith("[phy_io.soapysdr] tx_gain_mixer") && x.includes("ganancia")));
});

test("CRLF, no final newline and BOM are kept", () => {
  const r = props(crlf(USER), NEW, BASE);
  assert.ok(r.changed && !/(?<!\r)\n/.test(r.merged));
  const r2 = props(USER.trimEnd(), NEW, BASE);
  assert.ok(r2.changed && !r2.merged.endsWith("\n") && r2.merged.includes("mcc = 214\n"));
  const r3 = props("﻿" + USER, NEW, BASE);
  assert.ok(r3.merged.startsWith("﻿# Station config"));
});

test("a key the user commented stays commented", () => {
  const u = USER.replace("local_ssi_ranges = [\n    [0, 6]\n]\n", "# local_ssi_ranges = [\n#     [0, 6],\n# ]\n");
  const r = props(u, NEW, BASE);
  assert.equal((parse(r.merged) as any).cell_info.local_ssi_ranges, undefined);
});

test("without a base template everything new goes in commented", () => {
  const r = props(USER, NEW, null);
  const p: any = parse(r.merged);
  assert.equal(p.cell_info.new_flag, undefined);
  assert.match(r.merged, /^# new_flag = true$/m);
  assert.equal(p.foo, undefined);                                         // active new table: not on its own
  assert.ok(r.review.some((x) => x.startsWith("[foo]")));
  assert.match(r.merged, /^# hangtime_secs = 5$/m);                       // no base: cannot know it was deleted
});

test("a key commented with several spaces or a tab after # counts as there (no second commented copy)", () => {
  for (const pre of ["#  ", "#\t", "##   "]) {
    const u = USER.replace("rx_freq = 431100000\n", `${pre}rx_freq = 431100000\n`).replace("main_carrier = 1600\n", `${pre}main_carrier = 1600\n`);
    for (const base of [BASE, null]) {
      const r = props(u, NEW, base);
      assert.equal(count(r.merged, /^\s*#+\s*rx_freq\s*=/), 1);
      assert.equal(count(r.merged, /^\s*#+\s*main_carrier\s*=/), 1);
    }
  }
});

test("config_version change: nothing merged", () => {
  const r = mergeAppendOnly(USER, NEW.replace('config_version = "0.6"', 'config_version = "0.7"'), BASE);
  assert.deepEqual(r.versionChange, { from: "0.6", to: "0.7" });
  assert.equal(r.changed, false);
  assert.equal(r.merged, USER);
});

test("verifyMerge refuses lost lines, changed values and invalid TOML", () => {
  assert.match(verifyMerge(USER, USER.replace("mcc = 214\n", ""))!, /no se conservaría/);
  assert.match(verifyMerge(USER, USER.replace("[net_info]\n", "[net_info]\nmcc = 1\n"))!, /TOML/);
  assert.match(verifyMerge(USER, USER.replace("main_carrier = 1600\n", "main_carrier = 1600\n[x]\n"))!, /se perdería/);
  assert.match(verifyMerge("a = [\n", "a = [\n")!, /actual no es TOML/);
});

test("mergeConfigFile: backup 600, atomic write, idempotent, rotation", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cfgmerge-"));
  try {
    const cfg = path.join(dir, "config.toml");
    fs.writeFileSync(cfg, USER);
    // 11 copies left by the old updater (config.toml.bak-<ISO>): the new updater's rotation never counts them
    const old = Array.from({ length: 11 }, (_, i) => `config.toml.bak-2026-08-${String(i + 1).padStart(2, "0")}T10-00-00-000Z`);
    for (const n of old) fs.writeFileSync(path.join(dir, n), "old\n");
    const log: string[] = [];
    assert.equal(mergeConfigFile(cfg, NEW, BASE, (s) => log.push(s)), "written");
    assert.equal(verifyMerge(USER, fs.readFileSync(cfg, "utf-8")), null);
    const baks = fs.readdirSync(dir).filter((n) => n.startsWith("config.toml.bak-upd-"));
    assert.equal(baks.length, 1);
    assert.equal(fs.readFileSync(path.join(dir, baks[0]), "utf-8"), USER);
    if (process.platform !== "win32") assert.equal(fs.statSync(path.join(dir, baks[0])).mode & 0o777, 0o600);
    assert.ok(!log.join("").includes("0123456789ABCDEF"));                 // never a value of [security]
    assert.equal(mergeConfigFile(cfg, NEW, BASE, () => {}), "current");    // already up to date
    assert.equal(fs.readdirSync(dir).filter((n) => n.startsWith("config.toml.bak-upd-")).length, 1);
    assert.equal(fs.readdirSync(dir).filter((n) => n.includes(".tmp-")).length, 0);
    for (let i = 0; i < 12; i++) backupWithRotation(cfg, "bak-upd");
    for (let i = 0; i < 12; i++) backupWithRotation(cfg, "bak-calc");
    assert.equal(fs.readdirSync(dir).filter((n) => n.startsWith("config.toml.bak-upd-")).length, 10);
    assert.equal(fs.readdirSync(dir).filter((n) => n.startsWith("config.toml.bak-calc-")).length, 10);
    assert.deepEqual(fs.readdirSync(dir).filter((n) => /^config\.toml\.bak-\d/.test(n)).sort(), old); // other tags untouched
    assert.equal(mergeConfigFile(cfg, NEW.replace('config_version = "0.6"', 'config_version = "0.7"'), BASE, () => {}), "version");
    fs.writeFileSync(cfg, "a = [\n");
    assert.equal(mergeConfigFile(cfg, NEW, BASE, () => {}), "refused");    // invalid config: left as it is
    assert.equal(fs.readFileSync(cfg, "utf-8"), "a = [\n");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("calculator whitelist: multi-line, commented, the active line first, unreadable", () => {
  const L = (s: string) => s.split("\n");
  const ml = "[cell_info]\nx = 1\n\n[security]\nissi_whitelist = [\n  2145007,  # Juan\n  1030036,\n]\nk = 1\n\n[brew]\n";
  assert.deepEqual(findWhitelist(L(ml)), { start: 4, end: 7, active: true, list: ["2145007", "1030036"] });
  assert.deepEqual(findWhitelist(L(ml.replace(/\n/g, "\r\n"))), { start: 4, end: 7, active: true, list: ["2145007", "1030036"] });
  const cm = "[security]\n# issi_whitelist = [\n#   2145007,\n# ]\n";
  assert.deepEqual(findWhitelist(L(cm)), { start: 1, end: 3, active: false, list: ["2145007"] });
  // a commented example before the active line, and a commented [security] example before the active table
  const two = "# [security]\n# issi_whitelist = [9]\n\n[security]\n# issi_whitelist = [1, 2]\nissi_whitelist = [3]  # on\n";
  assert.deepEqual(findWhitelist(L(two)), { start: 5, end: 5, active: true, list: ["3"] });
  assert.deepEqual(findWhitelist(L("[security]\nissi_whitelist = []\n")), { start: 1, end: 1, active: true, list: [] });
  assert.equal(findWhitelist(L("[security]\nk = 1\n\n# [recovery]\n# issi_whitelist = [1]\n")), null);   // not in [security]
  assert.equal(findWhitelist(L("[cell_info]\nx = 1\n")), null);
  assert.deepEqual(findWhitelist(L("[security]\nissi_whitelist = [\n  1,\n\n[brew]\n")), { start: 1, end: 1, active: true, list: null });
});

test("calculator Apply: a result that breaks a valid TOML is not written", () => {
  assert.equal(tomlBroken(USER, USER.replace("mcc = 214\n", "mcc = 215\n")), null);
  assert.match(tomlBroken(USER, USER.replace("issi_whitelist = [2145007]\n", "issi_whitelist = [1]\n  2145007,\n]\n"))!, /no sería TOML válido/);
  const dup = tomlBroken(USER, USER.replace('k = "0123456789ABCDEF"\n', 'k = "0123456789ABCDEF"\nk = "0123456789ABCDEF"\n'));
  assert.ok(dup && !dup.includes("0123456789ABCDEF"));                       // duplicated key: no values in the message
  assert.equal(tomlBroken("a = [\n", "a = [\nb\n"), null);                     // already invalid: not this check's call
});

test("calculator reorder: only a table the file did not have moves, the rest stays byte for byte", () => {
  // out of example_config's order: [telemetry] after [brew], a commented example before it
  const cfg = '[phy_io]\na = 1\n\n# [telemetry]\n# host = ""\n\n[brew]\nb = 2\n\n[telemetry]\nhost = "x"\n\n# [dapnet]\n';
  for (const c of [cfg, cfg.replace(/\n/g, "\r\n")]) {
    const e = c.includes("\r") ? "\r\n" : "\n";
    assert.equal(reorderNewSections(c, c), c);
    // the example activated in place (same name): nothing moves
    const act = c.replace("# [telemetry]", "[telemetry]");
    assert.equal(reorderNewSections(act, c), act);
    // [command] appended by a handler: after the last table whose place is not later ([telemetry]), nothing else moves
    const out = reorderNewSections(`${c}${e}[command]${e}host = "y"`, c);
    assert.equal(out, c.replace(`host = "x"${e}${e}`, `host = "x"${e}${e}[command]${e}host = "y"${e}`));
  }
  // a file in order: the new table lands in its place
  const ord = "[cell_info]\nx = 1\n\n[brew]\ny = 2\n";
  assert.equal(reorderNewSections(`${ord}\n[security]\nissi_whitelist = []`, ord), "[cell_info]\nx = 1\n\n[security]\nissi_whitelist = []\n[brew]\ny = 2\n");
});

test("calculator block handlers: the block as generated = untouched; the comments after it always stay", () => {
  const doc = ["", "#####", "", "# OPTIONAL: DAPNET (doc of the next table)", "#"];
  const lines = ["[telemetry]\r", 'host = "h"\r', "port = 1\r", ...doc.map((l) => `${l}\r`), "# [dapnet]\r", ""];
  const before = lines.join("\n");
  spliceTableBlock(lines, 0, 8, ["[telemetry]", 'host = "h"', "port = 1"]);
  assert.equal(lines.join("\n"), before);
  spliceTableBlock(lines, 0, 8, ["[telemetry]", 'host = "x"', "port = 1"]);
  assert.deepEqual(lines.slice(0, 3), ["[telemetry]", 'host = "x"', "port = 1"]);
  assert.deepEqual(lines.slice(3, 8), doc.map((l) => `${l}\r`));
  // a header with no key: only the header is replaced
  const h = ["# [health]", "", "# doc", "[wx_service]"];
  spliceTableBlock(h, 0, 3, ["# [health]", "# snapshot_interval_secs = 5"]);
  assert.deepEqual(h, ["# [health]", "# snapshot_interval_secs = 5", "", "# doc", "[wx_service]"]);
});

test("calculator block handlers: the same values with doc comments = untouched; a change rewrites the block", () => {
  // example_config shape: commented table, trailing comments, a key the card does not know, doc lines
  const ex = ["# [recovery]", "# enabled = true            # on/off (default false)", '# cache_path = ""          # explicit path',
    "# max_replay_attempts = 150 # per-ISSI re-sends", "#                            (1..=500)", '# name = "a # b"   # quoted #', ""];
  const gen = ["# [recovery]", "# enabled = false", "# max_replay_attempts = 150", '# name = "a # b"'];
  const l1 = [...ex];
  spliceTableBlock(l1, 0, ex.length, gen);
  assert.deepEqual(l1, ex);
  const l2 = [...ex];
  spliceTableBlock(l2, 0, ex.length, ["# [recovery]", "# enabled = false", "# max_replay_attempts = 200", '# name = "a # b"']);
  assert.deepEqual(l2, ["# [recovery]", "# enabled = false", "# max_replay_attempts = 200", '# name = "a # b"', ""]);
  // enabling the card rewrites it, active
  const l3 = [...ex];
  spliceTableBlock(l3, 0, ex.length, ["[recovery]", "enabled = true", "max_replay_attempts = 150", 'name = "a # b"']);
  assert.equal(l3[0], "[recovery]");
  // an active table: same values in another spacing and with comments = untouched
  const act = ["[telemetry]\r", 'host  =  "h"   # where\r', "port = 1\r", "extra_key = 5\r", "\r"];
  const l4 = [...act];
  spliceTableBlock(l4, 0, act.length, ["[telemetry]", 'host = "h"', "port = 1"]);
  assert.deepEqual(l4, act);
});

test("renamed geoalarm keys: station_lat/station_lon and flowstation_lat/flowstation_lon count as the same key", () => {
  const geo = (lat: string, lon: string, active: boolean) => {
    const p = active ? "" : "# ";
    return `config_version = "0.6"\n\n${p}[geoalarm]\n${p}enabled = ${active}\n${p}${lat} = 40.5\n${p}${lon} = -0.25\n${p}radius_m = 500.0\n`;
  };
  // miura FlowStation -> MiuraStation: the user's active flowstation_* is the new station_* (no duplicate field)
  for (const tplActive of [true, false]) {
    const user = geo("flowstation_lat", "flowstation_lon", true);
    const r = props(user, geo("station_lat", "station_lon", tplActive), geo("flowstation_lat", "flowstation_lon", tplActive));
    assert.equal(r.changed, false);
    assert.ok(!/station_lat/.test(r.merged.replace(/flowstation_lat/g, "")));
    assert.ok(!r.unknownKept.some((x) => x.includes("flowstation_l")), "the old name is known through the new one");
  }
  // a commented [geoalarm] the same; a new key next to the renamed ones still goes in
  const user = geo("flowstation_lat", "flowstation_lon", false);
  const tpl = geo("station_lat", "station_lon", false) + "# radius_new = 1\n";
  const r = props(user, tpl, geo("flowstation_lat", "flowstation_lon", false));
  assert.equal(count(r.merged, /^#?\s*station_lat\s*=/), 0);
  assert.equal(count(r.merged, /^# radius_new = 1$/), 1);
  // back to razvan's FlowStation: a MiuraStation config gets no flowstation_* next to station_*
  const back = props(geo("station_lat", "station_lon", true), geo("flowstation_lat", "flowstation_lon", true), null);
  assert.equal(back.changed, false);
  // without the old name the new key is added as usual
  const none = props(`config_version = "0.6"\n\n[geoalarm]\nenabled = true\nradius_m = 500.0\n`, geo("station_lat", "station_lon", true), geo("x_lat", "x_lon", true));
  assert.equal(count(none.merged, /^station_lat = 40.5$/), 1);
});
