// node --test via tsx:  npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import * as crypto from "crypto";
import { spawnSync } from "child_process";
import {
  PRODUCTS, PI_LAYOUT, unitFile, watchdogConf, urlIsRepo, detectInstall, migrationState, migrationInfo, isMigrationLink,
  flowDirInstalled, miuraInstalled, miuraPackaged, isSourceUnit, updateScript, installScript, packageScript, migrationScript,
  rollbackScript, parseRelease, debUpstreamVersion, compareVersions, pkgBinPath, pkgUnitPath, pkgTemplatePath,
  migrationBackupDir, isLink, SD_NOTIFY_MARKERS, type Layout,
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
  const upr = updateScript(PRODUCTS.razvan, PI_LAYOUT);
  assert.ok(upr.includes("grep -aqE 'miurastation-sd-notify-v1|flowstation-sd-notify-v1' \"target/release/bluestation-bs\""));
  assert.ok(upr.includes("razvanzeces/flowstation") && upr.includes('/etc/systemd/system/flowstation.service.d/10-watchdog.conf'));
  const ins = installScript(PRODUCTS.razvan, PI_LAYOUT, { sameSource: false, carryFrom: null, reserveCores: "/opt/tlm/script/reserve-station-cores.sh" });
  assert.ok(ins.includes("sudo bash '/opt/tlm/script/reserve-station-cores.sh'"));
  // MiuraStation: the package, never git or cargo, and only drop-ins of its unit
  const rel = { tag: "v1.2.0", version: "1.2.0" };
  const scripts = {
    install: packageScript(PI_LAYOUT, { mode: "install", ...rel, carryFrom: "/root/flowstation", reserveCores: "/opt/tlm/script/reserve-station-cores.sh" }),
    update: packageScript(PI_LAYOUT, { mode: "update", ...rel }),
    migration: migrationScript(PI_LAYOUT, rel),
  };
  for (const [name, s] of Object.entries(scripts)) {
    assert.ok(s.includes("https://github.com/ea5gvk/MiuraStation-dist/releases/download/$TAG"), name);
    assert.ok(s.includes("DEB='miurastation_1.2.0_arm64.deb'") && s.includes("sha256sum -c deb.sha256"), name);
    assert.ok(s.includes("  amd64) DEB='miurastation_1.2.0_amd64.deb' ;;"), `${name}: the PC .deb too`);
    assert.ok(s.includes("grep -aqE 'miurastation-sd-notify-v1|flowstation-sd-notify-v1' \"/usr/bin/miurastation\""), name);
    assert.ok(s.includes('/etc/systemd/system/miurastation.service.d/10-watchdog.conf'), name);
    assert.ok(s.includes("env -u MIURASTATION_OTA"), `${name}: the panel's apt-get never runs as the station's OTA`);
    assert.ok(!/cargo build|git clone|git fetch|tee "\$SYSD\/\$NEW_SVC"|target\/release\/miurastation/.test(s), name);
  }
  assert.ok(scripts.install.includes('[ -f "/root/flowstation/config.toml" ]'));
  assert.ok(scripts.install.includes("sudo bash '/opt/tlm/script/reserve-station-cores.sh'"));
  assert.ok(scripts.migration.includes('OLD="/root/flowstation"; NEW="/root/miurastation"'));
  assert.ok(rollbackScript(PI_LAYOUT).includes("https://github.com/ea5gvk/flowstation.git"));
});

