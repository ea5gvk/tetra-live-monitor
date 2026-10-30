// node --test via tsx:  npm test
// DMR Tier III: releases, the KEY=VALUE conf and its help, the live-log whitelist, the aggregated state and the very
// package script run by bash against a temporary layout (mocked sudo/systemctl/dpkg/apt-get/curl).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";
import { execFileSync, spawnSync } from "child_process";
import { PI_LAYOUT, type Layout } from "./stationScripts";
import {
  DMR, DMR_DEB, DMR_CORE_UNITS, DMR_JOURNAL_UNITS, parseDmrRelease, parseDmrReleases, dmrTagFrom, dmrHealth, dmrPackageScript,
  parseDmrConf, parseDmrConfHelp, updateDmrConf, writeDmrConf, saveDmrConf, genConfigErrors, logStreamCommand,
} from "./dmrStation";

const rel = (tag: string, extra: Record<string, unknown> = {}) => ({ tag_name: tag, name: `x ${tag}`, published_at: "2026-10-30T10:00:00Z", html_url: `https://github.com/ea5gvk/MiuraStation-dist/releases/tag/${tag}`, ...extra });

test("releases: only dmr-tier3-vX.Y.Z tags, no drafts, the highest version; none published is not an error", () => {
  assert.equal(DMR.pkg, "dmr-tier3");
  assert.equal(DMR.target, "dmr-tier3.target");
  assert.equal(DMR.confPath, "/etc/dmr-tier3/dmr-tier3.conf");
  assert.equal(DMR_DEB.asset("0.2.0", "arm64"), "dmr-tier3_0.2.0-1_arm64.deb");
  assert.deepEqual(DMR_DEB.arches, ["arm64"]);
  const r = parseDmrRelease(rel("dmr-tier3-v0.2.0", { prerelease: true }));
  assert.deepEqual(r, { tag: "dmr-tier3-v0.2.0", version: "0.2.0", name: "x dmr-tier3-v0.2.0", date: "2026-10-30T10:00:00Z",
    url: "https://github.com/ea5gvk/MiuraStation-dist/releases/tag/dmr-tier3-v0.2.0", prerelease: true });
  assert.equal(parseDmrRelease(rel("v1.4.0")), null, "a MiuraStation tag");
  assert.equal(parseDmrRelease(rel("dmr-tier3-v0.2.0", { draft: true })), null);
  assert.equal(parseDmrRelease(rel("dmr-tier3-v0.2.0; rm -rf /")), null);
  assert.equal(parseDmrRelease({ message: "Not Found" }), null);
  const list = [rel("v1.4.0"), rel("dmr-tier3-v0.2.0"), rel("dmr-tier3-v0.10.0", { draft: true }), rel("dmr-tier3-v0.3.0-beta.1", { prerelease: true }), rel("dmr-tier3-v0.2.1")];
  assert.equal(parseDmrReleases(list)?.tag, "dmr-tier3-v0.3.0-beta.1", "the highest that is not a draft (a pre-release counts)");
  assert.equal(parseDmrReleases([rel("v1.4.0"), rel("v1.3.0")]), null, "MiuraStation releases only: none published");
  assert.equal(parseDmrReleases([]), null);
  assert.equal(parseDmrReleases({ message: "rate limited" }), null);
  assert.equal(dmrTagFrom(undefined), undefined);
  assert.equal(dmrTagFrom(""), undefined);
  assert.equal(dmrTagFrom("0.2.0"), "dmr-tier3-v0.2.0");
  assert.equal(dmrTagFrom("v0.2.0"), "dmr-tier3-v0.2.0");
  assert.equal(dmrTagFrom("dmr-tier3-v0.2.0-rc.1"), "dmr-tier3-v0.2.0-rc.1");
  assert.equal(dmrTagFrom("0.2"), null);
  assert.equal(dmrTagFrom("0.2.0; id"), null);
  assert.equal(dmrTagFrom(3), null);
});

test("state: active only with the target and both core units up; a target active with one down is degraded", () => {
  assert.deepEqual(DMR_CORE_UNITS, ["mmdvm-multi.service", "dmrtc.service"]);
  assert.deepEqual(dmrHealth(false, () => true), { active: false, degraded: false, missing: [] });
  assert.deepEqual(dmrHealth(true, () => true), { active: true, degraded: false, missing: [] });
  assert.deepEqual(dmrHealth(true, (u) => u === "dmrtc.service"), { active: false, degraded: true, missing: ["mmdvm-multi.service"] });
  assert.deepEqual(dmrHealth(true, () => false), { active: false, degraded: true, missing: ["mmdvm-multi.service", "dmrtc.service"] });
});

