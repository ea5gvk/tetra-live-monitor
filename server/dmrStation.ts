// The DMR Tier III station: the stack of Rafa EA7KEN (MMDVM-Multi -> MMDVM-IQ x N -> MMDVM-Host x N -> dmrtc ->
// DMRGateway) on the SX1255 of a MiuraStation Pi, packaged as the dmr-tier3 .deb of ea5gvk/MiuraStation-dist
// (releases tagged dmr-tier3-vX.Y.Z, arm64 only). It is the fourth station of the selector and it is NOT of the flow
// family: no config.toml, no :8080 dashboard, no SDS/kick/DGNA.
// - systemd: dmr-tier3.target, with mmdvm-multi.service, mmdvm-iq@N / mmdvm-host@N (N = 1..4), dmrtc.service and
//   dmrgateway.service all PartOf= it. The target can stay "active" with mmdvm-multi failed: the real state is
//   target + mmdvm-multi + dmrtc (dmrHealth). The target and mmdvm-multi carry Conflicts=miurastation.service,
//   except in the shared mode (dmrShared), where the stack runs next to MiuraStation.
// - Tier II (DMR_TIER=2, dmrTier2): one conventional repeater (N_CHANNELS=1) for any DMR radio, without dmrtc
//   (its unit carries ConditionPathExists=!<marker>, so the target starts and skips it): the core units are then
//   mmdvm-multi + mmdvm-host@1.
// - configuration: /etc/dmr-tier3/dmr-tier3.conf (KEY=VALUE, mode 0600, NET_PASSWORD is a secret), from which
//   /opt/dmr-tier3/bin/gen-config.py writes the nine files of the stack (only with dmrtc stopped: exit 3 otherwise;
//   2 = invalid conf, listed in Spanish; 1 = write failure; --check only validates).
// - the package script is the MiuraStation one parametrised by package (stationScripts): download + SHA-256 +
//   apt-get install; it never enables or starts anything (the selector does) and the postinst restarts a running
//   stack on an upgrade by itself.
// Pure generators and parsers; the tests run the script against a temporary layout with mocked tools.
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import {
  type Layout, type DebPackage, DIST_REPO, lockCmd, releaseVars, archCheck, fetchDeb, aptInstall, checkInstalled,
  compareVersions, debUpstreamVersion,
} from "./stationScripts";
import { backupWithRotation, atomicWriteFile } from "./configMerge";

export const DMR = {
  name: "DMR Tier III",
  label: "DMR",
  pkg: "dmr-tier3",
  target: "dmr-tier3.target",
  dir: "/opt/dmr-tier3",
  confDir: "/etc/dmr-tier3",
  confPath: "/etc/dmr-tier3/dmr-tier3.conf",
  examplePath: "/opt/dmr-tier3/share/dmr-tier3.conf.example",
  genConfig: "/opt/dmr-tier3/bin/gen-config.py",
  multiBin: "/opt/dmr-tier3/bin/MMDVM-Multi",
  dmrtcLog: "/var/lib/dmr-tier3/.config/dmrtc/dmrtc.log",
  // SDR shared with MiuraStation (SDR_COMPARTIDO=1, dmr-tier3 0.4.0): gen-config.py writes this drop-in only in
  // that mode, so it says what was applied (not what was saved without regenerating); MiuraStation passes the DMR
  // window to MMDVM-Multi through the file below.
  sharedDropIn: "/etc/systemd/system/mmdvm-multi.service.d/20-compartido.conf",
  shmPath: "/dev/shm/miurastation-dmr",
  // Tier II (DMR_TIER=2): gen-config.py writes this marker only when it applies Tier II and deletes it with Tier III,
  // so, like the drop-in above, it says what was applied.
  tier2Marker: "/etc/dmr-tier3/tier2",
  tagPrefix: "dmr-tier3-v",
  repoLabel: `DMR Tier III · ${DIST_REPO} · paquete .deb dmr-tier3 (pila de EA7KEN)`,
} as const;
// The units whose state is the station's (Requires= of the target): both must be active.
export const DMR_CORE_UNITS = ["mmdvm-multi.service", "dmrtc.service"] as const;
// The same in Tier II: no dmrtc, the one repeater's MMDVM-Host instead.
export const DMR_CORE_UNITS_TIER2 = ["mmdvm-multi.service", "mmdvm-host@1.service"] as const;
// The units of the live log preset "dmr" (journalctl -u accepts globs).
export const DMR_JOURNAL_UNITS = ["mmdvm-multi", "mmdvm-iq@*", "mmdvm-host@*", "dmrtc", "dmrgateway"] as const;
export const DMR_SECRET_KEYS = ["NET_PASSWORD", "AUTH_KEYS"] as const;
export const DMR_KEY_RE = /^[A-Z][A-Z0-9_]*$/;
// A value of the conf is one line of printable text (gen-config.py checks each key's own rules); AUTH_KEYS, a list
// of id:key pairs, is the longest one.
export const DMR_VALUE_MAX = 4096;
export const DMR_TAG_RE = /^dmr-tier3-v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)$/;