test("releases: tag, marker and dpkg versions", () => {
  const sha = "0123456789abcdef0123456789abcdef01234567";
  const r = parseRelease({ tag_name: "v1.2.0", name: "MiuraStation 1.2.0", published_at: "2026-10-10T10:00:00Z", author: { login: "ea5gvk" },
    html_url: "https://github.com/ea5gvk/MiuraStation-dist/releases/tag/v1.2.0", body: `notes\n<!-- miura-build: version=1.2.0 sha=${sha} -->` });
  assert.deepEqual(r, { tag: "v1.2.0", version: "1.2.0", sha, name: "MiuraStation 1.2.0", date: "2026-10-10T10:00:00Z", author: "ea5gvk",
    url: "https://github.com/ea5gvk/MiuraStation-dist/releases/tag/v1.2.0" });
  assert.equal(parseRelease({ tag_name: "v1.2.0-beta.1", body: "" })?.version, "1.2.0-beta.1");
  assert.equal(parseRelease({ tag_name: "v1.2.0", body: `<!-- miura-build: version=1.1.0 sha=${sha} -->` }), null, "a marker of another version");
  assert.equal(parseRelease({ tag_name: "v1.2.0; rm -rf /" }), null);
  assert.equal(parseRelease({ tag_name: "v1.2.0", draft: true }), null);
  assert.equal(parseRelease({ message: "Not Found" }), null);
  assert.equal(debUpstreamVersion("1.1.0-1"), "1.1.0");
  assert.equal(debUpstreamVersion("1.2.0~beta.1-1\n"), "1.2.0-beta.1");
  assert.equal(debUpstreamVersion("1.2.0"), "1.2.0");
  const order = ["1.0.0", "1.1.0-beta.1", "1.1.0-beta.2", "1.1.0-beta.10", "1.1.0-rc.1", "1.1.0", "1.1.1", "1.10.0", "2.0.0"];
  for (let i = 0; i < order.length; i++) for (let j = 0; j < order.length; j++) {
    assert.equal(Math.sign(compareVersions(order[i], order[j])), Math.sign(i - j), `${order[i]} vs ${order[j]}`);
  }
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
  const at = (x: string) => { fs.mkdirSync(path.join(d, x)); return path.join(d, x).replace(/\\/g, "/"); };
  return { root: at("root"), systemd: at("systemd"), tmp: at("tmp"), pkgSystemd: at("lib-systemd"), usr: at("usr") };
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
    assert.equal(migrationState(L), "none");                     // no copies: not a migration from here
    const bk = `${L.root}/.tlm-miurastation-migration`;
    fs.mkdirSync(bk);
    assert.equal(migrationState(L), "resume", "cut during the fetch or the build: copies without done");
    fs.writeFileSync(`${bk}/done`, "");
    assert.equal(migrationState(L), "none");                     // done
    fs.unlinkSync(old);
    assert.ok(!miuraInstalled(L), "a directory without miurastation.service is not installed");
    fs.writeFileSync(`${L.systemd}/miurastation.service`, unitFile(PRODUCTS.miura, L));
    assert.ok(miuraInstalled(L));
    // built from source (the unit the panel wrote): to be moved to the package; the package alone: nothing to do
    assert.ok(isSourceUnit(`${L.systemd}/miurastation.service`));
    assert.deepEqual(migrationInfo(L), { state: "needed", kind: "source" });
    fs.mkdirSync(`${L.usr}/bin`);
    fs.writeFileSync(pkgBinPath(L), "");
    fs.writeFileSync(pkgUnitPath(L), "[Service]\nExecStart=/usr/bin/miurastation /root/miurastation/config.toml\n");
    assert.ok(!miuraPackaged(L), "a source unit hides the package's");
    fs.unlinkSync(`${L.systemd}/miurastation.service`);
    assert.ok(miuraPackaged(L) && miuraInstalled(L));
    assert.equal(migrationState(L), "none");
    fs.writeFileSync(`${bk}/kind`, "source");
    fs.unlinkSync(`${bk}/done`);
    assert.deepEqual(migrationInfo(L), { state: "resume", kind: "source" }, "a conversion cut short");
  }
  const L2 = tmpLayout();
  repo(`${L2.root}/flowstation`, "https://github.com/razvanzeces/flowstation.git", "main");
  assert.equal(detectInstall(`${L2.root}/flowstation`), "razvan");
  assert.equal(migrationState(L2), "none");
  repo(`${L2.root}/miurastation`, "https://github.com/ea5gvk/flowstation.git", "miura");
  assert.equal(migrationState(L2), "none", "two real directories: never mixed");
});

