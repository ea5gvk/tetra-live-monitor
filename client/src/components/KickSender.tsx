import { useState, useEffect, useCallback } from "react";
import { UserX, X, Lock, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";

interface ActiveResp {
  station: "bluestation" | "flowstation";
  services: { flowstation: { active: boolean; installed: boolean } };
}

const POLL_MS = 30 * 1000;

export function KickSender() {
  const { t } = useI18n();
  const [flowActive, setFlowActive] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [issi, setIssi] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/station/active");
      const j: ActiveResp = await r.json();
      setFlowActive(!!j?.services?.flowstation?.active);
    } catch {
      setFlowActive(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  function openModal() {
    setIssi("");
    setPassword("");
    setErr("");
    setDone("");
    setBusy(false);
    setOpen(true);
  }

  async function send() {
    if (!issi || !password) return;
    setBusy(true);
    setErr("");
    setDone("");
    try {
      const r = await fetch("/api/kick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, issi: parseInt(issi, 10) }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setErr(j.message || t("kick_error"));
        setBusy(false);
        return;
      }
      setDone(j.message || t("kick_success"));
      setBusy(false);
    } catch (e: any) {
      setErr(e?.message || t("kick_error"));
      setBusy(false);
    }
  }

  const enabled = flowActive === true;

  return (
    <>
      <button
        onClick={enabled ? openModal : undefined}
        disabled={!enabled}
        title={enabled ? t("kick_title") : t("kick_only_flow")}
        data-testid="button-kick"
        className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold rounded border transition-all ${
          enabled
            ? "bg-rose-500/15 text-rose-300 border-rose-500/40 hover:bg-rose-500/25 hover:border-rose-400"
            : "bg-white/5 text-muted-foreground/40 border-white/10 cursor-not-allowed"
        }`}
      >
        <UserX className="w-3 h-3" />
        <span className="hidden lg:inline">KICK</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-card border border-border rounded-lg w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="text-sm font-bold text-foreground flex items-center gap-2">
                <UserX className="w-4 h-4 text-rose-400" />
                {t("kick_title")}
              </span>
              <button
                onClick={() => !busy && setOpen(false)}
                disabled={busy}
                className="text-muted-foreground hover:text-foreground disabled:opacity-40"
                data-testid="button-kick-close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3">
              <div className="text-[10px] text-muted-foreground bg-rose-500/5 border border-rose-500/20 rounded px-2 py-1.5">
                {t("kick_hint")}
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground">{t("kick_issi")}</label>
                <input
                  type="number"
                  value={issi}
                  onChange={e => setIssi(e.target.value)}
                  disabled={busy}
                  placeholder="2145007"
                  className="w-full bg-background border border-border rounded px-3 py-1.5 text-xs font-mono text-foreground focus:outline-none focus:border-rose-400 disabled:opacity-50"
                  data-testid="input-kick-issi"
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
                  onKeyDown={e => e.key === "Enter" && !busy && issi && password && send()}
                  disabled={busy}
                  placeholder="••••••••"
                  className="w-full bg-background border border-border rounded px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-rose-400 disabled:opacity-50"
                  data-testid="input-kick-password"
                />
              </div>

              {err && (
                <div className="flex items-start gap-2 p-2.5 rounded bg-red-500/10 border border-red-500/30 text-red-400 text-xs" data-testid="text-kick-error">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{err}</span>
                </div>
              )}

              {done && (
                <div className="flex items-center gap-2 p-2.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold" data-testid="text-kick-success">
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
                data-testid="button-kick-cancel"
              >
                {t("update_close")}
              </button>
              <button
                onClick={send}
                disabled={busy || !issi || !password}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded text-white bg-rose-600 hover:bg-rose-500 disabled:opacity-40 transition-colors"
                data-testid="button-kick-confirm"
              >
                <UserX className="w-3 h-3" />
                {busy ? t("kick_sending") : t("kick_btn")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
