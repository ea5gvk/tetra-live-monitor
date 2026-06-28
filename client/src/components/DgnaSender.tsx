import { useState } from "react";
import { Hexagon, X, Lock, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";

// DGNA (Dynamic Group Number Assignment) button + modal, shown per local terminal.
// Mirrors flowstation's own DGNA action: assign/deassign a GSSI to a connected radio.
// Sends POST /api/dgna which forwards {type:'dgna', issi, gssi, attach} to flowstation.
export function DgnaSender({ issi, groups, enabled }: {
  issi: string | number;
  groups: (string | number)[];
  enabled: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [gssi, setGssi] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");

  function openModal() {
    setGssi("");
    setPassword("");
    setErr("");
    setDone("");
    setBusy(false);
    setOpen(true);
  }

  async function send(attach: boolean) {
    if (!gssi || !password) return;
    setBusy(true);
    setErr("");
    setDone("");
    try {
      const r = await fetch("/api/dgna", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, issi: parseInt(String(issi), 10), gssi: parseInt(gssi, 10), attach }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setErr(j.message || t("dgna_error"));
        setBusy(false);
        return;
      }
      setDone(j.message || t("dgna_success"));
      setBusy(false);
    } catch (e: any) {
      setErr(e?.message || t("dgna_error"));
      setBusy(false);
    }
  }

  const sortedGroups = groups.slice().sort((a, b) => Number(a) - Number(b));

  return (
    <>
      <button
        onClick={enabled ? openModal : undefined}
        disabled={!enabled}
        title={enabled ? t("dgna_title") : t("dgna_only_flow")}
        data-testid={`button-dgna-${issi}`}
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold rounded border transition-all ${
          enabled
            ? "bg-indigo-500/15 text-indigo-300 border-indigo-500/40 hover:bg-indigo-500/25 hover:border-indigo-400"
            : "bg-white/5 text-muted-foreground/40 border-white/10 cursor-not-allowed"
        }`}
      >
        <Hexagon className="w-3 h-3" />
        <span className="hidden lg:inline">DGNA</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-card border border-border rounded-lg w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="text-sm font-bold text-foreground flex items-center gap-2">
                <Hexagon className="w-4 h-4 text-indigo-400" />
                {t("dgna_modal_title")}
              </span>
              <button
                onClick={() => !busy && setOpen(false)}
                disabled={busy}
                className="text-muted-foreground hover:text-foreground disabled:opacity-40"
                data-testid="button-dgna-close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3">
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground">{t("dgna_issi")}</label>
                <input
                  type="number"
                  value={String(issi)}
                  readOnly
                  className="w-full bg-background border border-border rounded px-3 py-1.5 text-xs font-mono text-foreground/80 focus:outline-none"
                  data-testid="input-dgna-issi"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground">{t("dgna_current")}</label>
                <div className="flex flex-wrap gap-1 min-h-[22px] items-center">
                  {sortedGroups.length ? (
                    sortedGroups.map(g => (
                      <span key={String(g)} className="text-[10px] font-mono text-sky-300 bg-sky-500/15 border border-sky-500/30 rounded px-1.5 py-0.5">{g}</span>
                    ))
                  ) : (
                    <span className="text-[10px] text-muted-foreground/60">—</span>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground">{t("dgna_gssi")}</label>
                <input
                  type="number"
                  value={gssi}
                  onChange={e => setGssi(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && !busy && gssi && password && send(true)}
                  disabled={busy}
                  placeholder="100"
                  min="1"
                  className="w-full bg-background border border-border rounded px-3 py-1.5 text-xs font-mono text-foreground focus:outline-none focus:border-indigo-400 disabled:opacity-50"
                  data-testid="input-dgna-gssi"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Lock className="w-3 h-3" />
                  {t("update_password_hint")}
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  disabled={busy}
                  placeholder="••••••••"
                  className="w-full bg-background border border-border rounded px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-indigo-400 disabled:opacity-50"
                  data-testid="input-dgna-password"
                />
              </div>

              {err && (
                <div className="flex items-start gap-2 p-2.5 rounded bg-red-500/10 border border-red-500/30 text-red-400 text-xs" data-testid="text-dgna-error">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{err}</span>
                </div>
              )}

              {done && (
                <div className="flex items-center gap-2 p-2.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold" data-testid="text-dgna-success">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  {done}
                </div>
              )}
            </div>

            <div className="px-4 py-3 border-t border-border flex justify-end gap-2">
              <button
                onClick={() => !busy && setOpen(false)}
                disabled={busy}
                className="px-3 py-1.5 text-xs font-bold rounded bg-white/10 hover:bg-white/20 text-foreground disabled:opacity-40"
                data-testid="button-dgna-cancel"
              >
                {t("update_close")}
              </button>
              <button
                onClick={() => send(false)}
                disabled={busy || !gssi || !password}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded text-white bg-rose-600 hover:bg-rose-500 disabled:opacity-40 transition-colors"
                data-testid="button-dgna-deassign"
              >
                {t("dgna_deassign")}
              </button>
              <button
                onClick={() => send(true)}
                disabled={busy || !gssi || !password}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 transition-colors"
                data-testid="button-dgna-assign"
              >
                <Hexagon className="w-3 h-3" />
                {busy ? t("dgna_sending") : t("dgna_assign")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
