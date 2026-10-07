// node --test via tsx:  npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import {
  PRODUCTS, PI_LAYOUT, unitFile, watchdogConf, urlIsRepo, detectInstall, migrationState, isMigrationLink,
  flowDirInstalled, updateScript, installScript, migrationScript, rollbackScript, SD_NOTIFY_MARKERS, type Layout,
} from "./stationScripts";

test("units: MiuraStation runs its own binary; razvan's unit is the one the dashboard always wrote", () => {
  const m = unitFile(PRODUCTS.miura, PI_LAYOUT);
  assert.match(m, /^WorkingDirectory=\/root\/miurastation$/m);
  assert.match(m, /^ExecStart=\/root\/miurastation\/target\/release\/miurastation \/root\/miurastation\/config\.toml$/m);
  assert.match(m, /^Description=MiuraStation/m);
  assert.ok(!/flowstation/i.test(m));
  const r = unitFile(PRODUCTS.razvan, PI_LAYOUT);
  assert.equal(r, `[Unit]
Description=Tetra Flowstation
After=network.target

[Service]
Type=simple
CPUSchedulingPolicy=fifo
CPUSchedulingPriority=73
WorkingDirectory=/root/flowstation
ExecStart=/root/flowstation/target/release/bluestation-bs /root/flowstation/config.toml

StandardOutput=journal
StandardError=journal

Restart=always
RestartSec=2
KillSignal=SIGINT

[Install]
WantedBy=multi-user.target
`);
  assert.match(watchdogConf(PRODUCTS.miura), /MiuraStation/);
  assert.match(watchdogConf(PRODUCTS.razvan), /Flowstation/);
});

test("the watchdog accepts both sd_notify markers and every script names its own unit", () => {
  assert.deepEqual(SD_NOTIFY_MARKERS, ["miurastation-sd-notify-v1", "flowstation-sd-notify-v1"]);
  const up = updateScript(PRODUCTS.miura, PI_LAYOUT);
  assert.ok(up.includes("grep -aqE 'miurastation-sd-notify-v1|flowstation-sd-notify-v1' \"target/release/miurastation\""));
  assert.ok(up.includes("https://github.com/ea5gvk/MiuraStation.git"));
  assert.ok(up.includes('/etc/systemd/system/miurastation.service.d/10-watchdog.conf'));
  assert.ok(!/flowstation\.service/.test(up));
  const upr = updateScript(PRODUCTS.razvan, PI_LAYOUT);
  assert.ok(upr.includes("target/release/bluestation-bs") && upr.includes("razvanzeces/flowstation"));
  const ins = installScript(PRODUCTS.miura, PI_LAYOUT, { sameSource: false, carryFrom: "/root/flowstation", reserveCores: "/opt/tlm/script/reserve-station-cores.sh" });
  assert.ok(ins.includes('elif [ -f "/root/flowstation/config.toml" ]'));
  assert.ok(ins.includes("sudo bash '/opt/tlm/script/reserve-station-cores.sh'"));
  const mig = migrationScript(PI_LAYOUT);
  assert.ok(mig.includes('OLD="/root/flowstation"; NEW="/root/miurastation"'));
  assert.ok(mig.includes("https://github.com/ea5gvk/MiuraStation.git"));
  assert.ok(mig.includes("cd \"/root/miurastation\" &&"), "cargo builds in the new directory (a literal path, not a shell variable)");
  assert.ok(rollbackScript(PI_LAYOUT).includes("https://github.com/ea5gvk/flowstation.git"));
});

test("urlIsRepo: exact repository, https or ssh, with or without .git", () => {
  assert.ok(urlIsRepo("https://github.com/ea5gvk/MiuraStation.git\n", "ea5gvk/MiuraStation"));
  assert.ok(urlIsRepo("https://github.com/EA5GVK/miurastation", "ea5gvk/MiuraStation"));
  assert.ok(urlIsRepo("git@github.com:ea5gvk/flowstation.git", "ea5gvk/flowstation"));
  assert.ok(!urlIsRepo("https://github.com/ea5gvk/flowstation-tea2.git", "ea5gvk/flowstation"));
  assert.ok(!urlIsRepo("https://github.com/razvanzeces/flowstation.git", "ea5gvk/flowstation"));
});

// A layout in a temporary directory with git repositories (needs git; the links need symlink rights).
function tmpLayout(): Layout {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tlm-station-"));
  for (const x of ["root", "systemd", "tmp"]) fs.mkdirSync(path.join(d, x));
  return { root: path.join(d, "root").replace(/\\/g, "/"), systemd: path.join(d, "systemd").replace(/\\/g, "/"), tmp: path.join(d, "tmp").replace(/\\/g, "/") };
}
function repo(dir: string, url: string, branch: string) {
  fs.mkdirSync(dir, { recursive: true });
  const git = (...a: string[]) => execFileSync("git", ["-C", dir, ...a], { stdio: "ignore" });
  git("init", "-q");
  git("checkout", "-q", "-b", branch);
  git("remote", "add", "origin", url);
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "x");
}
const canLink = (() => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tlm-link-"));
  try { fs.mkdirSync(path.join(d, "a")); fs.symlinkSync(path.join(d, "a"), path.join(d, "b"), "dir"); return true; } catch { return false; }
})();

test("migration state: the miura FlowStation needs it, a half-done one resumes, razvan's and MiuraStation do not", (t) => {
  try { execFileSync("git", ["--version"], { stdio: "ignore" }); } catch { t.skip("sin git"); return; }
  const L = tmpLayout();
  const old = `${L.root}/flowstation`, neu = `${L.root}/miurastation`;
  assert.equal(migrationState(L), "none");                       // nothing installed
  repo(old, "https://github.com/ea5gvk/flowstation.git", "miura");
  assert.equal(detectInstall(old), "legacy");
  assert.equal(migrationState(L), "needed");
  assert.ok(flowDirInstalled(L));
  fs.renameSync(old, neu);                                         // cut right after the move
  assert.equal(migrationState(L), "resume");
  if (canLink) {
    fs.symlinkSync(neu, old, "dir");
    assert.ok(isMigrationLink(L));
    assert.ok(!flowDirInstalled(L), "the link is not razvan's FlowStation");
    assert.equal(migrationState(L), "resume");
    execFileSync("git", ["-C", neu, "remote", "set-url", "origin", "https://github.com/ea5gvk/MiuraStation.git"]);
    execFileSync("git", ["-C", neu, "checkout", "-q", "-b", "main"]);
    assert.equal(detectInstall(neu), "miura");
    assert.equal(migrationState(L), "none");                     // done
    fs.unlinkSync(old);
  }
  const L2 = tmpLayout();
  repo(`${L2.root}/flowstation`, "https://github.com/razvanzeces/flowstation.git", "main");
  assert.equal(detectInstall(`${L2.root}/flowstation`), "razvan");
  assert.equal(migrationState(L2), "none");
  repo(`${L2.root}/miurastation`, "https://github.com/ea5gvk/flowstation.git", "miura");
  assert.equal(migrationState(L2), "none", "two real directories: never mixed");
});
