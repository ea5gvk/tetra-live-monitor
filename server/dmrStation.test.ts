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
  dmrShared, hasDmrWindowBlock, genConfigKnowsShared, startedBeforeChange, dmrWindowOffLine, DMR_WINDOW_MIURA_MIN,
  DMR_CORE_UNITS_TIER2, dmrTier2, dmrCoreUnits, DMR_SECRET_KEYS, dmrConfRows, isInDmrConfDir,
  dmrDebAsset, dmrReleaseAsset, dmrOs, dmrSystemFrom, dmrInstallability,
} from "./dmrStation";
import { compareVersions, debUpstreamVersion } from "./stationScripts";

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

test("Tier II: applied = gen-config's marker exists; its core units are mmdvm-multi + mmdvm-host@1 (no dmrtc)", () => {
  assert.equal(DMR.tier2Marker, "/etc/dmr-tier3/tier2");
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tlm-dmr-tier2-"));
  const marker = path.join(d, "tier2");
  assert.equal(dmrTier2(marker), false, "no marker: Tier III, as always");
  fs.writeFileSync(marker, "# Generado por gen-config.py (DMR_TIER=2). No editar: se borra con DMR_TIER=3.\n");
  assert.equal(dmrTier2(marker), true);
  fs.rmSync(d, { recursive: true, force: true });
  assert.deepEqual(dmrCoreUnits(false), ["mmdvm-multi.service", "dmrtc.service"]);
  assert.equal(dmrCoreUnits(false), DMR_CORE_UNITS, "Tier III: the very list of today");
  assert.deepEqual(dmrCoreUnits(true), ["mmdvm-multi.service", "mmdvm-host@1.service"]);
  assert.deepEqual(DMR_CORE_UNITS_TIER2, ["mmdvm-multi.service", "mmdvm-host@1.service"]);
  // health with the Tier II units: dmrtc does not count, the repeater's MMDVM-Host does
  const up = (...units: string[]) => (u: string) => units.includes(u);
  const t2 = dmrCoreUnits(true);
  assert.deepEqual(dmrHealth(true, up("mmdvm-multi.service", "mmdvm-host@1.service"), t2), { active: true, degraded: false, missing: [] });
  assert.deepEqual(dmrHealth(true, up("mmdvm-multi.service", "dmrtc.service"), t2), { active: false, degraded: true, missing: ["mmdvm-host@1.service"] });
  assert.deepEqual(dmrHealth(true, up("mmdvm-host@1.service"), t2), { active: false, degraded: true, missing: ["mmdvm-multi.service"] });
  assert.deepEqual(dmrHealth(false, () => true, t2), { active: false, degraded: false, missing: [] });
  // ... and with the Tier III ones (the default) the same radios without dmrtc are degraded
  assert.deepEqual(dmrHealth(true, up("mmdvm-multi.service", "mmdvm-host@1.service")), { active: false, degraded: true, missing: ["dmrtc.service"] });
  assert.deepEqual(dmrHealth(true, up("mmdvm-multi.service", "mmdvm-host@1.service"), dmrCoreUnits(false)), { active: false, degraded: true, missing: ["dmrtc.service"] });
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
  assert.throws(() => updateDmrConf(conf, { CALLSIGN: "X\rDMR_ID=1" }, known), /saltos de línea/);
  assert.throws(() => updateDmrConf(conf, { CALLSIGN: "a\tb" }, known), /caracteres de control/);
  assert.throws(() => updateDmrConf(conf, { CALLSIGN: "a\x00b" }, known), /caracteres de control/);
  assert.throws(() => updateDmrConf(conf, { CALLSIGN: "a\x1b[31mb" }, known), /caracteres de control/);
  assert.throws(() => updateDmrConf(conf, { NET_ADDRESS: "x".repeat(4097) }, known), /4096 caracteres/);
  assert.equal(updateDmrConf("A=1\n", { NET_ADDRESS: "x".repeat(4096) }, known), `A=1\nNET_ADDRESS=${"x".repeat(4096)}\n`);
  assert.throws(() => updateDmrConf(conf, { CALLSIGN: { a: 1 } }, known), /valor no válido/);
  assert.throws(() => updateDmrConf(conf, { CALLSIGN: ["EA5GVK"] }, known), /valor no válido/);
  assert.equal(updateDmrConf("A=1\n", { DMR_ID: 2147001, TX_FREQUENCY: true }, known), "A=1\nDMR_ID=2147001\nTX_FREQUENCY=true\n", "numbers and booleans as text");
  // shell metacharacters are data: the conf is only read by gen-config.py (never sourced by a shell), which checks
  // each key by its own rules, so they are written verbatim, never escaped nor run
  const nasty = "x; rm -rf / $(id) `id` 'a' \"b\" & | > /etc/passwd ${HOME} \\";
  assert.equal(updateDmrConf("A=1\n", { CALLSIGN: nasty, NET_ADDRESS: " con espacios  dentro " }, known),
    `A=1\nCALLSIGN=${nasty}\nNET_ADDRESS=con espacios  dentro\n`);
  assert.equal(updateDmrConf("CALLSIGN=A\n", { CALLSIGN: "#no es comentario" }, known), "CALLSIGN=#no es comentario\n");
  assert.equal(updateDmrConf("CALLSIGN=A\n", { CALLSIGN: "" }, known), "CALLSIGN=\n", "an empty value of a non-secret is written (gen-config decides)");
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

// The SDR_COMPARTIDO key of dmr-tier3.conf.example (0.4.0), as the form reads it.
const EXAMPLE_SHARED = `# ---------------------------------------------------------------- Radio (SX1255 / SoapySX)
# Uso del SX1255. 0 = exclusivo: MMDVM-Multi abre la SDR y la estación DMR sustituye a la TETRA
# (como hasta 0.3.x). 1 = compartido: MiuraStation (1.4.0 o posterior) sigue con la SDR y pasa a
# MMDVM-Multi una ventana de 150 kHz alrededor de los canales DMR: TETRA y DMR a la vez.
# gen-config.py la comprueba contra /root/miurastation/config.toml (sin pisar portadoras TETRA,
# dentro de la banda de la SDR) y escribe allí la sección [dmr_window]; hay que
# reiniciar miurastation para aplicarla (el panel lo hace). En compartido no se usan RX_GAIN,
# TX_GAIN ni las antenas, DIGITAL_GAIN es el nivel DMR frente a la TETRA y RSSI_CALIBRATION se
# vuelve a ajustar.
SDR_COMPARTIDO=0
# Ganancia agregada de recepción que MMDVM-Multi pide a SoapySDR (0..100). Rafa: 50.
RX_GAIN=50
`;

test("conf help: SDR_COMPARTIDO is a 0/1 switch of the Radio section (its help has '0 = ' and '1 = ', no range)", () => {
  const h = parseDmrConfHelp(EXAMPLE_SHARED);
  assert.deepEqual(h.map((k) => k.key), ["SDR_COMPARTIDO", "RX_GAIN"]);
  assert.equal(h[0].default, "0");
  assert.equal(h[0].section, "Radio (SX1255 / SoapySX)");
  assert.match(h[0].help, /(^|\s)0 = exclusivo/);
  assert.match(h[0].help, /(^|\s)1 = compartido/);
  assert.ok(!/(\d+)\.\.(\d+|N_CHANNELS)\)/.test(h[0].help), "'(1.4.0 o posterior)' is not a range of the form");
  assert.equal(h[1].help, "Ganancia agregada de recepción que MMDVM-Multi pide a SoapySDR (0..100). Rafa: 50.");
  assert.ok(!("choices" in h[0]) && !("choices" in h[1]), "'0 = ' and '1 = ' inside a line are not a list of values");
});

// The DMR_TIER key of dmr-tier3.conf.example (Tier II), as the form reads it: each value on its own line.
const EXAMPLE_TIER = `# ---------------------------------------------------------------- Identidad
# Nivel DMR de la estación:
# 2 = Tier II: repetidor convencional (2 ranuras, código de color, red Homebrew por DMRGateway),
#     para cualquier radio DMR, sin dmrtc. Necesita N_CHANNELS=1.
# 3 = Tier III: troncal con dmrtc (como hasta ahora).
DMR_TIER=3
# 1 = registro obligatorio (Rafa: 1). 0 = sistema abierto.
REGISTRATION=1
# Modo:
# 1 = uno
# 1 = otra vez uno
MODE=1
`;

test("conf help: a help with lines '2 = ' / '3 = ' lists the choices of the key (DMR_TIER); one such line is not a list", () => {
  const h = parseDmrConfHelp(EXAMPLE_TIER);
  assert.deepEqual(h.map((k) => k.key), ["DMR_TIER", "REGISTRATION", "MODE"]);
  assert.deepEqual(h[0].choices, ["2", "3"]);
  assert.equal(h[0].default, "3");
  assert.equal(h[0].section, "Identidad");
  assert.match(h[0].help, /^Nivel DMR de la estación:\n2 = Tier II: .*\n {4}para cualquier radio DMR, sin dmrtc\. Necesita N_CHANNELS=1\.\n3 = Tier III: /);
  assert.ok(!("choices" in h[1]), "one line with '1 = ' (and '0 = ' inside it): the 0/1 switch, as always");
  assert.ok(!("choices" in h[2]), "the same value twice is one value");
  assert.ok(parseDmrConfHelp(EXAMPLE).every((k) => !("choices" in k)));
});

// Las claves de Tier II multired (dmr-tier3 0.6.0) como las escribe el ejemplo: NET_NAME y NET_ROUTES en la
// pasarela y una sección "(solo Tier II)" por cada red 2, 3 y 4.
const redSection = (n: number) => `# ---------------------------------------------------------------- Red DMR ${n} (solo Tier II)
# 1 = la pasarela se conecta también a esta red (solo con DMR_TIER=2). 0 = no se usa.
NET${n}_ENABLED=0
# Nombre de la red en DMRGateway: letras, cifras, espacio, punto, guion y guion bajo, de 1 a 20
# caracteres.
NET${n}_NAME=Red ${n}
# Máster de esta red (IP o nombre). Obligatorio si la red está activa.
NET${n}_ADDRESS=
# Puerto del máster de esta red (1..65535).
NET${n}_PORT=62031
# ID con el que la pasarela se presenta a esta red (1..2147483647). Vacío: el mismo NET_ID.
NET${n}_ID=
# Contraseña del máster de esta red. Obligatoria si la red está activa; aquí nunca va la clave
# real. (Queda en DMRGateway.ini con permisos 0600.)
NET${n}_PASSWORD=
# Enrutado de esta red, con la misma sintaxis que NET_ROUTES (por ejemplo S2 o S1:P9).
# Obligatorio si la red está activa.
NET${n}_ROUTES=
`;
const EXAMPLE_MULTIRED = `# ---------------------------------------------------------------- Pasarela IP (DMRGateway)
# Contraseña del máster. Vacío = rellenar; aquí nunca va la clave real. (Queda en DMRGateway.ini
# con permisos 0600.)
NET_PASSWORD=
# Nombre de la red 1 en DMRGateway (Name=): letras, cifras, espacio, punto, guion y guion bajo,
# de 1 a 20 caracteres. Solo se usa con DMR_TIER=2.
NET_NAME=ADN
# Enrutado de la red 1 con DMR_TIER=2: lista separada por comas. S1 o S2: el slot entero (grupos
# y llamadas privadas). S1:9 o S2:214-219: un TG o un rango de TG en ese slot, sin cambiar el
# número. S1:P8: prefijo 8, la radio marca 8000000 + TG y a la red va el TG. Las privadas solo
# van con el slot entero. Con Tier III no se usa.
NET_ROUTES=S1,S2

${redSection(2)}
${redSection(3)}
${redSection(4)}
# ---------------------------------------------------------------- Registro y depuración
LOG_LEVEL=1
`;

test("multired: parseDmrConfHelp del ejemplo; cada clave nueva sale con el control que toca en CONFIG DMR", () => {
  const h = parseDmrConfHelp(EXAMPLE_MULTIRED);
  const red = (n: number) => ["ENABLED", "NAME", "ADDRESS", "PORT", "ID", "PASSWORD", "ROUTES"].map((k) => `NET${n}_${k}`);
  assert.deepEqual(h.map((k) => k.key), ["NET_PASSWORD", "NET_NAME", "NET_ROUTES", ...red(2), ...red(3), ...red(4), "LOG_LEVEL"]);
  const by = Object.fromEntries(h.map((k) => [k.key, k]));
  assert.equal(by.NET_NAME.section, "Pasarela IP (DMRGateway)");
  assert.equal(by.NET_ROUTES.default, "S1,S2");
  assert.equal(by.LOG_LEVEL.section, "Registro y depuración", "la sección de la red 4 se cierra con el siguiente banner");
  // las mismas reglas que kindOf de client/src/pages/DmrConfig.tsx
  const BOOL_RE = /(^|\s)[01] = /;
  const RANGE_RE = /(\d+)\.\.(\d+|N_CHANNELS)\)/;
  const range = (k: string) => RANGE_RE.exec(by[k].help)?.slice(1, 3);
  for (const n of [2, 3, 4]) {
    for (const k of red(n)) assert.equal(by[k].section, `Red DMR ${n} (solo Tier II)`, k);
    assert.ok(BOOL_RE.test(by[`NET${n}_ENABLED`].help) && by[`NET${n}_ENABLED`].default === "0", "ENABLED: el interruptor 0/1");
    assert.equal(by[`NET${n}_NAME`].default, `Red ${n}`);
    assert.deepEqual(range(`NET${n}_PORT`), ["1", "65535"]);
    assert.equal(by[`NET${n}_PORT`].default, "62031");
    assert.deepEqual(range(`NET${n}_ID`), ["1", "2147483647"], "ID: número (vacío vale: el mismo NET_ID)");
    assert.equal(by[`NET${n}_ID`].default, "");
  }
  // texto libre: ni interruptor ("0 = " / "1 = "), ni desplegable ("<n> = " al principio), ni rango
  for (const k of ["NET_NAME", "NET_ROUTES", ...[2, 3, 4].flatMap((n) => [`NET${n}_NAME`, `NET${n}_ADDRESS`, `NET${n}_ROUTES`])]) {
    assert.ok(!BOOL_RE.test(by[k].help), `${k}: no es un interruptor`);
    assert.ok(!RANGE_RE.test(by[k].help), `${k}: no es un número`);
    assert.ok(!by[k].help.split("\n").some((l) => /^\d+ = /.test(l)), `${k}: no es un desplegable`);
  }
  assert.ok(h.every((k) => !("choices" in k)));
});