export const DMR_DEB: DebPackage = {
  name: DMR.pkg, product: DMR.name, arches: ["arm64"],
  asset: (version, arch) => `dmr-tier3_${version}-1_${arch}.deb`,
  archNote: "arm64 (Raspberry Pi 5 con Debian 13 de 64 bits)",
  tmpPrefix: "dmr-tier3-deb", shownPath: () => DMR.dir,
};

// ── Releases (pure) ──

export interface DmrRelease { tag: string; version: string; name: string; date: string; url: string; prerelease: boolean }

/** One release of the GitHub API as a dmr-tier3 one, or null (another tag scheme, a draft). */
export function parseDmrRelease(j: any): DmrRelease | null {
  const tag = typeof j?.tag_name === "string" ? j.tag_name : "";
  const m = DMR_TAG_RE.exec(tag);
  if (!m || j.draft) return null;
  return {
    tag, version: m[1],
    name: typeof j.name === "string" && j.name ? j.name : `${DMR.name} ${m[1]}`,
    date: typeof j.published_at === "string" ? j.published_at : "",
    url: typeof j.html_url === "string" ? j.html_url : `https://github.com/${DIST_REPO}/releases/tag/${tag}`,
    prerelease: !!j.prerelease,
  };
}

/** The highest dmr-tier3 version of a /releases listing (pre-releases count, drafts do not), or null when there is
 *  none: today the repo publishes no dmr-tier3 release and the panel must say so, not fail. */
export function parseDmrReleases(json: any): DmrRelease | null {
  if (!Array.isArray(json)) return null;
  let best: DmrRelease | null = null;
  for (const j of json) {
    const r = parseDmrRelease(j);
    if (r && (!best || compareVersions(r.version, best.version) > 0)) best = r;
  }
  return best;
}

/** The tag of a version asked for ("0.2.0" or "dmr-tier3-v0.2.0"): undefined for the latest, null if invalid. */
export function dmrTagFrom(v: unknown): string | null | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string") return null;
  const tag = v.startsWith(DMR.tagPrefix) ? v : `${DMR.tagPrefix}${v.replace(/^v/, "")}`;
  return DMR_TAG_RE.test(tag) ? tag : null;
}

// ── Installed package and systemd state ──

/** Installed version of the dmr-tier3 package ("0.2.0", "0.2.0-beta.1"), or null. */
export function dmrPkgVersion(): string | null {
  try {
    const v = execSync(`dpkg-query -W -f='\${Version}' ${DMR.pkg} 2>/dev/null`, { timeout: 5000 }).toString().trim();
    return v ? debUpstreamVersion(v) : null;
  } catch { return null; }
}

export const dmrInstalled = (): boolean => fs.existsSync(DMR.multiBin) || dmrPkgVersion() !== null;

export interface DmrHealth { active: boolean; degraded: boolean; missing: string[] }
/** The station is on air when the target is active AND both core units (`units`: dmrCoreUnits) are; a target
 *  active with one of them down (mmdvm-multi failed on a busy SDR, dmrtc without its cfg) is "degraded" and
 *  `missing` says which. */
export function dmrHealth(targetActive: boolean, isActive: (unit: string) => boolean, units: readonly string[] = DMR_CORE_UNITS): DmrHealth {
  if (!targetActive) return { active: false, degraded: false, missing: [] };
  const missing = units.filter((u) => !isActive(u));
  return { active: missing.length === 0, degraded: missing.length > 0, missing };
}

export const unitActive = (unit: string): boolean => {
  try { return execSync(`systemctl is-active ${unit} 2>/dev/null`, { timeout: 4000 }).toString().trim() === "active"; }
  catch { return false; }
};
export const unitActiveOrActivating = (unit: string): boolean => {
  try {
    const s = execSync(`systemctl is-active ${unit} 2>/dev/null`, { timeout: 4000 }).toString().trim();
    return s === "active" || s === "activating";
  } catch { return false; }
};
export const unitState = (unit: string): string => {
  try { return execSync(`systemctl is-active ${unit} 2>/dev/null`, { timeout: 4000 }).toString().trim(); }
  catch (e: any) { return String(e?.stdout || "").trim() || "unknown"; }
};