const EXAMPLE = `# /etc/dmr-tier3/dmr-tier3.conf — parámetros de la estación DMR Tier III
#
# Formato: CLAVE=VALOR, una por línea.

# ---------------------------------------------------------------- Identidad
# Indicativo de la estación. Obligatorio.
CALLSIGN=
# ID DMR de la estación (1..16777215). Obligatorio. Es el Id de MMDVM-Host y el Id general de
# DMRGateway.
DMR_ID=

# ---------------------------------------------------------------- Canales y frecuencias
# Número de portadoras DMR (1..4).
N_CHANNELS=3
TX_FREQUENCY=438425000

# ---------------------------------------------------------------- Pasarela IP (DMRGateway)
# Máster al que se conecta la pasarela.
NET_ADDRESS=192.0.2.10
# Contraseña del máster. Vacío = rellenar.
NET_PASSWORD=
`;

test("conf help: each key with its default, the # lines right above it and its section banner", () => {
  const h = parseDmrConfHelp(EXAMPLE);
  assert.deepEqual(h.map((k) => k.key), ["CALLSIGN", "DMR_ID", "N_CHANNELS", "TX_FREQUENCY", "NET_ADDRESS", "NET_PASSWORD"]);
  assert.deepEqual(h[0], { key: "CALLSIGN", default: "", help: "Indicativo de la estación. Obligatorio.", section: "Identidad" });
  assert.equal(h[1].help, "ID DMR de la estación (1..16777215). Obligatorio. Es el Id de MMDVM-Host y el Id general de\nDMRGateway.");
  assert.deepEqual(h[2], { key: "N_CHANNELS", default: "3", help: "Número de portadoras DMR (1..4).", section: "Canales y frecuencias" });
  assert.equal(h[3].help, "", "a key without comment lines above it");
  assert.equal(h[3].section, "Canales y frecuencias");
  assert.deepEqual(h[5], { key: "NET_PASSWORD", default: "", help: "Contraseña del máster. Vacío = rellenar.", section: "Pasarela IP (DMRGateway)" });
  assert.deepEqual(parseDmrConfHelp(""), []);
});

