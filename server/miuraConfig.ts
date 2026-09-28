// Loro (parrot) y WAP/datos por paquetes de FlowStation miura (port de junio de 2026).
//
// La FlowStation de razvan no conoce parrot_* en [cell_info] ni las secciones [wap], [wap.wtp],
// [wap.browse] y [packet_data], y se niega a arrancar si las ve activas. Por eso, desactivado:
// - parrot_*: se escriben comentadas (o no se escriben si no estaban);
// - [wap*] y [packet_data]: el bloque entero se comenta con "# " delante de cada línea, de modo
//   que al reactivar se descomenta tal cual y vuelve lo que no gestiona la calculadora.
// Activado, solo se tocan las claves gestionadas; el resto del bloque se conserva.

const WAP_MTUS = [296, 576, 1006, 1500, 2002];
const FAMILY = ["wap", "wap.wtp", "wap.browse", "packet_data"];
const PARROT_KEYS = ["parrot_enabled", "parrot_issi", "parrot_max_secs"];
const LINK_KEYS = ["sndcp_service", "advanced_link"];

const DEFAULT_SEARCH_URL = "http://lite.duckduckgo.com/lite/?q=";
const DEFAULT_BOOKMARKS = ["http://68k.news/", "http://wiby.me/", "http://text.npr.org/"];

