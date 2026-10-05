// Updating a station keeps its config.toml: append-only 3-way merge.
//
// user = the config.toml on disk, newTpl = example_config/config.toml of the commit being installed,
// baseTpl = example_config/config.toml of the commit that WAS installed (read before git reset / pull;
// null when unknown). No line of the user's file is ever changed, removed or moved: only keys and tables
// that are new in newTpl versus baseTpl are INSERTED, in place and with their doc comment.
// - A key or table the user commented stays commented; one the user deleted (in the base, not in the
//   file) is not added back.
// - Without a base, or under a table the user has commented, everything new goes in commented.
// - [security] and the entries of [[...]] arrays are never touched; tx_gain_* / rx_gain_* never inserted.
// - config_version different between base (or user) and newTpl = format change: nothing is merged.
// Before writing, the result must contain every original line in order (bytes included) and parse as
// TOML holding every value of the old file unchanged; otherwise nothing is written.
import * as fs from "fs";
import * as path from "path";
import { parse as parseToml } from "smol-toml";

type Kind = "blank" | "comment" | "header" | "key" | "cont";
interface SL {
  text: string; eol: string; kind: Kind; active: boolean;
  tomlTable: string; // the real TOML table (active headers only)
  docTable: string;  // last header seen, active or commented
  name?: string; isArray?: boolean; key?: string; end?: number;
}

const HEADER_RE = /^\s*(#+\s*)?(\[\[?)\s*([A-Za-z0-9_-]+(?:\s*\.\s*[A-Za-z0-9_-]+)*)\s*(\]\]?)\s*(#.*)?$/;
const KEY_RE = /^\s*([A-Za-z0-9_-]+)\s*=\s*(.*)$/;
// Commented key "# key = <TOML value>": the value must look like TOML so that prose ("# Absent = on.") is not a key.
const CKEY_RE = /^\s*#+ ?([a-z0-9_]+)\s*=\s*((?:"|'|\[|\{|true\b|false\b|[-+]?\d|inf\b|nan\b).*)$/;
// Continuation of the trailing comment of the key above: "#        # ..." or a deeply indented "#".
const CONT_COMMENT_RE = /^\s*#\s{2,}#|^\s{6,}#/;

// Bracket/brace depth and open multi-line string, outside strings and comments.
function scanValue(v: string, st: { depth: number; ml: string | null }) {
  let i = 0;
  while (i < v.length) {
    if (st.ml) { const j = v.indexOf(st.ml, i); if (j < 0) return; i = j + 3; st.ml = null; continue; }
    const c = v[i];
    if (c === "#") return;
    if (v.startsWith('"""', i) || v.startsWith("'''", i)) { st.ml = v.substr(i, 3); i += 3; continue; }
    if (c === '"') { i++; while (i < v.length && v[i] !== '"') { if (v[i] === "\\") i++; i++; } i++; continue; }
    if (c === "'") { const j = v.indexOf("'", i + 1); i = j < 0 ? v.length : j + 1; continue; }
    if (c === "[" || c === "{") st.depth++;
    else if (c === "]" || c === "}") st.depth--;
    i++;
  }
}

// Lines with their own end of line ("\n", "\r\n" or none on the last one).
const splitKeep = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];