test("conf: values read; a write keeps comments and order, appends what is new, keeps the secret and refuses unknown keys", () => {
  const conf = `# mi estación\nCALLSIGN=EA5GVK\n\n# el id\nDMR_ID=2147001\nN_CHANNELS=3\nNET_PASSWORD=secreta\n`;
  assert.deepEqual(parseDmrConf(conf), { CALLSIGN: "EA5GVK", DMR_ID: "2147001", N_CHANNELS: "3", NET_PASSWORD: "secreta" });
  assert.deepEqual(parseDmrConf("A=1\n# B=2\nA=3\n  C = 4 \nnot a line\n"), { A: "1", C: "4" }, "comments skipped, the first of a repeated key");
  const known = parseDmrConfHelp(EXAMPLE).map((k) => k.key);
  const out = updateDmrConf(conf, { N_CHANNELS: 2, CALLSIGN: " ea5gvk ", TX_FREQUENCY: "438450000" }, known);
  assert.equal(out, `# mi estación\nCALLSIGN=ea5gvk\n\n# el id\nDMR_ID=2147001\nN_CHANNELS=2\nNET_PASSWORD=secreta\nTX_FREQUENCY=438450000\n`);
  assert.equal(updateDmrConf(conf, { NET_PASSWORD: "" }, known), conf, "an empty secret keeps the saved one");
  assert.equal(updateDmrConf(conf, { NET_PASSWORD: undefined, DMR_ID: null }, known), conf, "absent values change nothing");
  assert.equal(updateDmrConf(conf, { NET_PASSWORD: "otra" }, known), conf.replace("NET_PASSWORD=secreta", "NET_PASSWORD=otra"));
  assert.equal(updateDmrConf("A=1", { CALLSIGN: "X" }, known), "A=1\nCALLSIGN=X\n", "appended after a file without a final newline");
  assert.throws(() => updateDmrConf(conf, { COLOR: "1" }, known), /clave desconocida: COLOR/);
  assert.throws(() => updateDmrConf(conf, { callsign: "x" }, known), /clave desconocida: callsign/);
  assert.throws(() => updateDmrConf(conf, { "CALLSIGN=X\nDMR_ID": "1" }, known), /clave desconocida/);
  assert.throws(() => updateDmrConf(conf, { CALLSIGN: "X\nDMR_ID=1" }, known), /saltos de línea/);
  // the comment "# NET_PASSWORD=..." of an example is not the value
  assert.equal(updateDmrConf("# CALLSIGN=EJEMPLO\nCALLSIGN=A\n", { CALLSIGN: "B" }, known), "# CALLSIGN=EJEMPLO\nCALLSIGN=B\n");

  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tlm-dmr-conf-"));
  const file = path.join(d, "dmr-tier3.conf");
  const ex = path.join(d, "dmr-tier3.conf.example");
  fs.writeFileSync(ex, EXAMPLE);
  let w = writeDmrConf(file, { CALLSIGN: "EA5GVK", N_CHANNELS: "2" }, undefined, ex);
  assert.equal(w.backup, null, "a new file: no copy");
  assert.equal(fs.readFileSync(file, "utf-8"), "CALLSIGN=EA5GVK\nN_CHANNELS=2\n");
  if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  w = writeDmrConf(file, { CALLSIGN: "EA5GVK" }, undefined, ex);
  assert.equal(w.backup, null, "nothing changed: nothing written");
  w = writeDmrConf(file, { DMR_ID: "2147001" }, undefined, ex);
  assert.ok(w.backup && fs.existsSync(w.backup) && path.basename(w.backup).startsWith("dmr-tier3.conf.bak-dmr-"), String(w.backup));
  assert.equal(fs.readFileSync(w.backup!, "utf-8"), "CALLSIGN=EA5GVK\nN_CHANNELS=2\n");
  assert.equal(fs.readFileSync(file, "utf-8"), "CALLSIGN=EA5GVK\nN_CHANNELS=2\nDMR_ID=2147001\n");
  assert.throws(() => writeDmrConf(file, { NOPE: "1" }, undefined, ex), /clave desconocida: NOPE/);
  // without an example the keys of the file are the known ones
  assert.throws(() => writeDmrConf(file, { TX_FREQUENCY: "1" }, undefined, path.join(d, "missing")), /clave desconocida: TX_FREQUENCY/);
  assert.equal(saveDmrConf(file, fs.readFileSync(file, "utf-8")), null);
  fs.rmSync(d, { recursive: true, force: true });
});

test("gen-config errors: the '  - ' lines of an invalid conf, else stderr, else the exit code", () => {
  assert.deepEqual(genConfigErrors(0, "Plan de canales\n", ""), []);
  assert.deepEqual(genConfigErrors(2, "", "gen-config: configuración no válida:\n  - CALLSIGN: obligatorio\n  - DMR_ID: debe ser un número entero (vale 'x')\n"),
    ["CALLSIGN: obligatorio", "DMR_ID: debe ser un número entero (vale 'x')"]);
  assert.deepEqual(genConfigErrors(3, "", "gen-config: dmrtc.service está activo y reescribe dmrtc.cfg al salir; páralo antes\n"),
    ["gen-config: dmrtc.service está activo y reescribe dmrtc.cfg al salir; páralo antes"]);
  assert.deepEqual(genConfigErrors(1, "", ""), ["gen-config.py ha terminado con código 1"]);
});