// ── End to end: the very scripts, run by bash against a temporary layout ──
// Mocked: sudo (runs the command), systemctl (unit states as files), dpkg/dpkg-query, apt-get (installs a fake .deb
// with what the real postinst does: creates the station home and config.toml if missing, enables on the first
// install, restarts a running station on an upgrade unless MIURASTATION_OTA) and curl (serves release assets).
const MOCKS: Record<string, string> = {
  sudo: `exec "$@"`,
  systemctl: `echo "systemctl $*" >> "$MOCK_LOG"
q=0; args=()
for a in "$@"; do case "$a" in --quiet|-q) q=1 ;; --no-block|--system) ;; *) args+=("$a") ;; esac; done
cmd=\${args[0]:-}; u=\${args[1]:-}; S="$MOCK_STATE"
unit_exists() { [ -f "$MOCK_SYSD/$u" ] || [ -f "$MOCK_PKGSYSD/$u" ]; }
case "$cmd" in
  is-active) if [ -f "$S/active-$u" ]; then [ $q = 1 ] || echo active; exit 0; fi; [ $q = 1 ] || echo inactive; exit 3 ;;
  is-enabled) if [ -f "$S/enabled-$u" ]; then [ $q = 1 ] || echo enabled; exit 0; fi; [ $q = 1 ] || echo disabled; exit 1 ;;
  start|restart) unit_exists || { echo "Unit $u not found." >&2; exit 5; }; touch "$S/active-$u" ;;
  stop) rm -f "$S/active-$u" ;;
  enable) unit_exists || { echo "Unit $u not found." >&2; exit 1; }; touch "$S/enabled-$u" ;;
  disable) rm -f "$S/enabled-$u" ;;
esac
exit 0`,
  dpkg: `echo "dpkg $*" >> "$MOCK_LOG"
[ "$1" = --print-architecture ] && echo "\${MOCK_ARCH:-arm64}"
exit 0`,
  "dpkg-query": `[ -f "$MOCK_STATE/pkg-version" ] || { echo "dpkg-query: no packages found matching miurastation" >&2; exit 1; }
case "$*" in *Version*) cat "$MOCK_STATE/pkg-version" ;; *) echo "miurastation $(cat "$MOCK_STATE/pkg-version")" ;; esac`,
  "apt-get": `echo "apt-get $*\${MIURASTATION_OTA:+ (OTA)}" >> "$MOCK_LOG"
cmd=""; deb=""
for a in "$@"; do case "$a" in install|purge|update) cmd=$a ;; *.deb) deb=$a ;; esac; done
case "$cmd" in
  install)
    [ -n "\${MOCK_APT_KILL:-}" ] && kill -9 $PPID
    [ -n "\${MOCK_APT_FAIL:-}" ] && { echo "E: fallo simulado" >&2; exit 100; }
    first=1; [ -f "$MOCK_STATE/pkg-version" ] && first=0
    mkdir -p "$MOCK_USR/bin" "$MOCK_USR/share/miurastation/example_config" "$MOCK_PKGSYSD"
    echo "ELF miurastation-sd-notify-v1" > "$MOCK_USR/bin/miurastation"
    sed '1,/^--- template ---$/d' "$deb" > "$MOCK_USR/share/miurastation/example_config/config.toml"
    { echo "[Service]"; echo "Type=notify"; echo "ExecStart=/usr/bin/miurastation /root/miurastation/config.toml"; } > "$MOCK_PKGSYSD/miurastation.service"
    sed -n 's/^Version: //p' "$deb" > "$MOCK_STATE/pkg-version"
    mkdir -p "$MOCK_ROOT/miurastation"
    [ -e "$MOCK_ROOT/miurastation/config.toml" ] || cp "$MOCK_USR/share/miurastation/example_config/config.toml" "$MOCK_ROOT/miurastation/config.toml"
    [ $first = 1 ] && touch "$MOCK_STATE/enabled-miurastation.service"
    if [ $first = 0 ] && [ -z "\${MIURASTATION_OTA:-}" ] && [ -f "$MOCK_STATE/active-miurastation.service" ]; then echo "postinst restart" >> "$MOCK_LOG"; fi
    ;;
  purge)
    rm -rf "$MOCK_USR/bin/miurastation" "$MOCK_USR/share/miurastation" "$MOCK_PKGSYSD/miurastation.service" "$MOCK_STATE/pkg-version"
    rm -f "$MOCK_STATE/active-miurastation.service" "$MOCK_STATE/enabled-miurastation.service"
    ;;
esac
exit 0`,
  curl: `out=""; url=""
while [ $# -gt 0 ]; do case "$1" in -o) out=$2; shift ;; http*) url=$1 ;; esac; shift; done
echo "curl $url" >> "$MOCK_LOG"
rest=\${url%/*}; f="$MOCK_RELEASES/\${rest##*/}/\${url##*/}"
[ -f "$f" ] || { echo "curl: (22) The requested URL returned error: 404" >&2; exit 22; }
cp "$f" "$out"`,
};