function scan(text: string): SL[] {
  const out: SL[] = [];
  let tomlTable = "", docTable = "";
  let open: { idx: number; commented: boolean; st: { depth: number; ml: string | null } } | null = null;
  for (const p of splitKeep(text)) {
    const eol = p.endsWith("\r\n") ? "\r\n" : p.endsWith("\n") ? "\n" : "";
    const t = p.slice(0, p.length - eol.length);
    const base = { text: t, eol, tomlTable, docTable };
    if (open) {
      const isC = /^\s*#/.test(t);
      if (!open.commented || isC) {
        scanValue(open.commented ? t.replace(/^\s*#+/, "") : t, open.st);
        out.push({ ...base, kind: "cont", active: !open.commented });
        if (open.st.depth <= 0 && !open.st.ml) { out[open.idx].end = out.length - 1; open = null; }
        continue;
      }
      out[open.idx].end = out.length - 1; open = null; // unterminated commented block: it ends here
    }
    if (/^\s*$/.test(t)) { out.push({ ...base, kind: "blank", active: false }); continue; }
    const h = t.match(HEADER_RE);
    if (h && h[2].length === h[4].length) {
      const name = h[3].replace(/\s*\.\s*/g, ".");
      const active = !h[1];
      if (active) tomlTable = name;
      docTable = name;
      out.push({ text: t, eol, kind: "header", active, tomlTable, docTable, name, isArray: h[2] === "[[" });
      continue;
    }
    const k = t.match(KEY_RE);
    const ck = k ? null : t.match(CKEY_RE);
    if (k || ck) {
      const m = (k ?? ck)!;
      const st = { depth: 0, ml: null as string | null };
      scanValue(m[2], st);
      out.push({ ...base, kind: "key", active: !!k, key: m[1], end: out.length });
      if (st.depth > 0 || st.ml) open = { idx: out.length - 1, commented: !k, st };
      continue;
    }
    out.push({ ...base, kind: "comment", active: false });
    // continuation lines of a trailing comment belong to the key above
    if (CONT_COMMENT_RE.test(t)) {
      let j = out.length - 2;
      while (j >= 0 && out[j].kind === "cont") j--;
      if (j >= 0 && out[j].kind === "key" && (out[j].end ?? j) === out.length - 2) out[j].end = out.length - 1;
    }
  }
  if (open) out[open.idx].end = out.length - 1;
  return out;
}

const tableOf = (l: SL) => (l.active ? l.tomlTable : l.docTable);
const isUnder = (t: string, parent: string) => t === parent || t.startsWith(parent + ".");
const isSecurity = (t: string) => isUnder(t, "security");

interface Entry { table: string; key: string; active: boolean; docStart: number; keyLine: number; end: number }
function entries(lines: SL[]): Entry[] {
  const out: Entry[] = [];
  lines.forEach((l, i) => {
    if (l.kind !== "key") return;
    let s = i;
    while (s > 0 && lines[s - 1].kind === "comment" && !CONT_COMMENT_RE.test(lines[s - 1].text)) s--;
    out.push({ table: tableOf(l), key: l.key!, active: l.active, docStart: s, keyLine: i, end: l.end ?? i });
  });
  return out;
}
const arrayTables = (lines: SL[]) => lines.filter((l) => l.kind === "header" && l.isArray).map((l) => l.name!);
// Sections whose unknown keys stop miura/TEA2/razvan/bluestation from starting.
const STRICT = ["", "phy_io", "phy_io.soapysdr", "net_info", "cell_info", "cell_info.sds_command_control", "brew", "asterisk", "dapnet",
  "geoalarm", "tpg2200_action", "snom_notify", "telemetry", "telegram_alerts", "recovery", "health", "emergency", "wap", "wap.wtp", "wap.browse", "packet_data"];

const configVersion = (L: SL[]) => {
  const l = L.find((x) => x.kind === "key" && x.active && x.tomlTable === "" && x.key === "config_version");
  return l ? l.text.replace(/^[^=]*=/, "").replace(/\s+#.*$/, "").trim().replace(/^"(.*)"$|^'(.*)'$/, "$1$2") : null;
};

export interface MergeResult {
  merged: string; changed: boolean;
  versionChange?: { from: string; to: string }; // format change: nothing merged
  added: string[];          // "[table] key (activa|comentada)" / "[table] tabla nueva (...)"
  skippedDeleted: string[]; // in the base, not in the user: deleted by the user, not added back
  security: string[];       // names only, never values
  unknownKept: string[];    // active user keys the new template does not mention
  review: string[];         // things not added on purpose
}

export function mergeAppendOnly(user: string, newTpl: string, baseTpl: string | null): MergeResult {
  const U = scan(user), N = scan(newTpl), B = baseTpl !== null ? scan(baseTpl) : null;
  const res: MergeResult = { merged: user, changed: false, added: [], skippedDeleted: [], security: [], unknownKept: [], review: [] };
  const cvN = configVersion(N), cvB = B ? configVersion(B) : null, cvU = configVersion(U);
  const cvOld = cvB !== null && cvB !== cvN ? cvB : cvU !== null && cvU !== cvN ? cvU : null;
  if (cvN !== null && cvOld !== null) { res.versionChange = { from: cvOld, to: cvN }; return res; }

  const eol = (user.match(/\r\n/g)?.length ?? 0) > (user.match(/(?<!\r)\n/g)?.length ?? 0) ? "\r\n" : "\n";
  const NE = entries(N), UE = entries(U);
  const baseKeys = B ? new Set(entries(B).map((e) => `${e.table}\u0000${e.key}`)) : null;
  const baseTables = B ? new Set(B.filter((l) => l.kind === "header").map((l) => l.name!)) : null;
  const arrays = [...arrayTables(N), ...arrayTables(U), ...(B ? arrayTables(B) : [])];
  const inArray = (t: string) => arrays.some((a) => isUnder(t, a));
  const userHeaders = (t: string) => U.map((l, i) => ({ l, i })).filter(({ l }) => l.kind === "header" && l.name === t);
  const userHasTable = (t: string) => t === "" || userHeaders(t).length > 0;
  const userTableActive = (t: string) => t === "" || userHeaders(t).some(({ l }) => l.active);
  const occ = (t: string, k: string) => UE.filter((e) => e.table === t && e.key === k);
  const inserts: { after: number; lines: string[]; order: number }[] = [];
  let order = 0;
  const TABLE_ORDER = 1e6;

  // End of the user's region of a table: its last key/header line before the comments that precede the
  // next header. For an active insert only active headers count (TOML truth: active keys after a
  // commented header still belong to this table and must not end up under the new one).
  const regionEnd = (hdrIdx: number, activeOnly: boolean) => {
    let j = hdrIdx + 1;
    while (j < U.length && !(U[j].kind === "header" && (!activeOnly || U[j].active))) j++;
    let k = j - 1;
    while (k > hdrIdx && (U[k].kind === "comment" || U[k].kind === "blank")) k--;
    return k;
  };

  // 1) Whole new tables (not in the user's file in any form).
  const tplTables = N.filter((l) => l.kind === "header").map((l) => l.name!).filter((v, i, a) => a.indexOf(v) === i);
  const addedTables = new Set<string>();
  for (const t of tplTables) {
    if (userHasTable(t) || addedTables.has(t)) continue;
    if (isSecurity(t)) { if (!baseTables?.has(t)) res.security.push(`[${t}] (tabla nueva)`); continue; }
    if (baseTables && baseTables.has(t)) { res.skippedDeleted.push(`[${t}]`); continue; }
    const hi = N.findIndex((l) => l.kind === "header" && l.name === t);
    let s = hi; while (s > 0 && N[s - 1].kind === "comment") s--;
    // up to the next table that is not a sub-table (an active [[...]] sub-table is left to its own turn)
    let e = hi + 1;
    while (e < N.length && !(N[e].kind === "header" && (!isUnder(N[e].name!, t) || (N[e].isArray && N[e].active && N[e].name !== t)))) e++;
    // the comments at the end already document the next header
    let k = e - 1; while (k > hi && (N[k].kind === "comment" || N[k].kind === "blank")) k--;
    const block = N.slice(s, k + 1);
    const hasActive = block.some((l) => l.active);
    if (hasActive && (inArray(t) || !baseTables)) { res.review.push(`[${t}] tabla nueva ACTIVA en la plantilla: no se añade sola`); continue; }
    if (block.some((l) => l.kind === "header" && (userHasTable(l.name!) || isSecurity(l.name!)))) continue; // sub-table already there: keys below
    // after the region of the previous template table the user has
    let anchor = -1;
    for (let p = tplTables.indexOf(t) - 1; p >= 0 && anchor < 0; p--) {
      const hs = userHeaders(tplTables[p]); if (hs.length) anchor = regionEnd(hs[hs.length - 1].i, hasActive);
    }
    if (anchor < 0) anchor = U.length - 1;
    // never inside the user's [security] (active or commented): before its header and doc comments instead
    if (anchor >= 0 && (isSecurity(U[anchor].tomlTable) || isSecurity(U[anchor].docTable))) {
      let h = anchor; while (h > 0 && !(U[h].kind === "header" && isSecurity(U[h].name!))) h--;
      while (h > 0 && U[h - 1].kind === "header" && isSecurity(U[h - 1].name!)) h--;
      anchor = h - 1; while (anchor >= 0 && (U[anchor].kind === "comment" || U[anchor].kind === "blank")) anchor--;
    }
    // TABLE_ORDER: at the same anchor the new keys of the table above go first, then the new table
    inserts.push({ after: anchor, lines: ["", ...block.map((l) => l.text)], order: TABLE_ORDER + order++ });
    res.added.push(`[${t}] tabla nueva (${hasActive ? "activa" : "comentada"}, ${block.length} líneas)`);
    for (const l of block) if (l.kind === "header") addedTables.add(l.name!);
  }

  // 2) New keys of tables the user already has.
  const lastAnchor: Record<string, { idx: number; activeRegion: boolean }> = {};
  for (const e of NE) {
    const t = e.table, id = `${t}\u0000${e.key}`;
    const present = occ(t, e.key);
    if (present.length) {
      // only an occurrence documented under this very table can anchor (else a commented insert lands elsewhere)
      const good = present.filter((o) => U[o.keyLine].docTable === t);
      const act = good.find((o) => U[o.keyLine].tomlTable === t);
      if (act) lastAnchor[t] = { idx: act.end, activeRegion: true };
      else if (good.length) lastAnchor[t] = { idx: good[good.length - 1].end, activeRegion: false };
      continue;
    }
    if (!userHasTable(t)) continue;                       // missing table: step 1
    if (isSecurity(t)) { if (!baseKeys?.has(id)) res.security.push(`[${t}] ${e.key}`); continue; }
    if (inArray(t)) continue;                             // entries of [[...]]: user data
    if (baseKeys && baseKeys.has(id)) { res.skippedDeleted.push(`[${t}] ${e.key}`); continue; }
    if (/^(tx|rx)_gain_/.test(e.key)) continue;           // SDR gains: always the user's
    const wantActive = e.active && userTableActive(t) && !!baseKeys;
    if (e.active && !wantActive) res.review.push(`[${t}] ${e.key}: activa en la plantilla, añadida COMENTADA (${!baseKeys ? "sin plantilla base" : "tabla comentada en tu config"})`);
    let after: number;
    const a = lastAnchor[t];
    if (a && (!wantActive || a.activeRegion)) after = a.idx;
    else if (t === "") {
      const firstHdr = U.findIndex((l) => l.kind === "header");
      after = firstHdr < 0 ? U.length - 1 : firstHdr - 1;
      while (after > 0 && U[after].kind !== "key" && U[after].kind !== "cont") after--;
    } else {
      const hs = userHeaders(t);
      const h = wantActive ? hs.find(({ l }) => l.active) : hs[0];
      if (!h) continue;
      after = h.i;
    }
    const keyLines = N.slice(e.keyLine, e.end + 1).map((l) => l.text);
    const doc = N.slice(e.docStart, e.keyLine).map((l) => l.text);
    const body = wantActive || !e.active ? keyLines : keyLines.map((x) => "# " + x);
    inserts.push({ after, lines: [...doc, ...body], order: order++ });
    res.added.push(`[${t}] ${e.key} (${wantActive ? "activa" : "comentada"})`);
  }

  // 3) Active user keys the new template does not mention at all: kept, and listed.
  const tplIds = new Set(NE.map((e) => `${e.table}\u0000${e.key}`));
  for (const e of UE) if (e.active && !tplIds.has(`${e.table}\u0000${e.key}`) && !inArray(e.table) && !isSecurity(e.table)) {
    const gain = e.table === "phy_io.soapysdr" && /^(tx|rx)_gain_/.test(e.key);
    res.unknownKept.push(`[${e.table}] ${e.key}${gain ? " (ganancia del SDR: la aceptan todas las versiones)" : STRICT.includes(e.table) ? " (sección estricta: si la estación no la conoce, NO arranca)" : " (sección tolerante: se ignora si no la conoce)"}`);
  }

  if (!inserts.length) return res;
  const lines = U.map((l) => l.text + l.eol);
  inserts.sort((x, y) => (y.after - x.after) || (y.order - x.order));
  for (const ins of inserts) {
    const at = ins.after;
    if (at >= 0 && lines[at] !== undefined && !lines[at].endsWith("\n")) lines[at] += eol; // last line without newline
    lines.splice(at + 1, 0, ...ins.lines.map((x) => x + eol));
  }
  if (!user.endsWith("\n")) lines[lines.length - 1] = lines[lines.length - 1].replace(/\r?\n$/, "");
  res.merged = lines.join("");
  res.changed = res.merged !== user;
  return res;
}

// ── Checks before writing ──

const stripBom = (s: string) => s.replace(/^﻿/, "");
// First line and position only: the rest of the message quotes the line (a key of [security], a password).
const tomlErr = (e: any) => (e && typeof e.line === "number"
  ? `${String(e.message).split("\n")[0].replace(/^Invalid TOML document: /, "")}, línea ${e.line}, columna ${e.column}`
  : "error de sintaxis");
const isPlainObj = (v: any) => v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);
function flatten(v: any, pre: string, out: Map<string, string>) {
  if (isPlainObj(v)) { for (const k of Object.keys(v)) flatten(v[k], pre ? `${pre}.${k}` : k, out); return; }
  if (Array.isArray(v) && v.length && v.every(isPlainObj)) { v.forEach((x, i) => flatten(x, `${pre}[${i}]`, out)); return; }
  out.set(pre, JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? `${x}n` : x)));
}