export interface DmrState extends DmrHealth { installed: boolean; exists: boolean; enabled: boolean; version: string | null }
export function dmrState(): DmrState {
  const version = dmrPkgVersion();
  const installed = version !== null || fs.existsSync(DMR.multiBin);
  let exists = false, enabled = false;
  try {
    const out = execSync(`systemctl list-unit-files ${DMR.target} --no-pager --no-legend 2>/dev/null`, { timeout: 4000 }).toString();
    exists = out.includes(DMR.target);
  } catch { /* no systemd */ }
  if (!exists) exists = fs.existsSync(`/etc/systemd/system/${DMR.target}`) || fs.existsSync(`/lib/systemd/system/${DMR.target}`);
  if (exists) {
    try {
      const e = execSync(`systemctl is-enabled ${DMR.target} 2>/dev/null`, { timeout: 4000 }).toString().trim();
      enabled = e === "enabled" || e === "alias" || e === "static";
    } catch { /* disabled */ }
  }
  return { installed, exists, enabled, version, ...dmrHealth(exists && unitActive(DMR.target), unitActive, dmrCoreUnits()) };
}

/** The stack is running or half-running (gen-config refuses with dmrtc active): anything to stop first. */
export const dmrRunning = (): boolean => unitActiveOrActivating(DMR.target) || dmrCoreUnits().some(unitActiveOrActivating);

// ── Tier II ──

/** Tier II is applied: gen-config.py's marker exists (a conventional repeater, no dmrtc). */
export const dmrTier2 = (file = DMR.tier2Marker): boolean => fs.existsSync(file);
/** The core units of the tier applied: what health, "on air" and the waits of a switch look at. */
export const dmrCoreUnits = (tier2 = dmrTier2()): readonly string[] => tier2 ? DMR_CORE_UNITS_TIER2 : DMR_CORE_UNITS;

// ── SDR shared with MiuraStation ──

/** The shared mode is applied: MiuraStation keeps the SDR and the DMR stack runs next to it (selector MIURA+DMR). */
export const dmrShared = (file = DMR.sharedDropIn): boolean => fs.existsSync(file);

// The first MiuraStation that accepts [dmr_window] (its betas too); an older one refuses the section and does not start.
export const DMR_WINDOW_MIURA_MIN = "1.4.0-0";

/** config.toml holds the [dmr_window] block of gen-config.py: a line that is exactly "[dmr_window]" once trimmed,
 *  the next one starting with "# >>> dmr-tier3" and a later one starting with "# <<< dmr-tier3" (its split_block). */
export function hasDmrWindowBlock(text: string): boolean {
  const lines = text.split("\n");
  for (let i = 0; i + 1 < lines.length; i++) {
    if (lines[i].trim() !== "[dmr_window]" || !lines[i + 1].startsWith("# >>> dmr-tier3")) continue;
    if (lines.slice(i + 2).some((l) => l.startsWith("# <<< dmr-tier3"))) return true;
  }
  return false;
}

/** `systemctl show --timestamp=unix -P ExecMainStartTimestamp` ("@<seconds>") against a file's mtime: the process
 *  started before the file last changed. Whole seconds, so only a change a full second after the start counts;
 *  unknown is false (nothing is restarted on a guess). */
export function startedBeforeChange(showOut: string, mtimeMs: number): boolean {
  const m = /^@(\d+)$/.exec(showOut.trim());
  return !!m && mtimeMs >= (Number(m[1]) + 1) * 1000;
}