const TEMPLATE = "# plantilla de MiuraStation\n[phy_io]\nbackend = \"soapysdr\"\n";
interface Sandbox { L: Layout; state: string; log: string; releases: string; env: NodeJS.ProcessEnv }
function sandbox(): Sandbox {
  const L = tmpLayout();
  const base = path.dirname(L.root);
  const bin = path.join(base, "mockbin"), state = path.join(base, "state"), releases = path.join(base, "releases");
  for (const d of [bin, state, releases]) fs.mkdirSync(d);
  for (const [name, body] of Object.entries(MOCKS)) fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
  const log = path.join(base, "calls.log");
  fs.writeFileSync(log, "");
  const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  const env: NodeJS.ProcessEnv = {
    ...process.env, [pathKey]: `${bin}${path.delimiter}${process.env[pathKey]}`,
    MSYS: "winsymlinks:nativestrict", MOCK_LOG: log, MOCK_STATE: state, MOCK_RELEASES: releases,
    MOCK_ROOT: L.root, MOCK_USR: L.usr, MOCK_SYSD: L.systemd, MOCK_PKGSYSD: L.pkgSystemd,
  };
  return { L, state, log, releases, env };
}
// A release vX.Y.Z of ea5gvk/MiuraStation-dist with a (fake) .deb of each arch and one SHA256SUMS.
function publish(sb: Sandbox, version: string, opts: { badSum?: boolean; arches?: string[] } = {}) {
  const dir = path.join(sb.releases, `v${version}`);
  fs.mkdirSync(dir);
  let sums = "";
  for (const arch of opts.arches ?? ["arm64", "amd64"]) {
    const deb = `miurastation_${version}_${arch}.deb`;
    const body = `Version: ${version.replace("-", "~")}-1\n--- template ---\n${TEMPLATE}# ${version}\n`;
    fs.writeFileSync(path.join(dir, deb), body);
    sums += `${crypto.createHash("sha256").update(opts.badSum ? "otra cosa" : body).digest("hex")}  ${deb}\n`;
  }
  fs.writeFileSync(path.join(dir, "SHA256SUMS"), `${sums}${"0".repeat(64)}  miurastation-${version}-aarch64.tar.gz\n`);
}
// From a file: on Windows a long `bash -c` argument does not reach Git Bash whole.
function run(sb: Sandbox, script: string, env: NodeJS.ProcessEnv = {}) {
  const file = path.join(path.dirname(sb.L.root), "script.sh");
  fs.writeFileSync(file, script);
  const r = spawnSync("bash", [file], { env: { ...sb.env, ...env }, encoding: "utf-8", timeout: 180000 });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}
const has = (sb: Sandbox, f: string) => fs.existsSync(path.join(sb.state, f));
const calls = (sb: Sandbox) => fs.readFileSync(sb.log, "utf-8");
const pkgVersion = (sb: Sandbox) => fs.readFileSync(path.join(sb.state, "pkg-version"), "utf-8").trim();
const bashOk = (() => { try { execFileSync("bash", ["-c", "true"], { stdio: "ignore" }); return true; } catch { return false; } })();
const MARK = (L: Layout) => `${L.tmp}/miurastation.service.was-active`;