// null = fine; otherwise why the result must not be written (names only, never values).
export function verifyMerge(user: string, merged: string): string | null {
  const ul = splitKeep(user), ml = splitKeep(merged);
  let j = 0;
  for (let i = 0; i < ul.length; i++) {
    const want = ul[i];
    const lastNoEol = i === ul.length - 1 && !want.endsWith("\n");
    while (j < ml.length && (lastNoEol ? ml[j].replace(/\r?\n$/, "") : ml[j]) !== want) j++;
    if (j >= ml.length) return `la línea ${i + 1} del config.toml original no se conservaría tal cual`;
    j++;
  }
  let a: any, b: any;
  try { a = parseToml(stripBom(user)); } catch (e) { return `el config.toml actual no es TOML válido (${tomlErr(e)})`; }
  try { b = parseToml(stripBom(merged)); } catch (e) { return `el resultado no sería TOML válido (${tomlErr(e)})`; }
  const fa = new Map<string, string>(), fb = new Map<string, string>();
  flatten(a, "", fa); flatten(b, "", fb);
  for (const [k, v] of Array.from(fa)) {
    if (!fb.has(k)) return `se perdería ${k}`;
    if (fb.get(k) !== v) return `cambiaría el valor de ${k}`;
  }
  return null;
}

// ── Writing ──

