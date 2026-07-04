import { useState, useMemo, useEffect } from "react";
import { Hexagon, Plus, Trash2, Check, X, Users, Lock, AlertTriangle, CheckCircle2, ListChecks } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useTetraWebSocket } from "@/hooks/useTetraWebSocket";

// DGNA Center: bulk assign/update/deassign of dynamic groups across radios, plus a
// reusable group library and a local activity log. Mirrors flowstation's DGNA page.
// Assignment goes through POST /api/dgna (forwarded to flowstation as
// {type:'dgna', issi, gssi, mnemonic, attachment_mode, attach}).

const LIB_KEY = "tetra_dgna_library";
const LOG_KEY = "tetra_dgna_log";
const LOG_MAX = 200;

type LibGroup = { gssi: number; mnemonic: string; attachMode: number };
type LogEntry = { ts: number; action: "assign" | "deassign"; issi: number; gssi: number; mnemonic: string; ok: boolean; message: string };

const ATTACH_LABELS: Record<number, string> = {
  0: "0 — Attached permanently",
  1: "1 — On next ITSI attach",
  2: "2 — Not allowed on ITSI attach",
  3: "3 — On next location update",
  4: "4 — Not attached, may request",
  5: "5 — Not attached, no request",
};

function loadJson<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    if (v) return JSON.parse(v) as T;
  } catch {}
  return fallback;
}
function saveJson(key: string, val: unknown) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