test("package: install, refusals and update keep config.toml and only write drop-ins", { skip: !bashOk && "sin bash" }, () => {
  const sb = sandbox(), L = sb.L;
  publish(sb, "1.2.0");
  publish(sb, "1.2.1", { badSum: true });
  const install = (tag: string, version: string) => packageScript(L, { mode: "install", tag, version });
  let r = run(sb, install("v1.2.0", "1.2.0"), { MOCK_ARCH: "armhf" });
  assert.equal(r.code, 1);
  assert.match(r.out, /solo se publica para arm64 \(Raspberry Pi 3\/4\/5.*\) y amd64 \(PC con Debian 12\/13 o Ubuntu 22\.04\/24\.04\), y este sistema es armhf/);
  r = run(sb, install("v1.2.0", "1.2.0"), { MOCK_ARCH: "i386" });
  assert.equal(r.code, 1);
  assert.match(r.out, /solo se publica para arm64.*amd64.*y este sistema es i386/);
  assert.ok(!/curl/.test(calls(sb)), "an unsupported arch downloads nothing");
  r = run(sb, install("v1.2.1", "1.2.1"));
  assert.equal(r.code, 1);
  assert.match(r.out, /SHA-256 de miurastation_1\.2\.1_arm64\.deb no coincide/);
  r = run(sb, install("v9.9.9", "9.9.9"));
  assert.equal(r.code, 1);
  assert.match(r.out, /no se ha podido descargar SHA256SUMS/);
  assert.ok(!/apt-get/.test(calls(sb)) && !has(sb, "pkg-version"), "nothing installed after a refusal");

  r = run(sb, install("v1.2.0", "1.2.0"));
  assert.equal(r.code, 0, r.out);
  assert.equal(pkgVersion(sb), "1.2.0-1");
  assert.equal(fs.readFileSync(`${L.root}/miurastation/config.toml`, "utf-8"), `${TEMPLATE}# 1.2.0\n`);
  assert.ok(!has(sb, "enabled-miurastation.service"), "the selector enables it, not the install");
  assert.ok(fs.existsSync(`${L.systemd}/miurastation.service.d/10-watchdog.conf`), "watchdog drop-in from /usr/bin/miurastation");
  assert.ok(!fs.existsSync(`${L.systemd}/miurastation.service`), "no main unit written by the panel");
  assert.ok(miuraPackaged(L) && miuraInstalled(L) && migrationState(L) === "none");
  assert.ok(!/\(OTA\)/.test(calls(sb)));
  assert.deepEqual(fs.readdirSync(L.tmp).filter((f) => f.startsWith("miurastation-deb.")), [], "download directory removed");

  // update with the station on air: stopped before apt-get (no postinst restart), the mark for the start after the merge
  fs.writeFileSync(`${L.root}/miurastation/config.toml`, "# mi config\n");
  fs.writeFileSync(path.join(sb.state, "active-miurastation.service"), "");
  publish(sb, "1.3.0");
  fs.writeFileSync(sb.log, "");
  r = run(sb, packageScript(L, { mode: "update", tag: "v1.3.0", version: "1.3.0" }));
  assert.equal(r.code, 0, r.out);
  assert.equal(pkgVersion(sb), "1.3.0-1");
  assert.equal(fs.readFileSync(`${L.root}/miurastation/config.toml`, "utf-8"), "# mi config\n");
  assert.equal(fs.readFileSync(pkgTemplatePath(L), "utf-8"), `${TEMPLATE}# 1.3.0\n`);
  const log = calls(sb);
  assert.ok(log.indexOf("systemctl stop miurastation.service") < log.indexOf("apt-get "), log);
  assert.ok(!/postinst restart/.test(log) && fs.existsSync(MARK(L)) && !has(sb, "active-miurastation.service"));

  // a failed apt-get puts the station back on air
  fs.rmSync(MARK(L));
  fs.writeFileSync(path.join(sb.state, "active-miurastation.service"), "");
  publish(sb, "1.4.0-beta.1");
  r = run(sb, packageScript(L, { mode: "update", tag: "v1.4.0-beta.1", version: "1.4.0-beta.1" }), { MOCK_APT_FAIL: "1" });
  assert.equal(r.code, 1);
  assert.match(r.out, /apt-get update/);
  assert.ok(has(sb, "active-miurastation.service") && !fs.existsSync(MARK(L)));
  assert.equal(pkgVersion(sb), "1.3.0-1");
  r = run(sb, packageScript(L, { mode: "update", tag: "v1.4.0-beta.1", version: "1.4.0-beta.1" }));
  assert.equal(r.code, 0, r.out);
  assert.equal(pkgVersion(sb), "1.4.0~beta.1-1", "a pre-release: the ~ of dpkg");
});