test("live log: the closed list of presets, one unit, the whole journal; never a free path", () => {
  assert.deepEqual(logStreamCommand({ service: "dmr" }), { cmd: "journalctl", args: [
    "-u", "mmdvm-multi", "-u", "mmdvm-iq@*", "-u", "mmdvm-host@*", "-u", "dmrtc", "-u", "dmrgateway", "-f", "-n", "100", "-o", "short", "--no-pager"] });
  assert.deepEqual(DMR_JOURNAL_UNITS, ["mmdvm-multi", "mmdvm-iq@*", "mmdvm-host@*", "dmrtc", "dmrgateway"]);
  assert.deepEqual(logStreamCommand({ file: "dmrtc" }), { cmd: "tail", args: ["-n", "100", "-F", "/var/lib/dmr-tier3/.config/dmrtc/dmrtc.log"] });
  assert.deepEqual(logStreamCommand({ service: "mmdvm-iq@1.service" }), { cmd: "journalctl", args: ["-u", "mmdvm-iq@1.service", "-f", "-n", "50", "--no-pager"] });
  assert.deepEqual(logStreamCommand({}), { cmd: "journalctl", args: ["-f", "-n", "50", "--no-pager"] });
  assert.deepEqual(logStreamCommand({ service: "a b; id" }), { cmd: "journalctl", args: ["-f", "-n", "50", "--no-pager"] }, "an invalid unit: the whole journal, as always");
  assert.deepEqual(logStreamCommand({ file: "" }), { cmd: "journalctl", args: ["-f", "-n", "50", "--no-pager"] });
  for (const file of ["/var/lib/dmr-tier3/.config/dmrtc/dmrtc.log", "../../etc/shadow", "syslog", "dmrtc.log", ["dmrtc"], 1]) {
    assert.equal(logStreamCommand({ file }), null, String(file));
  }
  assert.equal(logStreamCommand({ service: "dmr", file: "/etc/passwd" }), null, "a file wins and is refused");
});

// ── End to end: the package script, run by bash against a temporary layout ──
// Mocked: sudo (runs the command), systemctl (unit states as files), dpkg/dpkg-query (the dmr-tier3 package),
// apt-get (installs a fake .deb: the binaries under $MOCK_OPT and the dpkg version), apt-cache and curl (serves the
// release assets).
const MOCKS: Record<string, string> = {
  sudo: `exec "$@"`,
  systemctl: `echo "systemctl $*" >> "$MOCK_LOG"
q=0; args=()
for a in "$@"; do case "$a" in --quiet|-q) q=1 ;; --no-block|--system) ;; *) args+=("$a") ;; esac; done
cmd=\${args[0]:-}; u=\${args[1]:-}; S="$MOCK_STATE"
case "$cmd" in
  is-active) if [ -f "$S/active-$u" ]; then [ $q = 1 ] || echo active; exit 0; fi; [ $q = 1 ] || echo inactive; exit 3 ;;
  is-enabled) if [ -f "$S/enabled-$u" ]; then [ $q = 1 ] || echo enabled; exit 0; fi; [ $q = 1 ] || echo disabled; exit 1 ;;
  start|restart) touch "$S/active-$u" ;;
  stop) rm -f "$S/active-$u" ;;
  enable) touch "$S/enabled-$u" ;;
  disable) rm -f "$S/enabled-$u" ;;
esac
exit 0`,
  dpkg: `echo "dpkg $*" >> "$MOCK_LOG"
[ "$1" = --print-architecture ] && echo "\${MOCK_ARCH:-arm64}"
exit 0`,
  "dpkg-query": `[ -f "$MOCK_STATE/pkg-version" ] || { echo "dpkg-query: no packages found matching dmr-tier3" >&2; exit 1; }
case "$*" in *Version*) cat "$MOCK_STATE/pkg-version" ;; *) echo "dmr-tier3 $(cat "$MOCK_STATE/pkg-version")" ;; esac`,
  "apt-get": `echo "apt-get $*" >> "$MOCK_LOG"
cmd=""; deb=""
for a in "$@"; do case "$a" in install|purge|update) cmd=$a ;; *.deb) deb=$a ;; esac; done
case "$cmd" in
  install)
    [ -n "\${MOCK_APT_FAIL:-}" ] && { echo "E: fallo simulado" >&2; exit 100; }
    mkdir -p "$MOCK_OPT/bin" "$MOCK_OPT/share"
    for b in MMDVM-Multi MMDVM-IQ MMDVM-Host DMRGateway dmrtc; do echo "ELF $b" > "$MOCK_OPT/bin/$b"; done
    sed -n 's/^Version: //p' "$deb" > "$MOCK_STATE/pkg-version"
    # the postinst: the conf from the example when there is none; a running stack is restarted on an upgrade
    [ -e "$MOCK_ETC/dmr-tier3.conf" ] || { mkdir -p "$MOCK_ETC"; echo "CALLSIGN=" > "$MOCK_ETC/dmr-tier3.conf"; }
    [ -f "$MOCK_STATE/active-dmr-tier3.target" ] && echo "postinst restart" >> "$MOCK_LOG"
    ;;
esac
exit 0`,
  "apt-cache": `exit 0`,
  curl: `out=""; url=""
while [ $# -gt 0 ]; do case "$1" in -o) out=$2; shift ;; http*) url=$1 ;; esac; shift; done
echo "curl $url" >> "$MOCK_LOG"
rest=\${url%/*}; f="$MOCK_RELEASES/\${rest##*/}/\${url##*/}"
[ -f "$f" ] || { echo "curl: (22) The requested URL returned error: 404" >&2; exit 22; }
cp "$f" "$out"`,
};