/** The "DMR window off: ..." line of MiuraStation's PHY (the window refused at start) in a journal text, or "". */
export function dmrWindowOffLine(journal: string): string {
  const line = journal.replace(/\x1b\[[0-9;]*m/g, "").split("\n").find((l) => l.includes("DMR window off"));
  return line ? line.slice(line.indexOf("DMR window off")).trim() : "";
}

/** gen-config.py knows the shared mode (dmr-tier3 0.4.0 or later): the 0.3.x one refuses --miura-config. */
export function genConfigKnowsShared(file = DMR.genConfig): boolean {
  try { return fs.readFileSync(file, "utf-8").includes("--miura-config"); } catch { return false; }
}

// ── The package script (bash) ──

// Instalar / Actualizar DMR Tier III from its .deb: download and check the release's .deb and SHA256SUMS, apt-get
// install (with the same apt-get update retry as MiuraStation), check the installed version. Nothing is enabled or
// started: the selector does that; on an upgrade the package's postinst stops and restarts a running stack itself
// and creates the conf from its example when there is none. allowDowngrade: an older version that was asked for.
export function dmrPackageScript(L: Layout, opts: { mode: "install" | "update"; tag: string; version: string; allowDowngrade?: boolean }): string {
  const install = opts.mode === "install";
  return `
set -euo pipefail
${lockCmd(L)}${releaseVars(opts.tag, opts.version)}die() { echo ""; echo "=== ERROR: $* ==="; exit 1; }
${aptInstall(opts.allowDowngrade ? " --allow-downgrades" : "")}echo "=== Fuente: ${DMR.repoLabel} ==="
echo "=== ${DMR.name} $VER ($TAG) ==="
${archCheck(opts.version, "die", DMR_DEB)}${fetchDeb(L, "die", DMR_DEB)}${install ? "" : `if systemctl is-active --quiet ${DMR.target} 2>/dev/null; then
  echo "=== ${DMR.target} está en marcha: el paquete la para y la vuelve a arrancar al instalarse ==="
fi
`}apt_install_deb || die "apt-get install ha fallado"
${checkInstalled(L, "die", DMR_DEB)}echo ""
echo "=== ${install ? "Instalación completada" : "Actualización instalada"}: ${DMR.name} $VER ==="${install ? `
echo "Configura la estación en el formulario DMR (${DMR.confPath}) y actívala con el selector de estación."` : ""}
exit 0
`;
}

// ── dmr-tier3.conf (KEY=VALUE) ──

const KV_RE = /^([A-Z][A-Z0-9_]*)\s*=(.*)$/;

/** The values of a KEY=VALUE text (comments and blank lines skipped; the first of a repeated key). */
export function parseDmrConf(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "").trim();
    if (!line || line.startsWith("#")) continue;
    const m = KV_RE.exec(line);
    if (m && !(m[1] in values)) values[m[1]] = m[2].trim();
  }
  return values;
}

/** The conf of the station, or null when there is none. */
export function readDmrConf(file = DMR.confPath): Record<string, string> | null {
  try { return parseDmrConf(fs.readFileSync(file, "utf-8")); } catch { return null; }
}

export interface DmrConfKey { key: string; default: string; help: string; section: string; choices?: string[] }
/** The keys of dmr-tier3.conf.example in order, each with its default and the help of the # lines right above it
 *  (a "# ---- Name" banner starts a section and is not help). A help with two or more lines that start with
 *  "<number> = " (DMR_TIER: "2 = ..." / "3 = ...") lists the values of the key: `choices`, for a select. Pure. */
export function parseDmrConfHelp(text: string): DmrConfKey[] {
  const keys: DmrConfKey[] = [];
  let section = "", help: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "").trim();
    if (!line) { help = []; continue; }
    if (line.startsWith("#")) {
      const banner = /^#\s*-{4,}\s*(.*)$/.exec(line);
      if (banner) { section = banner[1].trim(); help = []; continue; }
      help.push(line.replace(/^#\s?/, ""));
      continue;
    }
    const m = KV_RE.exec(line);
    if (m && !keys.some((k) => k.key === m[1])) {
      const choices = Array.from(new Set(help.map((l) => /^(\d+) = /.exec(l)?.[1]).filter((v): v is string => !!v)));
      keys.push({ key: m[1], default: m[2].trim(), help: help.join("\n"), section, ...(choices.length > 1 ? { choices } : {}) });
    }
    help = [];
  }
  return keys;
}
export function dmrConfHelp(examplePath = DMR.examplePath): DmrConfKey[] {
  try { return parseDmrConfHelp(fs.readFileSync(examplePath, "utf-8")); } catch { return []; }
}

/** `text` with `values` applied: a key already there is rewritten in place (comments, order and everything else
 *  stay), a missing one is appended. A key not in `known` is refused, as is a value that is not a scalar, has a
 *  line break or another control character, or is longer than DMR_VALUE_MAX. Everything else is written verbatim:
 *  the conf is only ever read by gen-config.py (never sourced by a shell), so quotes, $, backticks or ; are data.
 *  A secret that is absent or empty keeps what the file has. Pure. */