const HEADER_RE = /^\s*\[([A-Za-z_][\w.-]*)\]\s*(#.*)?$/;
const AHEADER_RE = /^\s*\[\[([A-Za-z_][\w.-]*)\]\]\s*(#.*)?$/;
const CHEADER_RE = /^\s*#\s*\[\[?([A-Za-z_][\w.-]*)\]\]?\s*(#.*)?$/;
const KV_RE = /^(\s*)([A-Za-z_][\w-]*)(\s*=\s*)(.*)$/;

// Brackets opened minus closed outside strings and comments, and where a trailing comment starts.
function scanValue(s: string): { delta: number; hash: number } {
  let delta = 0;
  let q: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (q === '"' && c === "\\") { i++; continue; }
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'") q = c;
    else if (c === "#") return { delta, hash: i };
    else if (c === "[") delta++;
    else if (c === "]") delta--;
  }
  return { delta, hash: -1 };
}

// Line kinds of the file, tracking multi-line values of active keys.
type LineInfo = { kind: "header" | "aheader" | "cheader" | "kv" | "cont" | "other"; name?: string };
function scanLines(lines: string[]): LineInfo[] {
  const out: LineInfo[] = [];
  let depth = 0;
  for (const line of lines) {
    if (depth > 0) {
      out.push({ kind: "cont" });
      depth = Math.max(0, depth + scanValue(line).delta);
      continue;
    }
    let m = line.match(HEADER_RE);
    if (m) { out.push({ kind: "header", name: m[1] }); continue; }
    m = line.match(AHEADER_RE);
    if (m) { out.push({ kind: "aheader", name: m[1] }); continue; }
    m = line.match(CHEADER_RE);
    if (m) { out.push({ kind: "cheader", name: m[1] }); continue; }
    m = line.match(KV_RE);
    if (m) {
      out.push({ kind: "kv", name: m[2] });
      depth = Math.max(0, scanValue(m[4]).delta);
      continue;
    }
    out.push({ kind: "other" });
  }
  return out;
}

const isHeader = (li: LineInfo) => li.kind === "header" || li.kind === "aheader" || li.kind === "cheader";

// End (exclusive) of the block that starts at header index h: the next header, active or commented.
function blockEnd(info: LineInfo[], h: number): number {
  for (let j = h + 1; j < info.length; j++) if (isHeader(info[j])) return j;
  return info.length;
}

// Index of the header of each family table: the first active one, else the last commented one.
function findFamily(info: LineInfo[]): Record<string, { idx: number; active: boolean }> {
  const res: Record<string, { idx: number; active: boolean }> = {};
  info.forEach((li, i) => {
    if (!li.name || !FAMILY.includes(li.name)) return;
    const cur = res[li.name];
    if (li.kind === "header" && !(cur && cur.active)) res[li.name] = { idx: i, active: true };
    else if (li.kind === "cheader" && !(cur && cur.active)) res[li.name] = { idx: i, active: false };
  });
  return res;
}

// One "# " level less, when what remains is TOML the block had (key, comment, header or the rest
// of a multi-line value). Prose of the documented example blocks stays commented.
function uncommentBlock(lines: string[], h: number, end: number): void {
  let depth = 0;
  for (let i = h; i < end; i++) {
    const l = lines[i];
    if (!l.startsWith("# ")) continue;
    const cand = l.slice(2);
    if (depth > 0) {
      lines[i] = cand;
      depth = Math.max(0, depth + scanValue(cand).delta);
      continue;
    }
    const t = cand.trim();
    if (i === h || t === "" || t.startsWith("#")) { lines[i] = cand; continue; }
    const kv = cand.match(KV_RE);
    if (kv) {
      lines[i] = cand;
      depth = Math.max(0, scanValue(kv[4]).delta);
    }
  }
}

// key -> raw value of a block (active lines, or one "# " level less for a commented block).
function blockValues(lines: string[], h: number, end: number, active: boolean): Record<string, string> {
  const vals: Record<string, string> = {};
  let cur: string | null = null;
  let depth = 0;
  for (let i = h + 1; i < end; i++) {
    let l = lines[i];
    if (!active) {
      if (!l.startsWith("# ")) continue;
      l = l.slice(2);
    }
    if (cur && depth > 0) {
      const sv = scanValue(l);
      vals[cur] += " " + (sv.hash >= 0 ? l.slice(0, sv.hash) : l).trim();
      depth = Math.max(0, depth + sv.delta);
      continue;
    }
    const kv = l.match(KV_RE);
    if (!kv) continue;
    const sv = scanValue(kv[4]);
    cur = kv[2];
    if (vals[cur] !== undefined) { cur = null; continue; }
    vals[cur] = (sv.hash >= 0 ? kv[4].slice(0, sv.hash) : kv[4]).trim();
    depth = Math.max(0, sv.delta);
  }
  return vals;
}

// Basic ("...") and literal ('...') TOML strings.
const unquote = (v: string | undefined) => (v === undefined ? null : v.replace(/^"(.*)"$|^'(.*)'$/, "$1$2"));
const intArray = (v: string | undefined) =>
  v === undefined ? null : (v.replace(/^\s*\[|\]\s*$/g, "").match(/-?\d+/g) || []).map(Number);
const strArray = (v: string | undefined) =>
  v === undefined ? null : Array.from(v.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g), (m) => m[1] ?? m[2]);
const numVal = (v: string | undefined) => (v === undefined || !/^-?\d+$/.test(v) ? null : Number(v));