test("multired: NET2..4_PASSWORD son secretas como NET_PASSWORD: no se mandan al navegador y vacío conserva la guardada", () => {
  for (const k of ["NET_PASSWORD", "NET2_PASSWORD", "NET3_PASSWORD", "NET4_PASSWORD", "AUTH_KEYS"]) assert.ok((DMR_SECRET_KEYS as readonly string[]).includes(k), k);
  const help = parseDmrConfHelp(EXAMPLE_MULTIRED);
  const current = { NET_PASSWORD: "clave-de-prueba", NET2_PASSWORD: "clave-de-prueba-2", NET3_PASSWORD: "", NET2_ENABLED: "1", NET2_ROUTES: "S2", NET2_ADDRESS: "192.0.2.20" };
  const rows = dmrConfRows(help, current);
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.ok(!JSON.stringify(rows).includes("clave-de-prueba"), "ninguna clave sale en la respuesta");
  assert.deepEqual([by.NET_PASSWORD, by.NET2_PASSWORD, by.NET3_PASSWORD, by.NET4_PASSWORD].map((r) => [r.value, r.secret, r.set]),
    [["", true, true], ["", true, true], ["", true, false], ["", true, false]], "guardada / vacía / sin línea en el conf");
  assert.deepEqual([by.NET2_ENABLED.value, by.NET2_ROUTES.value, by.NET2_ADDRESS.value, by.NET3_NAME.value], ["1", "S2", "192.0.2.20", "Red 3"]);
  assert.ok(!("set" in by.NET2_ROUTES) && by.NET2_ROUTES.secret === false);
  // sin ejemplo, las claves del conf: tampoco sale ninguna
  const bare = dmrConfRows([], current);
  assert.deepEqual(bare.map((r) => r.key), Object.keys(current));
  assert.ok(!JSON.stringify(bare).includes("clave-de-prueba"));
  assert.deepEqual(bare.find((r) => r.key === "NET2_PASSWORD"), { key: "NET2_PASSWORD", value: "", help: "", section: "", default: "", secret: true, set: true });

  const known = help.map((k) => k.key);
  const conf = "NET_PASSWORD=clave-de-prueba\nNET2_ENABLED=1\nNET2_PASSWORD=clave-de-prueba-2\nNET3_PASSWORD=clave-de-prueba-3\n";
  assert.equal(updateDmrConf(conf, { NET2_PASSWORD: "", NET3_PASSWORD: "", NET4_PASSWORD: "" }, known), conf, "vacío conserva lo guardado (y no añade NET4)");
  assert.equal(updateDmrConf(conf, { NET3_PASSWORD: "otra-de-prueba", NET4_PASSWORD: "cuarta-de-prueba" }, known),
    conf.replace("NET3_PASSWORD=clave-de-prueba-3", "NET3_PASSWORD=otra-de-prueba") + "NET4_PASSWORD=cuarta-de-prueba\n");
  assert.equal(updateDmrConf(conf, { NET2_ROUTES: "" }, known), conf + "NET2_ROUTES=\n", "una clave no secreta vacía sí se escribe");
});