export function updateDmrConf(text: string, values: Record<string, unknown>, known: Iterable<string>): string {
  const ok = new Set(known);
  const want = new Map<string, string>();
  for (const [key, raw] of Object.entries(values)) {
    if (!DMR_KEY_RE.test(key) || !ok.has(key)) throw new Error(`clave desconocida: ${key}`);
    if (raw === undefined || raw === null) continue;
    if (typeof raw === "object") throw new Error(`${key}: valor no válido`);
    const value = String(raw).trim();
    if (/[\r\n]/.test(value)) throw new Error(`${key}: el valor no puede tener saltos de línea`);
    if (/[\x00-\x1f\x7f]/.test(value)) throw new Error(`${key}: el valor no puede tener caracteres de control`);
    if (value.length > DMR_VALUE_MAX) throw new Error(`${key}: el valor no puede pasar de ${DMR_VALUE_MAX} caracteres`);
    if ((DMR_SECRET_KEYS as readonly string[]).includes(key) && value === "") continue;
    want.set(key, value);
  }
  const lines = text.split("\n");
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, "");
    if (line.trim().startsWith("#")) continue;
    const m = KV_RE.exec(line.trim());
    if (!m || !want.has(m[1])) continue;
    lines[i] = `${m[1]}=${want.get(m[1])}`;
    seen.add(m[1]);
  }
  let out = lines.join("\n");
  const extra = Array.from(want.entries()).filter(([k]) => !seen.has(k)).map(([k, v]) => `${k}=${v}`);
  if (extra.length) {
    const head = out.replace(/\n*$/, "");
    out = `${head ? `${head}\n` : ""}${extra.join("\n")}\n`;
  }
  return out;
}

/** Writes the conf: a copy <conf>.bak-dmr-<date> (ten kept) and an atomic write that keeps its mode, or a new file
 *  with mode 0600. Returns the backup made, or null. */
export function saveDmrConf(file: string, content: string): string | null {
  let backup: string | null = null;
  if (fs.existsSync(file)) {
    if (fs.readFileSync(file, "utf-8") === content) return null;
    backup = backupWithRotation(file, "bak-dmr");
    atomicWriteFile(file, content);
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, { encoding: "utf-8", mode: 0o600 });
  }
  try { fs.chmodSync(file, 0o600); } catch { /* not on every filesystem */ }
  return backup;
}

/** read + updateDmrConf + saveDmrConf. `known` defaults to the keys of the example, else those of the file. */
export function writeDmrConf(file: string, values: Record<string, unknown>, known?: Iterable<string>, examplePath = DMR.examplePath): { content: string; backup: string | null } {
  let text = "";
  try { text = fs.readFileSync(file, "utf-8"); } catch { /* new file */ }
  const keys = known ?? (() => { const ex = dmrConfHelp(examplePath).map((k) => k.key); return ex.length ? ex : Object.keys(parseDmrConf(text)); })();
  const content = updateDmrConf(text, values, keys);
  return { content, backup: saveDmrConf(file, content) };
}

/** The messages of a gen-config.py run: the "  - error" lines of an invalid conf, else the whole stderr. */
export function genConfigErrors(code: number | null, stdout: string, stderr: string): string[] {
  if (code === 0) return [];
  const items = stderr.split("\n").map((l) => /^\s+-\s+(.*)$/.exec(l)?.[1]).filter((s): s is string => !!s);
  if (items.length) return items;
  const msg = stderr.trim() || stdout.trim();
  return [msg || `gen-config.py ha terminado con código ${code}`];
}

// ── Live log (/api/log-stream) ──

export interface LogStreamCmd { cmd: string; args: string[] }
/** The command of a live log request, from a closed list: service=dmr (the journal of the whole stack),
 *  file=dmrtc (dmrtc.log), service=<one unit> or nothing (the whole journal). An unknown file is refused (null):
 *  never a free path. */
export function logStreamCommand(q: { service?: unknown; file?: unknown }): LogStreamCmd | null {
  if (q.file !== undefined && q.file !== "") {
    if (q.file === "dmrtc") return { cmd: "tail", args: ["-n", "100", "-F", DMR.dmrtcLog] };
    return null;
  }
  if (q.service === "dmr") {
    return { cmd: "journalctl", args: [...DMR_JOURNAL_UNITS.flatMap((u) => ["-u", u]), "-f", "-n", "100", "-o", "short", "--no-pager"] };
  }
  const service = typeof q.service === "string" && /^[a-zA-Z0-9._@-]+$/.test(q.service) ? q.service : "";
  return { cmd: "journalctl", args: service ? ["-u", service, "-f", "-n", "50", "--no-pager"] : ["-f", "-n", "50", "--no-pager"] };
}

export const dmrJournalRecent = (lines = 40) =>
  `journalctl -u ${DMR.target} ${dmrCoreUnits().map((u) => `-u ${u}`).join(" ")} -n ${lines} --no-pager -o short`;