// Exact [cell_info] (not its sub-tables): [start, end) plus active key lines.
function cellInfoKeys(lines: string[], info: LineInfo[], keys: string[]) {
  const found: Record<string, number[]> = {};
  const commented: Record<string, number[]> = {};
  let inCell = false;
  let start = -1;
  let lastKv = -1;
  for (let i = 0; i < lines.length; i++) {
    const li = info[i];
    if (li.kind === "header" || li.kind === "aheader") {
      inCell = li.kind === "header" && li.name === "cell_info" && start === -1;
      if (inCell) { start = i; lastKv = i; }
      continue;
    }
    if (!inCell) continue;
    if (li.kind === "kv") {
      lastKv = i;
      if (keys.includes(li.name!)) (found[li.name!] ||= []).push(i);
    } else if (li.kind === "cont") {
      lastKv = i;
    } else {
      const m = lines[i].match(/^\s*#\s*([A-Za-z_]\w*)\s*=/);
      if (m && keys.includes(m[1])) (commented[m[1]] ||= []).push(i);
    }
  }
  return { found, commented, start, lastKv };
}

// Everything the WAP card switches is on: [wap] and [packet_data] enabled, sndcp_service and
// advanced_link true. The card loads ticked only then; a partial state is left as it is.
const wapAllOn = (w: { enabled: boolean; packet_data_enabled: boolean; sndcp_service: boolean; advanced_link: boolean }) =>
  w.enabled && w.packet_data_enabled && w.sndcp_service && w.advanced_link;

export function readMiuraFeatures(content: string) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const info = scanLines(lines);

  const cell = cellInfoKeys(lines, info, [...PARROT_KEYS, ...LINK_KEYS]);
  const cellVal = (k: string): string | undefined => {
    const a = cell.found[k]?.[0];
    if (a !== undefined) {
      const m = lines[a].match(KV_RE)!;
      const sv = scanValue(m[4]);
      return (sv.hash >= 0 ? m[4].slice(0, sv.hash) : m[4]).trim();
    }
    const c = cell.commented[k]?.[0];
    if (c !== undefined) return lines[c].replace(/^\s*#\s*[A-Za-z_]\w*\s*=\s*/, "").replace(/\s*#.*$/, "").trim();
    return undefined;
  };
  const activeVal = (k: string) => (cell.found[k] ? cellVal(k) : undefined);

  const fam = findFamily(info);
  const vals = (name: string) => {
    const f = fam[name];
    return f ? blockValues(lines, f.idx, blockEnd(info, f.idx), f.active) : {};
  };
  const wap = vals("wap");
  const browse = vals("wap.browse");
  const pd = vals("packet_data");
  const wapActive = !!fam["wap"]?.active && wap.enabled === "true";
  const pdActive = !!fam["packet_data"]?.active && pd.enabled === "true";

  return {
    parrot: {
      enabled: activeVal("parrot_enabled") === "true",
      parrot_issi: numVal(cellVal("parrot_issi")),
      parrot_max_secs: numVal(cellVal("parrot_max_secs")),
    },
    wap: {
      enabled: wapActive,
      packet_data_enabled: pdActive,
      sndcp_service: activeVal("sndcp_service") === "true",
      advanced_link: activeVal("advanced_link") === "true",
      gateway_ipv4: unquote(wap.gateway_ipv4),
      mtu: numVal(wap.mtu),
      browse_enabled: browse.enabled === "true",
      allowed_issis: intArray(browse.allowed_issis),
      search_url: unquote(browse.search_url),
      bookmarks: strArray(browse.bookmarks),
      // Only from an active table (Rust default "mcch" when the key is missing): a commented block
      // can be the documentation one of the example, and then the card keeps its default "pdch".
      bearer: fam["packet_data"]?.active ? (unquote(pd.bearer) ?? "mcch").trim().toLowerCase() : null,
      pdch_timeslots: intArray(pd.pdch_timeslots),
      pdch_idle_release_secs: numVal(pd.pdch_idle_release_secs),
      pool_first: unquote(pd.pool_first),
      pool_last: unquote(pd.pool_last),
    },
  };
}

const clampI = (v: any, lo: number, hi: number, def: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : def;
};
// Empty = default; anything Rust's Ipv4Addr would not parse (leading zeros included) is refused.
const OCTET = "(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const IPV4_RE = new RegExp(`^(${OCTET}\\.){3}${OCTET}$`);
const ipv4 = (v: any, def: string, key: string) => {
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v);
  if (s === "") return def;
  if (!IPV4_RE.test(s)) throw new Error(`${key}: "${s}" no es una dirección IPv4 válida`);
  return s;
};
const ipNum = (s: string) => s.split(".").reduce((a, o) => a * 256 + Number(o), 0);
const tomlStr = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

