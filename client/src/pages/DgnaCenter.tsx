import { useState, useMemo, useEffect } from "react";
import { Hexagon, Plus, Trash2, Check, X, Users, Lock, AlertTriangle, CheckCircle2, ListChecks } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useTetraWebSocket, type Terminal, type DgnaLogEntry } from "@/hooks/useTetraWebSocket";

// DGNA Center: bulk assign/update/deassign of dynamic groups across radios, a group
// library auto-populated from live affiliations (+ manual templates), per-radio group
// state and a server-persisted activity log. Mirrors flowstation's DGNA page.
// Commands go through POST /api/dgna → flowstation {type:'dgna', issi, gssi, mnemonic,
// attachment_mode, attach}; results stream back as fs_dgna_status telemetry.

const TPL_KEY = "tetra_dgna_templates";

type Template = { gssi: number; mnemonic: string; attachMode: number };
type AggGroup = {
  gssi: number; mnemonic: string;
  deviceCount: number; attachedCount: number; dynamicCount: number;
  isTemplate: boolean; attachMode: number;
};

const ATTACH_LABELS: Record<number, string> = {
  0: "0 — Attached permanently",
  1: "1 — On next ITSI attach",
  2: "2 — Not allowed on ITSI attach",
  3: "3 — On next location update",
  4: "4 — Not attached, may request",
  5: "5 — Not attached, no request",
};

function loadJson<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); if (v) return JSON.parse(v) as T; } catch {}
  return fallback;
}
function saveJson(key: string, val: unknown) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

// Per-radio state for a given GSSI: derived from the rich group catalog, falling back
// to the flat groups list (attached, static) when no catalog is present.
function targetState(t: Terminal, gssi: number): { is_dynamic: boolean; is_attached: boolean; mnemonic: string } | null {
  const cat = (t.groupCatalog || []).find(g => g.gssi === gssi);
  if (cat) return { is_dynamic: cat.is_dynamic, is_attached: cat.is_attached, mnemonic: cat.mnemonic };
  if ((t.groups || []).map(String).includes(String(gssi))) return { is_dynamic: false, is_attached: true, mnemonic: "" };
  return null;
}

// Port of flowstation's dgna status → {kind,label} for the LAST RESULT / activity cells.
function statusPresentation(e: DgnaLogEntry): { kind: "ok" | "fail" | "pending"; label: string } {
  const detail = String(e?.detail || "");
  const rejected = detail.startsWith("Rejected:");
  const ack = detail.includes("ACK");
  const parseFail = detail.includes("parse failed");
  const queued = detail.startsWith("Queued:") || detail.startsWith("Waiting for backend:");
  const final = rejected || ack || parseFail;
  if (queued && !final) return { kind: "pending", label: "PENDING" };
  if (final && e.accepted) return { kind: "ok", label: "OK" };
  if (final) return { kind: "fail", label: "FAIL" };
  if (e.source === "MM" || e.source === "CMCE") return { kind: "pending", label: "PENDING" };
  return e.accepted ? { kind: "ok", label: "PENDING" } : { kind: "fail", label: "FAIL" };
}