export default function DgnaCenter() {
  const { t } = useI18n();
  const { terminals, fsDashboardActive } = useTetraWebSocket();

  const [library, setLibrary] = useState<LibGroup[]>(() => loadJson<LibGroup[]>(LIB_KEY, []));
  const [log, setLog] = useState<LogEntry[]>(() => loadJson<LogEntry[]>(LOG_KEY, []));
  const [selectedGssi, setSelectedGssi] = useState<number | null>(null);
  const [selectedIssis, setSelectedIssis] = useState<Set<string>>(new Set());
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  // New-group form
  const [newGssi, setNewGssi] = useState("");
  const [newName, setNewName] = useState("");
  const [newMode, setNewMode] = useState("0");

  useEffect(() => { saveJson(LIB_KEY, library); }, [library]);
  useEffect(() => { saveJson(LOG_KEY, log); }, [log]);

  const localRadios = useMemo(
    () => Object.values(terminals).filter(tr => tr.isLocal).sort((a, b) => Number(a.id) - Number(b.id)),
    [terminals]
  );

  const selectedGroup = useMemo(
    () => library.find(g => g.gssi === selectedGssi) || null,
    [library, selectedGssi]
  );

  function addGroup() {
    const gssi = parseInt(newGssi, 10);
    if (!gssi || gssi <= 0 || gssi > 16777215) return;
    if (library.some(g => g.gssi === gssi)) return;
    const g: LibGroup = { gssi, mnemonic: newName.trim().slice(0, 15), attachMode: parseInt(newMode, 10) || 0 };
    setLibrary([...library, g].sort((a, b) => a.gssi - b.gssi));
    setNewGssi(""); setNewName(""); setNewMode("0");
    setSelectedGssi(gssi);
  }
  function removeGroup(gssi: number) {
    setLibrary(library.filter(g => g.gssi !== gssi));
    if (selectedGssi === gssi) setSelectedGssi(null);
  }

  function toggleIssi(id: string) {
    const next = new Set(selectedIssis);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIssis(next);
  }
  function selectAll() { setSelectedIssis(new Set(localRadios.map(r => r.id))); }
  function selectNone() { setSelectedIssis(new Set()); }
  function selectAttached() {
    if (!selectedGroup) return;
    setSelectedIssis(new Set(localRadios.filter(r => r.groups.map(String).includes(String(selectedGroup.gssi))).map(r => r.id)));
  }

  async function runBulk(attach: boolean) {
    if (!selectedGroup || selectedIssis.size === 0 || !password || busy) return;
    setBusy(true);
    setStatus(null);
    const targets = localRadios.filter(r => selectedIssis.has(r.id));
    const results: LogEntry[] = [];
    let okCount = 0;
    for (const r of targets) {
      let entry: LogEntry = {
        ts: Date.now(), action: attach ? "assign" : "deassign",
        issi: Number(r.id), gssi: selectedGroup.gssi, mnemonic: selectedGroup.mnemonic,
        ok: false, message: "",
      };
      try {
        const resp = await fetch("/api/dgna", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            password,
            issi: Number(r.id),
            gssi: selectedGroup.gssi,
            mnemonic: selectedGroup.mnemonic,
            attachment_mode: selectedGroup.attachMode,
            attach,
          }),
        });
        const j = await resp.json().catch(() => ({}));
        entry.ok = resp.ok && j.ok !== false;
        entry.message = j.message || (entry.ok ? "OK" : t("dgna_error"));
        if (entry.ok) okCount++;
      } catch (e: any) {
        entry.message = e?.message || t("dgna_error");
      }
      results.push(entry);
    }
    setLog(prev => [...results.reverse(), ...prev].slice(0, LOG_MAX));
    setBusy(false);
    setStatus({
      ok: okCount === targets.length,
      text: t("dgnac_result").replace("{ok}", String(okCount)).replace("{total}", String(targets.length)),
    });
  }

  function clearLog() { setLog([]); }

  const canRun = !!selectedGroup && selectedIssis.size > 0 && !!password && fsDashboardActive && !busy;

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
        <span className={`text-[10px] font-bold px-2 py-1 rounded border ${
          fsDashboardActive
            ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
            : "bg-rose-500/15 text-rose-300 border-rose-500/40"
        }`}>
          {fsDashboardActive ? t("dgnac_flow_on") : t("dgnac_flow_off")}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Group Library */}
        <section className="bg-card border border-border rounded-lg p-3 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs font-bold text-foreground">
            <ListChecks className="w-4 h-4 text-indigo-400" />
            {t("dgnac_library")}
          </div>

          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex-1 min-w-[90px]">
              <label className="text-[9px] text-muted-foreground">{t("dgna_gssi")}</label>
              <input type="number" min="1" value={newGssi} onChange={e => setNewGssi(e.target.value)}
                placeholder="100" className="w-full bg-background border border-border rounded px-2 py-1 text-xs font-mono text-foreground focus:outline-none focus:border-indigo-400"
                data-testid="input-dgnac-new-gssi" />
            </div>
            <div className="flex-1 min-w-[90px]">
              <label className="text-[9px] text-muted-foreground">{t("dgna_mnemonic")}</label>
              <input type="text" maxLength={15} value={newName} onChange={e => setNewName(e.target.value)}
                placeholder="ALFA" className="w-full bg-background border border-border rounded px-2 py-1 text-xs font-mono text-foreground focus:outline-none focus:border-indigo-400"
                data-testid="input-dgnac-new-name" />
            </div>
            <div className="flex-1 min-w-[120px]">
              <label className="text-[9px] text-muted-foreground">{t("dgna_attach_mode")}</label>
              <select value={newMode} onChange={e => setNewMode(e.target.value)}
                className="w-full bg-background border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-indigo-400"
                data-testid="select-dgnac-new-mode">
                {[0, 1, 2, 3, 4, 5].map(m => <option key={m} value={m}>{ATTACH_LABELS[m]}</option>)}
              </select>
            </div>
            <button onClick={addGroup} disabled={!newGssi}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold rounded bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40"
              data-testid="button-dgnac-add-group">
              <Plus className="w-3.5 h-3.5" /> {t("dgnac_add")}
            </button>
          </div>

          <div className="flex flex-col gap-1 mt-1 max-h-[280px] overflow-auto">
            {library.length === 0 && <div className="text-[11px] text-muted-foreground/60 py-2">{t("dgnac_no_groups")}</div>}
            {library.map(g => {
              const active = g.gssi === selectedGssi;
              return (
                <div key={g.gssi}
                  onClick={() => setSelectedGssi(g.gssi)}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded border cursor-pointer transition-colors ${
                    active ? "bg-indigo-500/20 border-indigo-400" : "bg-white/5 border-white/10 hover:bg-white/10"
                  }`}
                  data-testid={`row-dgnac-group-${g.gssi}`}>
                  {active ? <Check className="w-3.5 h-3.5 text-indigo-300 shrink-0" /> : <Hexagon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                  <span className="font-mono text-xs text-sky-300 font-bold">{g.gssi}</span>
                  {g.mnemonic && <span className="text-xs text-foreground">{g.mnemonic}</span>}
                  <span className="text-[9px] text-muted-foreground ml-auto">{t("dgna_attach_mode")}: {g.attachMode}</span>
                  <button onClick={e => { e.stopPropagation(); removeGroup(g.gssi); }}
                    className="text-muted-foreground hover:text-rose-400" data-testid={`button-dgnac-del-group-${g.gssi}`}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        {/* Target Radios */}
        <section className="bg-card border border-border rounded-lg p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold text-foreground">
              <Users className="w-4 h-4 text-indigo-400" />
              {t("dgnac_targets")} <span className="text-muted-foreground font-normal">({selectedIssis.size}/{localRadios.length})</span>
            </div>
            <div className="flex gap-1">
              <button onClick={selectAll} className="text-[10px] px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-muted-foreground border border-white/10" data-testid="button-dgnac-all">{t("dgnac_all")}</button>
              <button onClick={selectNone} className="text-[10px] px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-muted-foreground border border-white/10" data-testid="button-dgnac-none">{t("dgnac_none")}</button>
              <button onClick={selectAttached} disabled={!selectedGroup} className="text-[10px] px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-muted-foreground border border-white/10 disabled:opacity-40" data-testid="button-dgnac-attached">{t("dgnac_attached")}</button>
            </div>
          </div>

          <div className="flex flex-col gap-1 max-h-[280px] overflow-auto">
            {localRadios.length === 0 && <div className="text-[11px] text-muted-foreground/60 py-2">{t("dgnac_no_radios")}</div>}
            {localRadios.map(r => {
              const checked = selectedIssis.has(r.id);
              const hasGroup = selectedGroup && r.groups.map(String).includes(String(selectedGroup.gssi));
              return (
                <label key={r.id}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded border cursor-pointer transition-colors ${
                    checked ? "bg-indigo-500/15 border-indigo-400/60" : "bg-white/5 border-white/10 hover:bg-white/10"
                  }`}
                  data-testid={`row-dgnac-radio-${r.id}`}>
                  <input type="checkbox" checked={checked} onChange={() => toggleIssi(r.id)} className="accent-indigo-500" />
                  <span className="font-mono text-xs text-foreground">{r.id}</span>
                  {r.callsign && <span className="text-[11px] text-sky-300">{r.callsign}</span>}
                  {hasGroup && <span className="text-[9px] px-1 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">{t("dgnac_has_group")}</span>}
                  <span className={`text-[9px] ml-auto ${r.status === "Online" ? "text-emerald-400" : "text-muted-foreground"}`}>{r.status}</span>
                </label>
              );
            })}
          </div>
        </section>
      </div>

      {/* Bulk action bar */}
      <section className="bg-card border border-border rounded-lg p-3 flex flex-col gap-2">
        <div className="flex flex-wrap items-end gap-3">
          <div className="text-xs text-muted-foreground">
            {selectedGroup
              ? <>{t("dgnac_selected_group")}: <span className="font-mono text-sky-300 font-bold">{selectedGroup.gssi}</span>{selectedGroup.mnemonic && <span className="text-foreground"> {selectedGroup.mnemonic}</span>} <span className="text-[10px]">({t("dgna_attach_mode")} {selectedGroup.attachMode})</span></>
              : <span className="text-amber-400">{t("dgnac_pick_group")}</span>}
          </div>
          <div className="flex-1 min-w-[160px] max-w-[240px]">
            <label className="text-[9px] text-muted-foreground flex items-center gap-1"><Lock className="w-3 h-3" /> {t("update_password_hint")}</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} disabled={busy}
              placeholder="••••••••" className="w-full bg-background border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:border-indigo-400 disabled:opacity-50"
              data-testid="input-dgnac-password" />
          </div>
          <div className="flex gap-2">
            <button onClick={() => runBulk(false)} disabled={!canRun}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded text-white bg-rose-600 hover:bg-rose-500 disabled:opacity-40"
              data-testid="button-dgnac-deassign">
              {t("dgna_deassign")}
            </button>
            <button onClick={() => runBulk(true)} disabled={!canRun}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40"
              data-testid="button-dgnac-assign">
              <Hexagon className="w-3.5 h-3.5" /> {busy ? t("dgna_sending") : t("dgnac_assign_sel")}
            </button>
          </div>
        </div>
        {!fsDashboardActive && <div className="flex items-center gap-1.5 text-[11px] text-amber-400"><AlertTriangle className="w-3.5 h-3.5" /> {t("dgna_only_flow")}</div>}
        {status && (
          <div className={`flex items-center gap-2 text-xs font-bold ${status.ok ? "text-emerald-400" : "text-amber-400"}`} data-testid="text-dgnac-status">
            {status.ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
            {status.text}
          </div>
        )}
      </section>

      {/* Activity log */}
      <section className="bg-card border border-border rounded-lg p-3 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-bold text-foreground">{t("dgnac_activity")} <span className="text-muted-foreground font-normal">({log.length})</span></div>
          <button onClick={clearLog} disabled={!log.length} className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-muted-foreground border border-white/10 disabled:opacity-40" data-testid="button-dgnac-clear-log">
            <X className="w-3 h-3" /> {t("dgnac_clear")}
          </button>
        </div>
        <div className="flex flex-col gap-0.5 max-h-[240px] overflow-auto font-mono text-[11px]">
          {log.length === 0 && <div className="text-muted-foreground/60 py-2">{t("dgnac_no_activity")}</div>}
          {log.map((e, i) => (
            <div key={i} className="flex items-center gap-2 px-1 py-0.5 border-b border-white/5" data-testid={`row-dgnac-log-${i}`}>
              {e.ok ? <Check className="w-3 h-3 text-emerald-400 shrink-0" /> : <X className="w-3 h-3 text-rose-400 shrink-0" />}
              <span className="text-muted-foreground">{new Date(e.ts).toLocaleTimeString()}</span>
              <span className={e.action === "assign" ? "text-indigo-300" : "text-rose-300"}>{e.action === "assign" ? t("dgna_assign") : t("dgna_deassign")}</span>
              <span className="text-sky-300">{e.gssi}{e.mnemonic ? ` ${e.mnemonic}` : ""}</span>
              <span className="text-muted-foreground">→</span>
              <span className="text-foreground">{e.issi}</span>
              <span className="text-muted-foreground truncate ml-auto">{e.message}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