// Managed keys of each table: [key, value, Rust default]. A key missing from an existing table is
// only added when its value is not the default, so an unchanged apply leaves the file as it was.
function managedTables(c: any): Record<string, Array<[string, string, string]>> {
  const gateway = ipv4(c.gateway_ipv4, "10.0.0.1", "wap: gateway_ipv4");
  const mtu = WAP_MTUS.includes(Number(c.mtu)) ? Number(c.mtu) : 576;
  const bearer = c.bearer === "mcch" ? "mcch" : "pdch";
  const tsIn: number[] = Array.isArray(c.pdch_timeslots) ? c.pdch_timeslots.map(Number) : [];
  const ts = tsIn.filter((t, i) => [2, 3, 4].includes(t) && tsIn.indexOf(t) === i);
  const idle = clampI(c.pdch_idle_release_secs, 1, 300, 10);
  const first = ipv4(c.pool_first, "10.0.0.2", "packet_data: pool_first");
  const last = ipv4(c.pool_last, "10.0.0.254", "packet_data: pool_last");
  const a = ipNum(first), b = ipNum(last), g = ipNum(gateway);
  if (a > b) throw new Error("packet_data: pool_first no puede ser mayor que pool_last");
  if (b - a >= 1024) throw new Error("packet_data: el pool admite como máximo 1024 direcciones");
  if (g >= a && g <= b) throw new Error("packet_data: el pool no puede contener gateway_ipv4 de [wap]");
  const issis: number[] = (Array.isArray(c.allowed_issis) ? c.allowed_issis : [])
    .map(Number).filter((n: number) => Number.isInteger(n) && n >= 0 && n <= 0xffffff);
  const http = (u: any) => typeof u === "string" && /^https?:\/\//i.test(u.trim());
  const searchUrl = http(c.search_url) ? c.search_url.trim() : DEFAULT_SEARCH_URL;
  const bookmarks: string[] = Array.isArray(c.bookmarks) ? c.bookmarks.filter(http).map((u: string) => u.trim()) : DEFAULT_BOOKMARKS;
  const strList = (l: string[]) => `[${l.map(tomlStr).join(", ")}]`;
  return {
    wap: [
      ["enabled", "true", "false"],
      ["gateway_ipv4", tomlStr(gateway), '"10.0.0.1"'],
      ["mtu", String(mtu), "576"],
    ],
    "wap.browse": [
      ["enabled", c.browse_enabled === true ? "true" : "false", "false"],
      ["allowed_issis", `[${issis.join(", ")}]`, "[]"],
      ["search_url", tomlStr(searchUrl), tomlStr(DEFAULT_SEARCH_URL)],
      ["bookmarks", strList(bookmarks), strList(DEFAULT_BOOKMARKS)],
    ],
    packet_data: [
      ["enabled", "true", "false"],
      ["bearer", tomlStr(bearer), '"mcch"'],
      ["pdch_timeslots", `[${(ts.length ? ts : [4, 3, 2]).join(", ")}]`, "[4, 3, 2]"],
      ["pdch_idle_release_secs", String(idle), "10"],
      ["pool_first", tomlStr(first), '"10.0.0.2"'],
      ["pool_last", tomlStr(last), '"10.0.0.254"'],
    ],
  };
}

// Last line with content (not blank, not comment) in [from, to), or from - 1.
function lastContent(lines: string[], from: number, to: number): number {
  for (let i = to - 1; i >= from; i--) {
    const t = lines[i].trim();
    if (t && !t.startsWith("#")) return i;
  }
  return from - 1;
}

// Insert a new table after line `after` (or at the end of the file when after < 0).
function insertTable(lines: string[], after: number, block: string[]): void {
  let at = after + 1;
  if (after < 0) {
    at = lines.length;
    if (at > 0 && lines[at - 1] === "") at--; // keep the final newline last
  }
  const add = [...block];
  if (at > 0 && lines[at - 1].trim() !== "") add.unshift("");
  if (at < lines.length && lines[at].trim() !== "") add.push("");
  lines.splice(at, 0, ...add);
}