// Copy of `file` as <file>.<tag>-<ISO date>, mode 600 (it may hold keys or passwords). Only the `keep`
// most recent copies of that tag are kept.
export function backupWithRotation(file: string, tag = "bak", keep = 10): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const bak = `${file}.${tag}-${stamp}`;
  fs.copyFileSync(file, bak);
  try { fs.chmodSync(bak, 0o600); } catch { /* not on every filesystem */ }
  try {
    const dir = path.dirname(file);
    const prefix = `${path.basename(file)}.${tag}-`;
    const old = fs.readdirSync(dir)
      .filter((n) => n.startsWith(prefix) && /^\d{4}-\d{2}-\d{2}T/.test(n.slice(prefix.length)))
      .sort();
    for (const n of old.slice(0, Math.max(0, old.length - keep))) fs.unlinkSync(path.join(dir, n));
  } catch { /* rotation is best effort */ }
  return bak;
}

// Temporary file in the same directory + fsync + rename, keeping the mode and owner of the original.
export function atomicWriteFile(file: string, content: string): void {
  const real = fs.realpathSync(file);
  const st = fs.statSync(real);
  const tmp = path.join(path.dirname(real), `.${path.basename(real)}.tmp-${process.pid}`);
  try {
    const fd = fs.openSync(tmp, "w", st.mode & 0o7777);
    try { fs.writeFileSync(fd, content, "utf-8"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    try { fs.chmodSync(tmp, st.mode & 0o7777); } catch { /* idem */ }
    try { fs.chownSync(tmp, st.uid, st.gid); } catch { /* not root / not POSIX */ }
    fs.renameSync(tmp, real);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* already gone */ }
    throw e;
  }
}

// The whole step of an update: merge, check, back up, write. Logs in Spanish for the updater output.
// Returns true when config.toml was rewritten.
export function mergeConfigFile(cfgPath: string, newTpl: string, baseTpl: string | null, log: (s: string) => void): boolean {
  const user = fs.readFileSync(cfgPath, "utf-8");
  const r = mergeAppendOnly(user, newTpl, baseTpl);
  if (r.versionChange) {
    log(`AVISO: la plantilla nueva cambia config_version de "${r.versionChange.from}" a "${r.versionChange.to}" (cambio de formato).\n`);
    log("config.toml NO se ha tocado: revísalo a mano comparándolo con example_config/config.toml;\n");
    log("hasta entonces la estación puede negarse a arrancar.\n");
    return false;
  }
  if (!baseTpl) log("Sin plantilla del commit anterior: todo lo nuevo se añade COMENTADO.\n");
  for (const s of r.security) log(`  S ${s}: nueva en la plantilla; [security] no se toca, revísala a mano\n`);
  for (const s of r.review) log(`  ? ${s}\n`);
  if (r.unknownKept.length) {
    log(`Claves tuyas que la plantilla nueva no documenta (se conservan):\n`);
    for (const s of r.unknownKept) log(`  = ${s}\n`);
  }
  if (r.skippedDeleted.length) log(`${r.skippedDeleted.length} claves/tablas de la plantilla anterior no están en tu config.toml: se respeta (no se añaden).\n`);
  if (!r.changed) { log("config.toml ya está al día: nada nuevo que añadir (no se ha tocado).\n"); return false; }
  const bad = verifyMerge(user, r.merged);
  if (bad) { log(`No se escribe (config.toml intacto): ${bad}.\n`); return false; }
  const bak = backupWithRotation(cfgPath);
  atomicWriteFile(cfgPath, r.merged);
  log(`Copia de seguridad: ${bak}\n`);
  log(`Añadido a config.toml (${r.added.length}; ninguna línea existente se ha modificado):\n`);
  for (const a of r.added) log(`  + ${a}\n`);
  return true;
}

// What a station that refused its config (or crashed at start) writes to the journal.
export const STATION_START_FAIL_RE = /Failed to load (primary config|configuration)|Unrecognized|Cannot start|FALLBACK CONFIG ACTIVE|panicked/;