test("package on a PC (amd64): its own .deb and its own SHA256SUMS line; a release without it is refused", { skip: !bashOk && "sin bash" }, () => {
  const sb = sandbox(), L = sb.L, PC = { MOCK_ARCH: "amd64" };
  const install = (tag: string, version: string) => packageScript(L, { mode: "install", tag, version });
  publish(sb, "1.1.0", { arches: ["arm64"] });
  let r = run(sb, install("v1.1.0", "1.1.0"), PC);
  assert.equal(r.code, 1);
  assert.match(r.out, /no se ha podido descargar miurastation_1\.1\.0_amd64\.deb/);
  publish(sb, "1.2.1", { badSum: true });
  r = run(sb, install("v1.2.1", "1.2.1"), PC);
  assert.equal(r.code, 1);
  assert.match(r.out, /SHA-256 de miurastation_1\.2\.1_amd64\.deb no coincide/);
  publish(sb, "1.2.0");
  const sums = path.join(sb.releases, "v1.2.0", "SHA256SUMS");
  const allSums = fs.readFileSync(sums, "utf-8");
  fs.writeFileSync(sums, allSums.split("\n").filter((l) => !l.endsWith("_amd64.deb")).join("\n"));
  r = run(sb, install("v1.2.0", "1.2.0"), PC);
  assert.equal(r.code, 1);
  assert.match(r.out, /SHA256SUMS no incluye miurastation_1\.2\.0_amd64\.deb/, "the arm64 line is not the PC's");
  assert.ok(!/apt-get/.test(calls(sb)) && !has(sb, "pkg-version"), "nothing installed after a refusal");

  fs.writeFileSync(sums, allSums);
  fs.writeFileSync(sb.log, "");
  r = run(sb, install("v1.2.0", "1.2.0"), PC);
  assert.equal(r.code, 0, r.out);
  const log = calls(sb);
  assert.ok(log.includes("curl https://github.com/ea5gvk/MiuraStation-dist/releases/download/v1.2.0/miurastation_1.2.0_amd64.deb"), log);
  assert.ok(!log.includes("_arm64.deb"), log);
  assert.match(log, /apt-get .*miurastation_1\.2\.0_amd64\.deb/);
  assert.equal(pkgVersion(sb), "1.2.0-1");
  assert.ok(miuraPackaged(L) && miuraInstalled(L));
});

test("migration: refused before touching anything on an unsupported arch, and to the amd64 .deb on a PC", { skip: !bashOk && "sin bash" }, () => {
  const sb = sandbox(), L = sb.L;
  sourceInstall(sb);
  publish(sb, "1.2.0");
  const unit = fs.readFileSync(`${L.systemd}/miurastation.service`, "utf-8");
  let r = run(sb, migrationScript(L, { tag: "v1.2.0", version: "1.2.0" }), { MOCK_ARCH: "armhf" });
  assert.equal(r.code, 1);
  assert.match(r.out, /MIGRACIÓN DETENIDA: MiuraStation solo se publica para arm64.*amd64.*y este sistema es armhf/);
  assert.match(r.out, /Nada se ha cambiado/);
  assert.equal(fs.readFileSync(`${L.systemd}/miurastation.service`, "utf-8"), unit);
  assert.ok(has(sb, "active-miurastation.service") && !/curl|apt-get|systemctl stop/.test(calls(sb)));

  r = run(sb, migrationScript(L, { tag: "v1.2.0", version: "1.2.0" }), { MOCK_ARCH: "amd64" });
  assert.equal(r.code, 0, r.out);
  assert.match(calls(sb), /apt-get .*miurastation_1\.2\.0_amd64\.deb/);
  assert.ok(!calls(sb).includes("_arm64.deb"));
  assert.ok(miuraPackaged(L) && migrationState(L) === "none");
});