// Set the managed keys of the active table whose header is at h, keeping everything else.
function setTableKeys(lines: string[], h: number, keys: Array<[string, string, string]>): void {
  const info = scanLines(lines);
  const end = blockEnd(info, h);
  const done = new Set<string>();
  const remove: number[] = [];
  for (let i = h + 1; i < end; i++) {
    if (info[i].kind !== "kv") continue;
    const k = keys.find(([name]) => name === info[i].name);
    if (!k) continue;
    let j = i + 1;
    while (j < end && info[j].kind === "cont") j++;
    if (done.has(k[0])) { for (let r = i; r < j; r++) remove.push(r); continue; }
    done.add(k[0]);
    const m = lines[i].match(KV_RE)!;
    const sv = scanValue(m[4]);
    const tail = j === i + 1 && sv.hash >= 0 ? m[4].slice(m[4].slice(0, sv.hash).trimEnd().length) : "";
    lines[i] = `${m[1]}${k[0]}${m[3]}${k[1]}${tail}`;
    for (let r = i + 1; r < j; r++) remove.push(r);
  }
  const missing = keys.filter(([name, val, def]) => !done.has(name) && val !== def).map(([n, v]) => `${n} = ${v}`);
  // Insert before removing, after the last key of the table.
  let at = h;
  for (let i = h + 1; i < end; i++) if (info[i].kind === "kv" || info[i].kind === "cont") at = i;
  lines.splice(at + 1, 0, ...missing);
  for (const r of remove.sort((x, y) => y - x)) lines.splice(r, 1);
}

// parrotConfig / wapConfig: null (BlueStation or not sent) = not touched. Works on `lines` in
// place; a CRLF file is handled without its "\r" and gets it back at the end.
export function applyMiuraFeatures(lines: string[], parrotConfig: any, wapConfig: any): string[] {
  const crlf = lines.some((l) => l.endsWith("\r"));
  if (crlf) lines.forEach((l, i) => (lines[i] = l.replace(/\r$/, "")));
  try {
    return applyLf(lines, parrotConfig, wapConfig);
  } finally {
    if (crlf) lines.forEach((l, i) => { if (i < lines.length - 1) lines[i] = `${l}\r`; });
  }
}