export default function DgnaCenter() {
  const { t } = useI18n();
  const { terminals, fsDashboardActive, dgnaLog } = useTetraWebSocket();

  const [templates, setTemplates] = useState<Template[]>(() => loadJson<Template[]>(TPL_KEY, []));
  const [selectedGssi, setSelectedGssi] = useState<number | null>(null);
  const [selectedIssis, setSelectedIssis] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const [newGssi, setNewGssi] = useState("");
  const [newName, setNewName] = useState("");
  const [newMode, setNewMode] = useState("0");

  useEffect(() => { saveJson(TPL_KEY, templates); }, [templates]);

  const localRadios = useMemo(
    () => Object.values(terminals).filter(tr => tr.isLocal).sort((a, b) => Number(a.id) - Number(b.id)),
    [terminals]
  );

  // Aggregate groups seen across radios (catalog or flat) + manual templates → coverage.
  const groups = useMemo<AggGroup[]>(() => {
    const map = new Map<number, AggGroup>();
    const ensure = (gssi: number): AggGroup => {
      let g = map.get(gssi);
      if (!g) { g = { gssi, mnemonic: "", deviceCount: 0, attachedCount: 0, dynamicCount: 0, isTemplate: false, attachMode: 0 }; map.set(gssi, g); }
      return g;
    };
    for (const r of localRadios) {
      const cat = r.groupCatalog && r.groupCatalog.length
        ? r.groupCatalog
        : (r.groups || []).map(gssi => ({ gssi: Number(gssi), mnemonic: "", attachment_mode: 0, is_dynamic: false, is_attached: true }));
      for (const c of cat) {
        if (!Number.isFinite(c.gssi)) continue;
        const g = ensure(c.gssi);
        g.deviceCount++;
        if (c.is_attached) g.attachedCount++;
        if (c.is_dynamic) g.dynamicCount++;
        if (!g.mnemonic && c.mnemonic) g.mnemonic = c.mnemonic;
        if (c.is_dynamic && c.attachment_mode) g.attachMode = c.attachment_mode;
      }
    }
    for (const tpl of templates) {
      const g = ensure(tpl.gssi);
      g.isTemplate = true;
      if (tpl.mnemonic) g.mnemonic = tpl.mnemonic;
      g.attachMode = tpl.attachMode;
    }
    let arr = Array.from(map.values()).sort((a, b) => a.gssi - b.gssi);
    const q = search.trim().toLowerCase();
    if (q) arr = arr.filter(g => String(g.gssi).includes(q) || g.mnemonic.toLowerCase().includes(q));
    return arr;
  }, [localRadios, templates, search]);

  const selectedGroup = useMemo(() => groups.find(g => g.gssi === selectedGssi) || null, [groups, selectedGssi]);

  // Most recent DGNA telemetry per ISSI (dgnaLog is newest-first) for the LAST RESULT cell.
  const lastByIssi = useMemo(() => {
    const m = new Map<number, DgnaLogEntry>();
    for (const e of dgnaLog) if (!m.has(e.issi)) m.set(e.issi, e);
    return m;
  }, [dgnaLog]);

  function addTemplate() {
    const gssi = parseInt(newGssi, 10);
    if (!gssi || gssi <= 0 || gssi > 16777215) return;
    if (templates.some(tpl => tpl.gssi === gssi)) return;
    setTemplates([...templates, { gssi, mnemonic: newName.trim().slice(0, 15), attachMode: parseInt(newMode, 10) || 0 }].sort((a, b) => a.gssi - b.gssi));
    setNewGssi(""); setNewName(""); setNewMode("0");
    setSelectedGssi(gssi);
  }
  function removeTemplate(gssi: number) {
    setTemplates(templates.filter(tpl => tpl.gssi !== gssi));
  }

  function toggleIssi(id: string) {
    const next = new Set(selectedIssis);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIssis(next);
  }
  function selectBy(mode: "all" | "none" | "attached" | "dynamic") {
    if (mode === "none") { setSelectedIssis(new Set()); return; }
    if (mode === "all") { setSelectedIssis(new Set(localRadios.map(r => r.id))); return; }
    if (!selectedGroup) return;
    const gssi = selectedGroup.gssi;
    setSelectedIssis(new Set(localRadios.filter(r => {
      const st = targetState(r, gssi);
      return st && (mode === "attached" ? st.is_attached : st.is_dynamic);
    }).map(r => r.id)));
  }

  async function runBulk(action: "assign" | "deassign" | "update" | "assign-all") {
    if (!selectedGroup || !password || busy) return;
    const attach = action !== "deassign";
    let targets: Terminal[];
    if (action === "assign-all") targets = localRadios;
    else if (action === "update") targets = localRadios.filter(r => selectedIssis.has(r.id) && targetState(r, selectedGroup.gssi));
    else targets = localRadios.filter(r => selectedIssis.has(r.id));
    if (targets.length === 0) { setStatus({ ok: false, text: t("dgnac_no_targets") }); return; }
    setBusy(true);
    setStatus(null);
    let okCount = 0;
    for (const r of targets) {
      try {
        const resp = await fetch("/api/dgna", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            password, issi: Number(r.id), gssi: selectedGroup.gssi,
            mnemonic: selectedGroup.mnemonic, attachment_mode: selectedGroup.attachMode, attach,
          }),
        });
        const j = await resp.json().catch(() => ({}));
        if (resp.ok && j.ok !== false) okCount++;
      } catch {}
    }
    setBusy(false);
    setStatus({ ok: okCount === targets.length, text: t("dgnac_result").replace("{ok}", String(okCount)).replace("{total}", String(targets.length)) });
  }

  async function clearLog() {
    try { await fetch("/api/dgna-log", { method: "DELETE" }); } catch {}
  }

  const hasTargets = selectedIssis.size > 0;
  const canRun = !!selectedGroup && !!password && fsDashboardActive && !busy;

  return (
    <div className="flex-1 flex flex-col p-3 gap-3 overflow-auto" data-testid="page-dgna-center">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Hexagon className="w-5 h-5 text-indigo-400" />
          <div>
            <h1 className="text-base font-black tracking-wide text-foreground">{t("dgnac_title")}</h1>
            <p className="text-[11px] text-muted-foreground">{t("dgnac_subtitle")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>{t("dgnac_library")}: <b className="text-foreground">{groups.length}</b></span>
          <span>{t("dgnac_targets")}: <b className="text-foreground">{localRadios.length}</b></span>
          <span className={`font-bold px-2 py-1 rounded border ${fsDashboardActive ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40" : "bg-rose-500/15 text-rose-300 border-rose-500/40"}`}>
            {fsDashboardActive ? t("dgnac_flow_on") : t("dgnac_flow_off")}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Group Library */}
        <section className="bg-card border border-border rounded-lg p-3 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs font-bold text-foreground">
            <ListChecks className="w-4 h-4 text-indigo-400" /> {t("dgnac_library")}
          </div>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder={t("dgnac_search")}
            className="w-full bg-background border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-indigo-400" data-testid="input-dgnac-search" />

          {/* add template */}
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex-1 min-w-[80px]">
              <label className="text-[9px] text-muted-foreground">{t("dgna_gssi")}</label>
              <input type="number" min="1" value={newGssi} onChange={e => setNewGssi(e.target.value)} placeholder="100"
                className="w-full bg-background border border-border rounded px-2 py-1 text-xs font-mono text-foreground focus:outline-none focus:border-indigo-400" data-testid="input-dgnac-new-gssi" />
            </div>
            <div className="flex-1 min-w-[80px]">
              <label className="text-[9px] text-muted-foreground">{t("dgna_mnemonic")}</label>
              <input type="text" maxLength={15} value={newName} onChange={e => setNewName(e.target.value)} placeholder="ALFA"
                className="w-full bg-background border border-border rounded px-2 py-1 text-xs font-mono text-foreground focus:outline-none focus:border-indigo-400" data-testid="input-dgnac-new-name" />
            </div>
            <div className="flex-1 min-w-[110px]">
              <label className="text-[9px] text-muted-foreground">{t("dgna_attach_mode")}</label>
              <select value={newMode} onChange={e => setNewMode(e.target.value)}
                className="w-full bg-background border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-indigo-400" data-testid="select-dgnac-new-mode">
                {[0, 1, 2, 3, 4, 5].map(m => <option key={m} value={m}>{ATTACH_LABELS[m]}</option>)}
              </select>
            </div>
            <button onClick={addTemplate} disabled={!newGssi}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold rounded bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40" data-testid="button-dgnac-add-group">
              <Plus className="w-3.5 h-3.5" /> {t("dgnac_add")}
            </button>
          </div>

          <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-x-2 text-[9px] font-bold text-muted-foreground uppercase tracking-wider mt-1 px-2">
            <span>{t("dgna_gssi")}</span><span>{t("dgna_mnemonic")}</span><span>{t("dgnac_coverage")}</span><span></span>
          </div>
          <div className="flex flex-col gap-1 max-h-[300px] overflow-auto">
            {groups.length === 0 && <div className="text-[11px] text-muted-foreground/60 py-2">{t("dgnac_no_groups")}</div>}
            {groups.map(g => {
              const active = g.gssi === selectedGssi;
              const coverage = `${g.attachedCount}/${g.deviceCount} radios${g.dynamicCount ? ` · ${g.dynamicCount} dyn` : ""}${g.deviceCount === 0 && g.isTemplate ? ` · ${t("dgnac_template")}` : ""}`;
              return (
                <div key={g.gssi} onClick={() => setSelectedGssi(g.gssi)}
                  className={`grid grid-cols-[1fr_1fr_auto_auto] gap-x-2 items-center px-2 py-1.5 rounded border cursor-pointer transition-colors ${active ? "bg-indigo-500/20 border-indigo-400" : "bg-white/5 border-white/10 hover:bg-white/10"}`}
                  data-testid={`row-dgnac-group-${g.gssi}`}>
                  <span className="font-mono text-xs text-sky-300 font-bold flex items-center gap-1">
                    {active && <Check className="w-3 h-3 text-indigo-300" />}{g.gssi}
                  </span>
                  <span className="text-xs text-foreground truncate">{g.mnemonic || "-"}</span>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">{coverage}</span>
                  {g.isTemplate
                    ? <button onClick={e => { e.stopPropagation(); removeTemplate(g.gssi); }} className="text-muted-foreground hover:text-rose-400" data-testid={`button-dgnac-del-group-${g.gssi}`}><Trash2 className="w-3.5 h-3.5" /></button>
                    : <span className="w-3.5" />}
                </div>
              );
            })}
          </div>
        </section>

        {/* DGNA Actions */}
        <section className="bg-card border border-border rounded-lg p-3 flex flex-col gap-3">
          <div className="flex items-center justify-between text-xs font-bold text-foreground">
            <span>{t("dgnac_actions")}</span>
            <span className="text-muted-foreground font-normal">{selectedIssis.size} {t("dgnac_selected_count")}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            {selectedGroup
              ? <>{t("dgnac_selected_group")}: <span className="font-mono text-sky-300 font-bold">{selectedGroup.gssi}</span>{selectedGroup.mnemonic && <span className="text-foreground"> {selectedGroup.mnemonic}</span>} <span className="text-[10px]">({t("dgna_attach_mode")} {selectedGroup.attachMode})</span></>
              : <span className="text-amber-400">{t("dgnac_pick_group")}</span>}
          </div>
          <div>
            <label className="text-[9px] text-muted-foreground flex items-center gap-1"><Lock className="w-3 h-3" /> {t("update_password_hint")}</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} disabled={busy} placeholder="••••••••"
              className="w-full max-w-[240px] bg-background border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-indigo-400 disabled:opacity-50" data-testid="input-dgnac-password" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => runBulk("assign")} disabled={!canRun || !hasTargets}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold rounded text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40" data-testid="button-dgnac-assign">
              <Hexagon className="w-3.5 h-3.5" /> {busy ? t("dgna_sending") : t("dgnac_assign_sel")}
            </button>
            <button onClick={() => runBulk("assign-all")} disabled={!canRun}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold rounded bg-white/10 hover:bg-white/20 text-foreground disabled:opacity-40" data-testid="button-dgnac-assign-all">
              {t("dgnac_assign_all")}
            </button>
            <button onClick={() => runBulk("update")} disabled={!canRun || !hasTargets}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold rounded bg-white/10 hover:bg-white/20 text-foreground disabled:opacity-40" data-testid="button-dgnac-update">
              {t("dgnac_update_sel")}
            </button>
            <button onClick={() => runBulk("deassign")} disabled={!canRun || !hasTargets}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold rounded text-white bg-rose-600 hover:bg-rose-500 disabled:opacity-40" data-testid="button-dgnac-deassign">
              {t("dgnac_deassign_sel")}
            </button>
          </div>
          {!fsDashboardActive && <div className="flex items-center gap-1.5 text-[11px] text-amber-400"><AlertTriangle className="w-3.5 h-3.5" /> {t("dgna_only_flow")}</div>}
          {status && (
            <div className={`flex items-center gap-2 text-xs font-bold ${status.ok ? "text-emerald-400" : "text-amber-400"}`} data-testid="text-dgnac-status">
              {status.ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />} {status.text}
            </div>
          )}
        </section>
      </div>

      {/* Target Radios */}
      <section className="bg-card border border-border rounded-lg p-3 flex flex-col gap-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 text-xs font-bold text-foreground">
            <Users className="w-4 h-4 text-indigo-400" /> {t("dgnac_targets")} <span className="text-muted-foreground font-normal">({selectedIssis.size}/{localRadios.length})</span>
          </div>
          <div className="flex gap-1">
            {(["all", "none", "attached", "dynamic"] as const).map(mode => (
              <button key={mode} onClick={() => selectBy(mode)} disabled={(mode === "attached" || mode === "dynamic") && !selectedGroup}
                className="text-[10px] px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-muted-foreground border border-white/10 disabled:opacity-40" data-testid={`button-dgnac-${mode}`}>
                {t(`dgnac_${mode}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-[auto_1fr_1.2fr_1.5fr] gap-x-3 text-[9px] font-bold text-muted-foreground uppercase tracking-wider px-2">
          <span></span><span>{t("dgnac_issi_callsign")}</span><span>{t("dgnac_group_state")}</span><span>{t("dgnac_last_result")}</span>
        </div>
        <div className="flex flex-col gap-1 max-h-[320px] overflow-auto">
          {localRadios.length === 0 && <div className="text-[11px] text-muted-foreground/60 py-2">{t("dgnac_no_radios")}</div>}
          {localRadios.map(r => {
            const checked = selectedIssis.has(r.id);
            const st = selectedGroup ? targetState(r, selectedGroup.gssi) : null;
            const last = lastByIssi.get(Number(r.id));
            const pres = last ? statusPresentation(last) : null;
            return (
              <label key={r.id} className={`grid grid-cols-[auto_1fr_1.2fr_1.5fr] gap-x-3 items-center px-2 py-1.5 rounded border cursor-pointer transition-colors ${checked ? "bg-indigo-500/15 border-indigo-400/60" : "bg-white/5 border-white/10 hover:bg-white/10"}`} data-testid={`row-dgnac-radio-${r.id}`}>
                <input type="checkbox" checked={checked} onChange={() => toggleIssi(r.id)} className="accent-indigo-500" />
                <span className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-xs text-foreground">{r.id}</span>
                  {r.callsign && <span className="text-[11px] text-sky-300 truncate">{r.callsign}</span>}
                </span>
                <span className="text-[10px]">
                  {!selectedGroup
                    ? <span className="text-muted-foreground/60">{t("dgnac_choose_group")}</span>
                    : st
                      ? <span className="inline-flex items-center gap-1">
                          <span className={`px-1 rounded border ${st.is_dynamic ? "bg-sky-500/20 text-sky-300 border-sky-500/30" : "bg-white/10 text-muted-foreground border-white/10"}`}>{st.is_dynamic ? t("dgnac_dynamic_b") : t("dgnac_static")}</span>
                          <span className={`px-1 rounded border ${st.is_attached ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" : "bg-white/10 text-muted-foreground border-white/10"}`}>{st.is_attached ? t("dgnac_attached_b") : t("dgnac_detached")}</span>
                          {st.mnemonic && <span className="text-muted-foreground">{st.mnemonic}</span>}
                        </span>
                      : <span className="text-muted-foreground/60">{t("dgnac_not_present")}</span>}
                </span>
                <span className="text-[10px] truncate">
                  {pres && last
                    ? <span className={pres.kind === "ok" ? "text-emerald-400" : pres.kind === "fail" ? "text-rose-400" : "text-amber-400"}>{last.detail || pres.label}</span>
                    : <span className="text-muted-foreground/40">-</span>}
                </span>
              </label>
            );
          })}
        </div>
      </section>

      {/* Activity log (server-persisted) */}
      <section className="bg-card border border-border rounded-lg p-3 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-bold text-foreground">{t("dgnac_activity")} <span className="text-muted-foreground font-normal">({dgnaLog.length})</span></div>
          <button onClick={clearLog} disabled={!dgnaLog.length} className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-muted-foreground border border-white/10 disabled:opacity-40" data-testid="button-dgnac-clear-log">
            <X className="w-3 h-3" /> {t("dgnac_clear")}
          </button>
        </div>
        <div className="flex flex-col gap-0.5 max-h-[240px] overflow-auto font-mono text-[11px]">
          {dgnaLog.length === 0 && <div className="text-muted-foreground/60 py-2">{t("dgnac_no_activity")}</div>}
          {dgnaLog.map((e, i) => {
            const pres = statusPresentation(e);
            return (
              <div key={i} className="flex items-center gap-2 px-1 py-0.5 border-b border-white/5" data-testid={`row-dgnac-log-${i}`}>
                <span className={`w-14 shrink-0 font-bold ${pres.kind === "ok" ? "text-emerald-400" : pres.kind === "fail" ? "text-rose-400" : "text-amber-400"}`}>{pres.label}</span>
                <span className="text-muted-foreground">{e.ts}</span>
                <span className={e.attach ? "text-indigo-300" : "text-rose-300"}>{e.attach ? t("dgna_assign") : t("dgna_deassign")}</span>
                <span className="text-sky-300">{e.gssi}</span>
                <span className="text-muted-foreground">→</span>
                <span className="text-foreground">{e.issi}</span>
                <span className="text-muted-foreground truncate ml-auto">{e.detail}</span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