// A MiuraStation built from source as the .75 has it: its unit, drop-ins, the link and a finished migration.
function sourceInstall(sb: Sandbox) {
  const L = sb.L, dir = `${L.root}/miurastation`;
  fs.mkdirSync(`${dir}/target/release`, { recursive: true });
  fs.writeFileSync(`${dir}/config.toml`, "service_name = \"miurastation\"\n# mi config\n");
  fs.writeFileSync(`${L.systemd}/miurastation.service`, unitFile(PRODUCTS.miura, L));
  fs.mkdirSync(`${L.systemd}/miurastation.service.d`);
  fs.writeFileSync(`${L.systemd}/miurastation.service.d/10-cpu.conf`, "[Service]\nCPUAffinity=2 3\n");
  fs.writeFileSync(`${L.systemd}/miurastation.service.d/10-watchdog.conf`, watchdogConf(PRODUCTS.miura));
  if (canLink) fs.symlinkSync(dir, `${L.root}/flowstation`, "dir");
  fs.mkdirSync(migrationBackupDir(L));
  fs.writeFileSync(`${migrationBackupDir(L)}/done`, "");
  for (const f of ["active-miurastation.service", "enabled-miurastation.service"]) fs.writeFileSync(path.join(sb.state, f), "");
}

test("migration from a source-built MiuraStation: to the package and back with rollback.sh", { skip: !bashOk && "sin bash" }, () => {
  const sb = sandbox(), L = sb.L, BK = migrationBackupDir(L);
  sourceInstall(sb);
  publish(sb, "1.2.0");
  const unit = fs.readFileSync(`${L.systemd}/miurastation.service`, "utf-8");
  const cfg = fs.readFileSync(`${L.root}/miurastation/config.toml`, "utf-8");
  assert.deepEqual(migrationInfo(L), { state: "needed", kind: "source" });
  const r = run(sb, migrationScript(L, { tag: "v1.2.0", version: "1.2.0" }));
  assert.equal(r.code, 0, r.out);
  assert.ok(!fs.existsSync(`${L.systemd}/miurastation.service`), "the source unit no longer hides the package's");
  assert.ok(fs.existsSync(`${L.systemd}/miurastation.service.d/10-cpu.conf`), "drop-ins kept");
  assert.equal(fs.readFileSync(`${BK}/miurastation.service`, "utf-8"), unit);
  assert.equal(fs.readFileSync(`${BK}/kind`, "utf-8").trim(), "source");
  assert.ok(fs.existsSync(`${BK}/done`) && fs.readdirSync(L.root).some((f) => f.startsWith(".tlm-miurastation-migration.anterior-")));
  assert.equal(fs.readFileSync(`${L.root}/miurastation/config.toml`, "utf-8"), cfg);
  assert.ok(has(sb, "enabled-miurastation.service"), "still enabled");
  assert.ok(!has(sb, "active-miurastation.service") && fs.existsSync(MARK(L)), "stopped; Node starts it after the merge");
  assert.ok(miuraPackaged(L) && migrationState(L) === "none");
  if (canLink) assert.ok(isMigrationLink(L));

  // by hand, with the station on air again
  fs.rmSync(MARK(L));
  fs.writeFileSync(path.join(sb.state, "active-miurastation.service"), "");
  const rb = run(sb, `bash "${BK}/rollback.sh"`);
  assert.equal(rb.code, 0, rb.out);
  assert.ok(!has(sb, "pkg-version") && !fs.existsSync(pkgBinPath(L)), "package purged");
  assert.equal(fs.readFileSync(`${L.systemd}/miurastation.service`, "utf-8"), unit);
  assert.ok(has(sb, "enabled-miurastation.service") && has(sb, "active-miurastation.service"));
  assert.equal(fs.readFileSync(`${L.root}/miurastation/config.toml`, "utf-8"), cfg);
  assert.ok(!fs.existsSync(BK) && fs.readdirSync(L.root).some((f) => f.startsWith(".tlm-miurastation-migration.vuelta-atras-")));
  assert.deepEqual(migrationInfo(L), { state: "needed", kind: "source" });
});