function applyLf(lines: string[], parrotConfig: any, wapConfig: any): string[] {
  const doParrot = !!parrotConfig && typeof parrotConfig === "object";
  let doWap = !!wapConfig && typeof wapConfig === "object";
  // WAP off only undoes a WAP that was fully on (the card loaded ticked); a partial state
  // (e.g. sndcp_service = true without [wap], or [wap] without [packet_data]) is left alone.
  if (doWap && wapConfig.enabled !== true && !wapAllOn(readMiuraFeatures(lines.join("\n")).wap)) doWap = false;
  if (!doParrot && !doWap) return lines;

  // ── [cell_info]: parrot_* and sndcp_service / advanced_link ──
  {
    const parrotOn = doParrot && parrotConfig.enabled === true;
    const wapOn = doWap && wapConfig.enabled === true;
    const pVals: Record<string, string> = {
      parrot_enabled: parrotOn ? "true" : "false",
      parrot_issi: String(clampI(parrotConfig?.parrot_issi, 1, 0xfffffe, 99999)),
      parrot_max_secs: String(clampI(parrotConfig?.parrot_max_secs, 1, 60, 20)),
    };
    const keys = [...(doParrot ? PARROT_KEYS : []), ...(doWap ? LINK_KEYS : [])];
    const info = scanLines(lines);
    const cell = cellInfoKeys(lines, info, keys);
    if (cell.start >= 0) {
      const remove: number[] = [];
      const seen = new Set<string>();
      // First occurrence (active or commented) of each parrot key is rewritten, the rest dropped.
      for (const k of doParrot ? PARROT_KEYS : []) {
        const occ = [...(cell.found[k] || []), ...(cell.commented[k] || [])].sort((x, y) => x - y);
        if (!occ.length) continue;
        seen.add(k);
        const i = occ[0];
        const m = lines[i].match(KV_RE);
        const indent = lines[i].match(/^\s*/)![0];
        if (parrotOn) lines[i] = m ? `${m[1]}${k}${m[3]}${pVals[k]}` : `${indent}${k} = ${pVals[k]}`;
        else lines[i] = `${indent}# ${k} = ${pVals[k]}`;
        remove.push(...occ.slice(1));
      }
      // sndcp_service / advanced_link: active lines follow the WAP switch; commented ones stay.
      for (const k of doWap ? LINK_KEYS : []) {
        const occ = cell.found[k] || [];
        if (!occ.length) continue;
        seen.add(k);
        const m = lines[occ[0]].match(KV_RE)!;
        lines[occ[0]] = `${m[1]}${k}${m[3]}${wapOn ? "true" : "false"}`;
        remove.push(...occ.slice(1));
      }
      const add: string[] = [];
      if (parrotOn) for (const k of PARROT_KEYS) if (!seen.has(k)) add.push(`${k} = ${pVals[k]}`);
      if (wapOn) for (const k of LINK_KEYS) if (!seen.has(k)) add.push(`${k} = true`);
      lines.splice(cell.lastKv + 1, 0, ...add);
      for (const r of remove.sort((x, y) => y - x)) lines.splice(r > cell.lastKv ? r + add.length : r, 1);
    }
  }

  if (!doWap) return lines;

  // ── [wap] [wap.wtp] [wap.browse] [packet_data] ──
  if (wapConfig.enabled !== true) {
    // Comment out every active table of the family (commented ones stay as they are).
    const info = scanLines(lines);
    info.forEach((li, h) => {
      if (li.kind !== "header" || !(li.name === "wap" || li.name!.startsWith("wap.") || li.name === "packet_data")) return;
      const end = blockEnd(info, h);
      for (let i = h; i < end; i++) if (lines[i].trim() !== "") lines[i] = `# ${lines[i]}`;
    });
    return lines;
  }

  const tables = managedTables(wapConfig);
  // 1) Tables that are only commented come back (their unmanaged keys included).
  {
    const info = scanLines(lines);
    const fam = findFamily(info);
    const back = FAMILY.map((n) => fam[n])
      .filter((f) => f && !f.active && lines[f.idx].startsWith("# "))
      .map((f) => f!.idx)
      .sort((x, y) => y - x);
    for (const h of back) uncommentBlock(lines, h, blockEnd(info, h));
  }
  // 2) Missing tables are created: [wap] before its sub-tables (or at the end of the file),
  //    [wap.browse] and [packet_data] after the [wap] family.
  const block = (name: string) => [`[${name}]`, ...tables[name].map(([k, v]) => `${k} = ${v}`)];
  for (const name of ["wap", "wap.browse", "packet_data"]) {
    const info = scanLines(lines);
    const fam = findFamily(info);
    if (fam[name]?.active) {
      setTableKeys(lines, fam[name].idx, tables[name]);
      continue;
    }
    // A missing table that would only hold Rust defaults ([wap.browse] off) is not created.
    if (tables[name].every(([, v, def]) => v === def)) continue;
    if (name === "wap") {
      const sub = info.findIndex((li) => li.kind === "header" && li.name!.startsWith("wap."));
      if (sub >= 0) {
        const b = block(name);
        if (sub > 0 && lines[sub - 1].trim() !== "") b.unshift("");
        lines.splice(sub, 0, ...b, "");
      } else insertTable(lines, -1, block(name));
      continue;
    }
    // End of the [wap] table and of the active [wap.*] tables that follow it.
    let end = blockEnd(info, fam["wap"].idx);
    while (end < info.length && info[end].kind === "header" && info[end].name!.startsWith("wap.")) end = blockEnd(info, end);
    if (name === "packet_data" && fam["wap.browse"]?.active) end = Math.max(end, blockEnd(info, fam["wap.browse"].idx));
    insertTable(lines, lastContent(lines, fam["wap"].idx, end), block(name));
  }
  return lines;
}