test("multired: /api/system/read-config rechaza toda la carpeta del conf (copias .bak-dmr-*, DMRGateway.ini, dmrtc.cfg)", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tlm-dmr-dir-"));
  try {
    const etc = path.join(d, "dmr-tier3");
    const conf = path.join(etc, "dmr-tier3.conf");
    saveDmrConf(conf, "NET_PASSWORD=clave-de-prueba\n");
    const backup = writeDmrConf(conf, { NET2_PASSWORD: "clave-de-prueba-2" }, ["NET_PASSWORD", "NET2_PASSWORD"]).backup;
    assert.ok(backup && path.basename(backup).startsWith("dmr-tier3.conf.bak-dmr-"), String(backup));
    fs.writeFileSync(path.join(etc, "DMRGateway.ini"), "[DMR Network 2]\nPassword=clave-de-prueba-2\n");
    fs.writeFileSync(path.join(etc, "dmrtc.cfg"), "");
    for (const p of [conf, backup!, path.join(etc, "DMRGateway.ini"), path.join(etc, "dmrtc.cfg"), etc])
      assert.equal(isInDmrConfDir(p, conf), true, p);
    // una carpeta hermana con el mismo prefijo y un config.toml de fuera: se leen como siempre
    fs.mkdirSync(path.join(d, "dmr-tier3-otra"));
    fs.writeFileSync(path.join(d, "dmr-tier3-otra", "config.toml"), "");
    fs.writeFileSync(path.join(d, "config.toml"), "");
    for (const p of [path.join(d, "dmr-tier3-otra", "config.toml"), path.join(d, "config.toml"), d])
      assert.equal(isInDmrConfDir(p, conf), false, p);
    // un enlace de fuera que apunta a una copia también se rechaza (si el sistema deja crear enlaces)
    const link = path.join(d, "copia.toml");
    try { fs.symlinkSync(backup!, link); } catch { /* Windows sin permiso de enlaces */ }
    if (fs.existsSync(link)) assert.equal(isInDmrConfDir(link, conf), true);
    // las rutas de la Pi: /etc/dmr-tier3/... sí, la config.toml de la estación no
    assert.equal(isInDmrConfDir(`${DMR.confPath}.bak-dmr-2026-11-09T10-00-00-000Z`), true);
    assert.equal(isInDmrConfDir("/etc/dmr-tier3/DMRGateway.ini"), true);
    assert.equal(isInDmrConfDir("/root/miurastation/config.toml"), false);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("shared SDR: applied = gen-config's drop-in exists; the [dmr_window] block as gen-config recognises it", () => {
  assert.equal(DMR.sharedDropIn, "/etc/systemd/system/mmdvm-multi.service.d/20-compartido.conf");
  assert.equal(DMR.shmPath, "/dev/shm/miurastation-dmr");
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tlm-dmr-shared-"));
  const dropIn = path.join(d, "20-compartido.conf");
  assert.equal(dmrShared(dropIn), false);
  fs.writeFileSync(dropIn, "# Generado por gen-config.py (SDR_COMPARTIDO=1). No editar: se borra con SDR_COMPARTIDO=0.\n[Unit]\nRequires=miurastation.service\n");
  assert.equal(dmrShared(dropIn), true);
  // gen-config.py 0.3.x does not know --miura-config: the panel must not pass it
  const gen = path.join(d, "gen-config.py");
  assert.equal(genConfigKnowsShared(gen), false, "no file");
  fs.writeFileSync(gen, `ap.add_argument("--check", action="store_true")\n`);
  assert.equal(genConfigKnowsShared(gen), false, "0.3.x");
  fs.writeFileSync(gen, `ap.add_argument("--check", action="store_true")\nap.add_argument("--miura-config", default=DEFAULT_MIURA_CONFIG)\n`);
  assert.equal(genConfigKnowsShared(gen), true, "0.4.0");
  fs.rmSync(d, { recursive: true, force: true });

  const head = `stack_mode = "Bs"\n\n[phy_io.soapysdr]\nsample_rate = 600000\n`;
  const block = `[dmr_window]\n# >>> dmr-tier3: SDR_COMPARTIDO=1 (gen-config.py; no editar, se reescribe)\ntx_freq = 438412500\nrx_freq = 430812500\ncarriers = 3\n# <<< dmr-tier3\n`;
  assert.equal(hasDmrWindowBlock(`${head}\n${block}`), true, "the block at the end");
  assert.equal(hasDmrWindowBlock(`${head}\n${block}`.replace(/\n/g, "\r\n")), true, "CRLF");
  assert.equal(hasDmrWindowBlock(`${head}\n  [dmr_window]  \n${block.split("\n").slice(1).join("\n")}`), true, "spaces around the header");
  assert.equal(hasDmrWindowBlock(`${block}\n# [packet_data]\n# enabled = true\n`), true, "anywhere in the file");
  assert.equal(hasDmrWindowBlock(`${head}\n[dmr_window]\ntx_freq = 438412500\ncarriers = 3\n`), false, "written by hand: no marker");
  assert.equal(hasDmrWindowBlock(`${head}\n[dmr_window]\n\n# >>> dmr-tier3\ncarriers = 3\n# <<< dmr-tier3\n`), false, "the marker must follow the header");
  assert.equal(hasDmrWindowBlock(`${head}\n[dmr_window]\n # >>> dmr-tier3\ncarriers = 3\n# <<< dmr-tier3\n`), false, "the marker starts the line");
  assert.equal(hasDmrWindowBlock(`${head}\n[dmr_window]\n# >>> dmr-tier3\ncarriers = 3\n`), false, "not closed");
  assert.equal(hasDmrWindowBlock(`${head}\n# [dmr_window]\n# >>> dmr-tier3\n# <<< dmr-tier3\n`), false, "commented out");
  assert.equal(hasDmrWindowBlock(`${head}\n[dmr_window.x]\n# >>> dmr-tier3\n# <<< dmr-tier3\n`), false);
  assert.equal(hasDmrWindowBlock(head), false, "no block");
  assert.equal(hasDmrWindowBlock(""), false);

  // MIURA+DMR restarts MiuraStation only when it started before config.toml changed (whole seconds: a full one after)
  assert.equal(startedBeforeChange("@1730714533\n", 1730714534000), true);
  assert.equal(startedBeforeChange("@1730714533", 1730714533900), false, "the same second: unknown, no restart");
  assert.equal(startedBeforeChange("@1730714533", 1730714000000), false, "config older than the run");
  assert.equal(startedBeforeChange("", 1730714534000), false, "never started");
  assert.equal(startedBeforeChange("Tue 2026-11-04 10:12:13 CET", 1830714534000), false, "no --timestamp=unix");
  // ... and otherwise reports why its PHY refused the window
  const journal = "\x1b[2m2026-11-04T10:12:13Z\x1b[0m \x1b[31mERROR\x1b[0m tetra_entities::phy: DMR window off: DMR channel 438400000 Hz is 0.0 kHz from the TETRA downlink 438400000 Hz (25 kHz at least). TETRA runs alone\n";
  assert.equal(dmrWindowOffLine(journal), "DMR window off: DMR channel 438400000 Hz is 0.0 kHz from the TETRA downlink 438400000 Hz (25 kHz at least). TETRA runs alone");
  assert.equal(dmrWindowOffLine("INFO DMR window (miurastation-dmr-window-v1) on at /dev/shm/miurastation-dmr\n"), "");
  assert.equal(dmrWindowOffLine(""), "");

  // a MiuraStation older than 1.4.0 refuses the section; the 1.4.0 betas carry it
  assert.ok(compareVersions("1.3.9", DMR_WINDOW_MIURA_MIN) < 0);
  assert.ok(compareVersions("1.3.0-beta.2", DMR_WINDOW_MIURA_MIN) < 0);
  assert.ok(compareVersions("1.4.0-beta.1", DMR_WINDOW_MIURA_MIN) >= 0);
  assert.ok(compareVersions("1.4.0", DMR_WINDOW_MIURA_MIN) >= 0);
  assert.ok(compareVersions("1.10.0", DMR_WINDOW_MIURA_MIN) >= 0);
});

test("gen-config errors: the '  - ' lines of an invalid conf, else stderr, else the exit code", () => {
  assert.deepEqual(genConfigErrors(0, "Plan de canales\n", ""), []);
  assert.deepEqual(genConfigErrors(2, "", "gen-config: configuración no válida:\n  - CALLSIGN: obligatorio\n  - DMR_ID: debe ser un número entero (vale 'x')\n"),
    ["CALLSIGN: obligatorio", "DMR_ID: debe ser un número entero (vale 'x')"]);
  assert.deepEqual(genConfigErrors(3, "", "gen-config: dmrtc.service está activo y reescribe dmrtc.cfg al salir; páralo antes\n"),
    ["gen-config: dmrtc.service está activo y reescribe dmrtc.cfg al salir; páralo antes"]);
  assert.deepEqual(genConfigErrors(1, "", ""), ["gen-config.py ha terminado con código 1"]);
  // the warnings of SDR_COMPARTIDO ("gen-config: aviso: ...") are not errors
  assert.deepEqual(genConfigErrors(0, "Plan\n", "gen-config: aviso: el salto dúplex DMR no es el de la TETRA\n"), []);
  assert.deepEqual(genConfigErrors(2, "", "gen-config: aviso: canal DMR en la imagen de una portadora\ngen-config: configuración no válida:\n  - SAMPLE_RATE: con SDR_COMPARTIDO=1 tiene que ser 150000\n"),
    ["SAMPLE_RATE: con SDR_COMPARTIDO=1 tiene que ser 150000"]);
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
  const osRelease = path.join(d, "os-release");
  fs.writeFileSync(osRelease, OS_TRIXIE);
  const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  const env: NodeJS.ProcessEnv = {
    ...process.env, [pathKey]: `${bin}${path.delimiter}${process.env[pathKey]}`,
    MSYS: "winsymlinks:nativestrict", MOCK_LOG: log, MOCK_STATE: state, MOCK_RELEASES: releases, MOCK_OPT: opt, MOCK_ETC: etc,
    OS_RELEASE: osRelease.replace(/\\/g, "/"),
  };
  return { L, state, log, releases, opt, etc, env };
}
// A release dmr-tier3-vX.Y.Z of ea5gvk/MiuraStation-dist: the arm64 .deb (Trixie), with `bookworm` the Debian 12 one
// too (`renamed`: as GitHub stores it, "~" -> "."), the sources tarball line and one SHA256SUMS for all. Returns the
// asset list of the release.
function publish(sb: Sandbox, version: string, opts: { badSum?: boolean; bookworm?: boolean; renamed?: boolean } = {}): string[] {
  const dir = path.join(sb.releases, `dmr-tier3-v${version}`);
  fs.mkdirSync(dir);
  const up = version.replace("-", "~");
  const debs: [string, string][] = [[DMR_DEB.asset(version, "arm64"), `Version: ${up}-1\n`]];
  if (opts.bookworm) {
    const deb = dmrDebAsset(version, "arm64", "bookworm");
    debs.push([opts.renamed ? deb.replace("~", ".") : deb, `Version: ${up}-1~deb12\n`]);
  }
  let sums = "";
  for (const [deb, body] of debs) {
    fs.writeFileSync(path.join(dir, deb), body);
    sums += `${crypto.createHash("sha256").update(opts.badSum ? "otra cosa" : body).digest("hex")}  ${deb}\n`;
  }
  fs.writeFileSync(path.join(dir, "SHA256SUMS"), `${sums}${"0".repeat(64)}  dmr-tier3-${version}-src.tar.gz\n`);
  return [...debs.map(([deb]) => deb), "SHA256SUMS", `dmr-tier3-${version}-src.tar.gz`];
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
  assert.match(r.out, /DMR Tier III solo se publica para arm64 \(Raspberry Pi con Debian 12 o 13 de 64 bits\), y este sistema es amd64/);
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

// ── The Debian of the Pi: Trixie (Debian 13) dmr-tier3_V-1_arm64.deb, Bookworm (Debian 12) dmr-tier3_V-1~deb12_arm64.deb ──

const OS_TRIXIE = `PRETTY_NAME="Debian GNU/Linux 13 (trixie)"\nNAME="Debian GNU/Linux"\nVERSION_ID="13"\nVERSION="13 (trixie)"\nVERSION_CODENAME=trixie\nID=debian\n`;
const OS_BOOKWORM = `PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"\nNAME="Debian GNU/Linux"\nVERSION_ID="12"\nVERSION="12 (bookworm)"\nVERSION_CODENAME=bookworm\nID=debian\nHOME_URL="https://www.debian.org/"\n`;
const OS_UBUNTU = `PRETTY_NAME="Ubuntu 24.04.1 LTS"\nNAME="Ubuntu"\nVERSION_ID="24.04"\nVERSION_CODENAME=noble\nID=ubuntu\n`;
const NO_DEB_BOOKWORM_070 = "La versión 0.7.0 del paquete DMR no tiene .deb para Debian 12 (bookworm). Usa la 0.7.1 o posterior, o Debian 13 (trixie).";
const ASSETS_070 = ["dmr-tier3-0.7.0-de1663d-aarch64.tar.gz", "dmr-tier3-0.7.0-src.tar.gz", "dmr-tier3_0.7.0-1_arm64.deb", "SHA256SUMS"];
const ASSETS_071 = ["dmr-tier3-0.7.1-src.tar.gz", "dmr-tier3_0.7.1-1_arm64.deb", "dmr-tier3_0.7.1-1~deb12_arm64.deb", "SHA256SUMS"];

test("system: the asset of each Debian; os-release by codename (else number); any other system is none", () => {
  assert.equal(dmrDebAsset("0.7.1", "arm64", "trixie"), "dmr-tier3_0.7.1-1_arm64.deb");
  assert.equal(dmrDebAsset("0.7.1", "arm64", "bookworm"), "dmr-tier3_0.7.1-1~deb12_arm64.deb");
  assert.equal(dmrDebAsset("0.8.0-beta.1", "arm64", "bookworm"), "dmr-tier3_0.8.0-beta.1-1~deb12_arm64.deb");
  assert.equal(DMR_DEB.asset("0.7.1", "arm64"), "dmr-tier3_0.7.1-1_arm64.deb", "the shared helpers' asset is Trixie's, as before");
  assert.equal(DMR_DEB.archNote, "arm64 (Raspberry Pi con Debian 12 o 13 de 64 bits)");
  assert.deepEqual(dmrSystemFrom("arm64", OS_BOOKWORM), { arch: "arm64", os: "bookworm", name: "Debian GNU/Linux 12 (bookworm)" });
  assert.deepEqual(dmrSystemFrom("arm64", OS_TRIXIE.replace(/\n/g, "\r\n")), { arch: "arm64", os: "trixie", name: "Debian GNU/Linux 13 (trixie)" });
  assert.deepEqual(dmrSystemFrom("amd64", OS_UBUNTU), { arch: "amd64", os: null, name: "Ubuntu 24.04.1 LTS" });
  assert.deepEqual(dmrSystemFrom("arm64", ""), { arch: "arm64", os: null, name: "desconocido" });
  assert.deepEqual(dmrSystemFrom("arm64", "VERSION_ID=12\n"), { arch: "arm64", os: "bookworm", name: "12" });
  assert.equal(dmrOs("", "13"), "trixie");
  assert.equal(dmrOs("trixie", ""), "trixie");
  assert.equal(dmrOs("bookworm", "12"), "bookworm");
  assert.equal(dmrOs("forky", ""), null, "Debian testing");
  assert.equal(dmrOs("noble", "13"), null, "the codename wins over the number");
  assert.equal(dmrOs("bullseye", "11"), null);
  // the installed Bookworm package compares as its release (upToDate, the version checks)
  assert.equal(debUpstreamVersion("0.7.1-1~deb12"), "0.7.1");
  assert.equal(debUpstreamVersion("0.8.0~beta.1-1~deb12"), "0.8.0-beta.1");
  // GitHub stores an uploaded "~" as ".": that name counts as the Bookworm .deb too; without a list, the contract's
  assert.equal(dmrReleaseAsset("0.7.1", "arm64", "bookworm", ASSETS_071), "dmr-tier3_0.7.1-1~deb12_arm64.deb");
  assert.equal(dmrReleaseAsset("0.7.1", "arm64", "bookworm", ["dmr-tier3_0.7.1-1.deb12_arm64.deb"]), "dmr-tier3_0.7.1-1.deb12_arm64.deb");
  assert.equal(dmrReleaseAsset("0.7.0", "arm64", "bookworm", ASSETS_070), null);
  assert.equal(dmrReleaseAsset("0.7.0", "arm64", "bookworm"), "dmr-tier3_0.7.0-1~deb12_arm64.deb");
  assert.equal(dmrReleaseAsset("0.7.1", "arm64", "trixie", ["dmr-tier3_0.7.1-1.deb12_arm64.deb"]), null);
});

test("installable: an old release (Trixie .deb only) refuses Bookworm with the reason; a new one has both; arch and os", () => {
  const bookworm = dmrSystemFrom("arm64", OS_BOOKWORM), trixie = dmrSystemFrom("arm64", OS_TRIXIE);
  const old = { version: "0.7.0", assets: ASSETS_070 }, neu = { version: "0.7.1", assets: ASSETS_071 };
  assert.deepEqual(dmrInstallability(bookworm, old), { installable: false, reason: "no_deb", message: NO_DEB_BOOKWORM_070, asset: "dmr-tier3_0.7.0-1~deb12_arm64.deb" });
  assert.deepEqual(dmrInstallability(trixie, old), { installable: true, reason: null, message: null, asset: "dmr-tier3_0.7.0-1_arm64.deb" });
  assert.deepEqual(dmrInstallability(bookworm, neu), { installable: true, reason: null, message: null, asset: "dmr-tier3_0.7.1-1~deb12_arm64.deb" });
  assert.deepEqual(dmrInstallability(trixie, neu), { installable: true, reason: null, message: null, asset: "dmr-tier3_0.7.1-1_arm64.deb" });
  assert.deepEqual(dmrInstallability(trixie, { version: "0.7.2", assets: ["dmr-tier3_0.7.2-1~deb12_arm64.deb"] }), { installable: false, reason: "no_deb",
    message: "La versión 0.7.2 del paquete DMR no tiene .deb para Debian 13 (trixie). Prueba con otra versión.", asset: "dmr-tier3_0.7.2-1_arm64.deb" });
  assert.deepEqual(dmrInstallability(bookworm, { version: "0.7.0" }), { installable: true, reason: null, message: null, asset: "dmr-tier3_0.7.0-1~deb12_arm64.deb" },
    "without an asset list: unknown, the script and apt tell");
  assert.deepEqual(dmrInstallability({ ...bookworm, arch: "armhf" }, neu), { installable: false, reason: "arch", asset: null,
    message: "DMR Tier III solo se publica para arm64 (Raspberry Pi con Debian 12 o 13 de 64 bits), y este sistema es armhf" });
  assert.deepEqual(dmrInstallability(dmrSystemFrom("arm64", OS_UBUNTU), neu), { installable: false, reason: "os", asset: null,
    message: "DMR Tier III solo se publica para Debian 12 (bookworm) y Debian 13 (trixie), y este sistema es Ubuntu 24.04.1 LTS" });
  // the release keeps the asset names of the API (only when it has the list)
  const r = parseDmrRelease(rel("dmr-tier3-v0.7.1", { assets: [{ name: "dmr-tier3_0.7.1-1~deb12_arm64.deb", size: 1 }, { size: 2 }, null, { name: "SHA256SUMS" }] }));
  assert.deepEqual(r?.assets, ["dmr-tier3_0.7.1-1~deb12_arm64.deb", "SHA256SUMS"]);
  assert.equal("assets" in parseDmrRelease(rel("dmr-tier3-v0.7.1"))!, false);
});

test("package script: the Debian of the Pi picks DEB after the arch check; a release without its .deb stops before downloading", () => {
  const old = dmrPackageScript(PI_LAYOUT, { mode: "install", tag: "dmr-tier3-v0.7.0", version: "0.7.0", assets: ASSETS_070 });
  assert.ok(old.includes('OS_FILE="${OS_RELEASE:-/etc/os-release}"'), old);
  assert.ok(old.includes("  trixie:*|:13) DEB='dmr-tier3_0.7.0-1_arm64.deb' ;;"), old);
  assert.ok(old.includes(`  bookworm:*|:12) die '${NO_DEB_BOOKWORM_070}' ;;`), old);
  assert.ok(old.includes('  *) die "DMR Tier III solo se publica para Debian 12 (bookworm) y Debian 13 (trixie), y este sistema es $OS_NAME" ;;'));
  assert.ok(old.indexOf("  arm64) DEB=") < old.indexOf("case \"$OS_CODENAME:$OS_VERSION\"") && old.indexOf("bookworm:*|:12)") < old.indexOf("curl "), "decided before any download");
  const neu = dmrPackageScript(PI_LAYOUT, { mode: "update", tag: "dmr-tier3-v0.7.1", version: "0.7.1", assets: ASSETS_071 });
  assert.ok(neu.includes("  trixie:*|:13) DEB='dmr-tier3_0.7.1-1_arm64.deb' ;;") && neu.includes("  bookworm:*|:12) DEB='dmr-tier3_0.7.1-1~deb12_arm64.deb' ;;"), neu);
  const unknown = dmrPackageScript(PI_LAYOUT, { mode: "install", tag: "dmr-tier3-v0.7.0", version: "0.7.0" });
  assert.ok(unknown.includes("  bookworm:*|:12) DEB='dmr-tier3_0.7.0-1~deb12_arm64.deb' ;;"), "no asset list: the contract's name, apt and curl tell");
});

test("package on Bookworm / Trixie: the .deb of each; an old release and another system are refused before downloading", { skip: !bashOk && "sin bash" }, () => {
  const sb = sandbox(), L = sb.L;
  const assets070 = publish(sb, "0.7.0");
  const assets071 = publish(sb, "0.7.1", { bookworm: true });
  const osFile = (name: string, text: string) => { const f = path.join(path.dirname(L.root), name); fs.writeFileSync(f, text); return f.replace(/\\/g, "/"); };
  const bookworm = osFile("os-bookworm", OS_BOOKWORM), ubuntu = osFile("os-ubuntu", OS_UBUNTU);
  const install = (version: string, assets: string[]) => dmrPackageScript(L, { mode: "install", tag: `dmr-tier3-v${version}`, version, assets });

  let r = run(sb, install("0.7.0", assets070), { OS_RELEASE: bookworm });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /=== Sistema: Debian GNU\/Linux 12 \(bookworm\) \(arm64\) ===/);
  assert.ok(r.out.includes(`=== ERROR: ${NO_DEB_BOOKWORM_070} ===`), r.out);
  r = run(sb, install("0.7.1", assets071), { OS_RELEASE: ubuntu });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /ERROR: DMR Tier III solo se publica para Debian 12 \(bookworm\) y Debian 13 \(trixie\), y este sistema es Ubuntu 24\.04\.1 LTS/);
  r = run(sb, install("0.7.1", assets071), { OS_RELEASE: `${bookworm}.no-existe` });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /y este sistema es desconocido ===/);
  assert.ok(!/curl|apt-get/.test(calls(sb)) && !has(sb, "pkg-version"), "nothing downloaded nor installed");

  // Bookworm with a new release: its ~deb12, checked against the one SHA256SUMS
  r = run(sb, install("0.7.1", assets071), { OS_RELEASE: bookworm });
  assert.equal(r.code, 0, r.out);
  assert.equal(pkgVersion(sb), "0.7.1-1~deb12");
  assert.match(r.out, /Descargando dmr-tier3_0\.7\.1-1~deb12_arm64\.deb y SHA256SUMS/);
  assert.match(r.out, /dmr-tier3 0\.7\.1-1~deb12 instalado \(\/opt\/dmr-tier3\)/);
  assert.match(calls(sb), /curl .*\/dmr-tier3-v0\.7\.1\/dmr-tier3_0\.7\.1-1~deb12_arm64\.deb/);
  assert.match(calls(sb), /apt-get install .*dmr-tier3_0\.7\.1-1~deb12_arm64\.deb/);

  // Trixie (the sandbox's os-release), the same release: its own .deb, not Bookworm's
  fs.rmSync(path.join(sb.state, "pkg-version"));
  fs.writeFileSync(sb.log, "");
  r = run(sb, install("0.7.1", assets071));
  assert.equal(r.code, 0, r.out);
  assert.equal(pkgVersion(sb), "0.7.1-1");
  assert.match(r.out, /=== Sistema: Debian GNU\/Linux 13 \(trixie\) \(arm64\) ===/);
  assert.match(calls(sb), /apt-get install .*dmr-tier3_0\.7\.1-1_arm64\.deb/);
  assert.ok(!/deb12/.test(calls(sb)));
  // ... and an old release still installs there
  fs.rmSync(path.join(sb.state, "pkg-version"));
  r = run(sb, install("0.7.0", assets070));
  assert.equal(r.code, 0, r.out);
  assert.equal(pkgVersion(sb), "0.7.0-1");

  // the Bookworm .deb as GitHub stores it ("~" -> "."), its SHA256SUMS line with that name
  const assets072 = publish(sb, "0.7.2", { bookworm: true, renamed: true });
  fs.rmSync(path.join(sb.state, "pkg-version"));
  r = run(sb, install("0.7.2", assets072), { OS_RELEASE: bookworm });
  assert.equal(r.code, 0, r.out);
  assert.equal(pkgVersion(sb), "0.7.2-1~deb12");
  assert.match(calls(sb), /apt-get install .*dmr-tier3_0\.7\.2-1\.deb12_arm64\.deb/);
});