interface Sandbox { L: Layout; state: string; log: string; releases: string; opt: string; etc: string; env: NodeJS.ProcessEnv }
function sandbox(): Sandbox {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tlm-dmr-"));
  const at = (x: string) => { fs.mkdirSync(path.join(d, x)); return path.join(d, x).replace(/\\/g, "/"); };
  const L: Layout = { root: at("root"), systemd: at("systemd"), tmp: at("tmp"), pkgSystemd: at("lib-systemd"), usr: at("usr") };
  const bin = at("mockbin"), state = at("state"), releases = at("releases"), opt = `${d.replace(/\\/g, "/")}/opt`, etc = at("etc");
  for (const [name, body] of Object.entries(MOCKS)) fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
  const log = path.join(d, "calls.log");
  fs.writeFileSync(log, "");
  const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  const env: NodeJS.ProcessEnv = {
    ...process.env, [pathKey]: `${bin}${path.delimiter}${process.env[pathKey]}`,
    MSYS: "winsymlinks:nativestrict", MOCK_LOG: log, MOCK_STATE: state, MOCK_RELEASES: releases, MOCK_OPT: opt, MOCK_ETC: etc,
  };
  return { L, state, log, releases, opt, etc, env };
}
// A release dmr-tier3-vX.Y.Z of ea5gvk/MiuraStation-dist: the arm64 .deb, the sources tarball line and one SHA256SUMS.
function publish(sb: Sandbox, version: string, opts: { badSum?: boolean } = {}) {
  const dir = path.join(sb.releases, `dmr-tier3-v${version}`);
  fs.mkdirSync(dir);
  const deb = DMR_DEB.asset(version, "arm64");
  const body = `Version: ${version.replace("-", "~")}-1\n`;
  fs.writeFileSync(path.join(dir, deb), body);
  const sum = crypto.createHash("sha256").update(opts.badSum ? "otra cosa" : body).digest("hex");
  fs.writeFileSync(path.join(dir, "SHA256SUMS"), `${sum}  ${deb}\n${"0".repeat(64)}  dmr-tier3-${version}-src.tar.gz\n`);
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

test("package script: set -euo pipefail, the release's .deb and SHA256SUMS, never enable/start, no config.toml", () => {
  const s = dmrPackageScript(PI_LAYOUT, { mode: "install", tag: "dmr-tier3-v0.2.0", version: "0.2.0" });
  assert.match(s, /^set -euo pipefail$/m);
  assert.ok(s.includes("https://github.com/ea5gvk/MiuraStation-dist/releases/download/$TAG"));
  assert.ok(s.includes("TAG='dmr-tier3-v0.2.0'; VER='0.2.0'"));
  assert.ok(s.includes("  arm64) DEB='dmr-tier3_0.2.0-1_arm64.deb' ;;") && !s.includes("amd64)"), "arm64 only");
  assert.ok(s.includes("sha256sum -c deb.sha256") && s.includes("flock -n 9"));
  assert.ok(s.includes("dpkg-query -W -f='${Version}' dmr-tier3"));
  assert.ok(!/systemctl (enable|start|restart)|config\.toml|cargo|git clone|miurastation|watchdog/.test(s), s);
  const u = dmrPackageScript(PI_LAYOUT, { mode: "update", tag: "dmr-tier3-v0.3.0", version: "0.3.0", allowDowngrade: true });
  assert.ok(u.includes("--allow-downgrades") && u.includes("is-active --quiet dmr-tier3.target"));
  assert.ok(!s.includes("--allow-downgrades"));
});

test("package: an unsupported arch and a bad sum install nothing; the install leaves the stack to the selector; update", { skip: !bashOk && "sin bash" }, () => {
  const sb = sandbox(), L = sb.L;
  publish(sb, "0.2.0");
  publish(sb, "0.2.1", { badSum: true });
  const install = (version: string) => dmrPackageScript(L, { mode: "install", tag: `dmr-tier3-v${version}`, version });
  let r = run(sb, install("0.2.0"), { MOCK_ARCH: "amd64" });
  assert.equal(r.code, 1);
  assert.match(r.out, /DMR Tier III solo se publica para arm64 \(Raspberry Pi 5 con Debian 13 de 64 bits\), y este sistema es amd64/);
  r = run(sb, install("0.2.0"), { MOCK_ARCH: "armhf" });
  assert.equal(r.code, 1);
  assert.match(r.out, /y este sistema es armhf/);
  assert.ok(!/curl/.test(calls(sb)), "an unsupported arch downloads nothing");
  r = run(sb, install("0.2.1"));
  assert.equal(r.code, 1);
  assert.match(r.out, /SHA-256 de dmr-tier3_0\.2\.1-1_arm64\.deb no coincide/);
  r = run(sb, install("9.9.9"));
  assert.equal(r.code, 1);
  assert.match(r.out, /no se ha podido descargar SHA256SUMS/);
  assert.ok(!/apt-get/.test(calls(sb)) && !has(sb, "pkg-version"), "nothing installed after a refusal");
  assert.ok(!fs.existsSync(`${sb.opt}/bin/MMDVM-Multi`));

  r = run(sb, install("0.2.0"));
  assert.equal(r.code, 0, r.out);
  assert.equal(pkgVersion(sb), "0.2.0-1");
  assert.match(r.out, /dmr-tier3 0\.2\.0-1 instalado \(\/opt\/dmr-tier3\)/);
  assert.match(r.out, /Instalación completada: DMR Tier III 0\.2\.0/);
  assert.match(r.out, /formulario DMR/);
  assert.ok(fs.existsSync(`${sb.opt}/bin/MMDVM-Multi`) && fs.existsSync(`${sb.etc}/dmr-tier3.conf`), "the postinst's work");
  const log = calls(sb);
  assert.match(log, /curl https:\/\/github\.com\/ea5gvk\/MiuraStation-dist\/releases\/download\/dmr-tier3-v0\.2\.0\/SHA256SUMS/);
  assert.match(log, /curl .*\/dmr-tier3-v0\.2\.0\/dmr-tier3_0\.2\.0-1_arm64\.deb/);
  assert.match(log, /apt-get install -y -o Dpkg::Options::=--force-confold .*dmr-tier3_0\.2\.0-1_arm64\.deb/);
  assert.ok(!/systemctl (enable|start)/.test(log), "the selector enables and starts it, not the install");
  assert.ok(!has(sb, "enabled-dmr-tier3.target") && !has(sb, "active-dmr-tier3.target"));
  assert.deepEqual(fs.readdirSync(L.tmp).filter((f) => f.startsWith("dmr-tier3-deb.")), [], "download directory removed");

  // update with the stack on air: the script does not stop it (the postinst restarts it), and a failed apt-get is an error
  fs.writeFileSync(path.join(sb.state, "active-dmr-tier3.target"), "");
  publish(sb, "0.3.0");
  fs.writeFileSync(sb.log, "");
  r = run(sb, dmrPackageScript(L, { mode: "update", tag: "dmr-tier3-v0.3.0", version: "0.3.0" }), { MOCK_APT_FAIL: "1" });
  assert.equal(r.code, 1);
  assert.match(r.out, /apt-get update/);
  assert.match(r.out, /ERROR: apt-get install ha fallado/);
  assert.equal(pkgVersion(sb), "0.2.0-1");
  r = run(sb, dmrPackageScript(L, { mode: "update", tag: "dmr-tier3-v0.3.0", version: "0.3.0" }));
  assert.equal(r.code, 0, r.out);
  assert.equal(pkgVersion(sb), "0.3.0-1");
  assert.match(r.out, /está en marcha: el paquete la para y la vuelve a arrancar/);
  assert.match(r.out, /Actualización instalada: DMR Tier III 0\.3\.0/);
  assert.ok(!/systemctl (stop|start|enable|disable)/.test(calls(sb)) && /postinst restart/.test(calls(sb)));
  // a pre-release: the ~ of dpkg
  publish(sb, "0.4.0-beta.1");
  r = run(sb, dmrPackageScript(L, { mode: "update", tag: "dmr-tier3-v0.4.0-beta.1", version: "0.4.0-beta.1" }));
  assert.equal(r.code, 0, r.out);
  assert.equal(pkgVersion(sb), "0.4.0~beta.1-1");
});