test("migration cut in the middle of apt-get resumes and ends like a whole one", { skip: !bashOk && "sin bash" }, () => {
  const sb = sandbox(), L = sb.L, BK = migrationBackupDir(L);
  sourceInstall(sb);
  publish(sb, "1.2.0");
  let r = run(sb, migrationScript(L, { tag: "v1.2.0", version: "1.2.0" }), { MOCK_APT_KILL: "1" });
  assert.notEqual(r.code, 0);
  assert.deepEqual(migrationInfo(L), { state: "resume", kind: "source" });
  assert.ok(!fs.existsSync(`${L.systemd}/miurastation.service`) && fs.existsSync(MARK(L)));
  r = run(sb, migrationScript(L, { tag: "v1.2.0", version: "1.2.0" }));
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /la paró la ejecución que se cortó/);
  assert.ok(miuraPackaged(L) && migrationState(L) === "none" && fs.existsSync(`${BK}/done`));
  assert.ok(has(sb, "enabled-miurastation.service"), "enabled as before the first run");
  assert.ok(fs.existsSync(MARK(L)), "goes back on air at the end");
});

test("migration from the miura FlowStation: a failure undoes everything, then the move to the package", { skip: (!bashOk || !canLink) && "sin bash o sin enlaces" }, (t) => {
  try { execFileSync("git", ["--version"], { stdio: "ignore" }); } catch { t.skip("sin git"); return; }
  const sb = sandbox(), L = sb.L, BK = migrationBackupDir(L);
  const old = `${L.root}/flowstation`, neu = `${L.root}/miurastation`;
  repo(old, "https://github.com/ea5gvk/flowstation.git", "miura");
  const head = execFileSync("git", ["-C", old, "rev-parse", "HEAD"]).toString().trim();
  fs.writeFileSync(`${old}/config.toml`, "service_name = \"flowstation\"\n# mi config\n");
  fs.writeFileSync(`${L.systemd}/flowstation.service`, unitFile(PRODUCTS.razvan, L));
  fs.mkdirSync(`${L.systemd}/flowstation.service.d`);
  fs.writeFileSync(`${L.systemd}/flowstation.service.d/10-cpu.conf`, "[Service]\nCPUAffinity=2 3\n");
  for (const f of ["active-flowstation.service", "enabled-flowstation.service"]) fs.writeFileSync(path.join(sb.state, f), "");
  publish(sb, "1.2.0");
  assert.deepEqual(migrationInfo(L), { state: "needed", kind: "legacy" });

  let r = run(sb, migrationScript(L, { tag: "v1.2.0", version: "1.2.0" }), { MOCK_APT_FAIL: "1" });
  assert.equal(r.code, 1);
  assert.match(r.out, /MIGRACIÓN FALLIDA/);
  assert.ok(!isLink(old) && fs.existsSync(`${old}/config.toml`) && !fs.existsSync(neu), "the directory went back");
  assert.equal(execFileSync("git", ["-C", old, "rev-parse", "HEAD"]).toString().trim(), head);
  assert.ok(fs.existsSync(`${L.systemd}/flowstation.service`) && fs.existsSync(`${L.systemd}/flowstation.service.d/10-cpu.conf`));
  assert.ok(has(sb, "enabled-flowstation.service") && has(sb, "active-flowstation.service"), "back on air");
  assert.ok(!fs.existsSync(BK) && migrationState(L) === "needed");

  r = run(sb, migrationScript(L, { tag: "v1.2.0", version: "1.2.0" }));
  assert.equal(r.code, 0, r.out);
  assert.ok(isMigrationLink(L));
  assert.equal(fs.readFileSync(`${neu}/config.toml`, "utf-8"), "service_name = \"miurastation\"\n# mi config\n");
  assert.ok(!fs.existsSync(`${L.systemd}/flowstation.service`) && !fs.existsSync(`${L.systemd}/miurastation.service`));
  assert.ok(fs.existsSync(`${L.systemd}/miurastation.service.d/10-cpu.conf`), "drop-ins moved");
  assert.ok(has(sb, "enabled-miurastation.service") && !has(sb, "enabled-flowstation.service"));
  assert.ok(fs.existsSync(MARK(L)) && miuraPackaged(L) && migrationState(L) === "none");
  assert.equal(fs.readFileSync(`${BK}/legacy-head`, "utf-8").trim(), head);
});
