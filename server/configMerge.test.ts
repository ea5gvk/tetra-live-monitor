// node --test via tsx:  npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { parse } from "smol-toml";
import { mergeAppendOnly, verifyMerge, mergeConfigFile, backupWithRotation } from "./configMerge";

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
    const log: string[] = [];
    assert.equal(mergeConfigFile(cfg, NEW, BASE, (s) => log.push(s)), true);
    assert.equal(verifyMerge(USER, fs.readFileSync(cfg, "utf-8")), null);
    const baks = fs.readdirSync(dir).filter((n) => n.startsWith("config.toml.bak-"));
    assert.equal(baks.length, 1);
    assert.equal(fs.readFileSync(path.join(dir, baks[0]), "utf-8"), USER);
    if (process.platform !== "win32") assert.equal(fs.statSync(path.join(dir, baks[0])).mode & 0o777, 0o600);
    assert.ok(!log.join("").includes("0123456789ABCDEF"));                 // never a value of [security]
    assert.equal(mergeConfigFile(cfg, NEW, BASE, () => {}), false);        // already up to date
    assert.equal(fs.readdirSync(dir).filter((n) => n.startsWith("config.toml.bak-")).length, 1);
    assert.equal(fs.readdirSync(dir).filter((n) => n.includes(".tmp-")).length, 0);
    for (let i = 0; i < 12; i++) backupWithRotation(cfg, "bak-calc");
    assert.equal(fs.readdirSync(dir).filter((n) => n.startsWith("config.toml.bak-calc-")).length, 10);
    assert.equal(fs.readdirSync(dir).filter((n) => /^config\.toml\.bak-\d/.test(n)).length, 1); // other tag untouched
    fs.writeFileSync(cfg, "a = [\n");
    assert.equal(mergeConfigFile(cfg, NEW, BASE, () => {}), false);        // invalid config: left as it is
    assert.equal(fs.readFileSync(cfg, "utf-8"), "a = [\n");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
