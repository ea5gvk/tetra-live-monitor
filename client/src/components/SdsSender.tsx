import { useState, useEffect, useCallback } from "react";
import { MessageSquare, X, Lock, AlertTriangle, CheckCircle2, Send } from "lucide-react";
import { useI18n } from "@/lib/i18n";

interface ActiveResp {
  station: "bluestation" | "flowstation";
  services: { flowstation: { active: boolean; installed: boolean } };
}

const POLL_MS = 30 * 1000;
const SOURCE_SSI = 9999;

export function SdsSender() {
  const { t } = useI18n();
  const [flowActive, setFlowActive] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [dest, setDest] = useState("");
  const [msg, setMsg] = useState("");
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
    setDest("");
    setMsg("");
    setPassword("");
    setErr("");
    setDone("");
    setBusy(false);
    setOpen(true);
  }

  async function send() {
    if (!dest || !msg.trim() || !password) return;
    setBusy(true);
    setErr("");
    setDone("");
    try {
      const r = await fetch("/api/sds/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, dest_issi: parseInt(dest, 10), message: msg.trim() }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setErr(j.message || t("sds_send_error"));
        setBusy(false);
        return;
      }
      setDone(j.message || t("sds_send_success"));
      setBusy(false);
      setMsg("");
    } catch (e: any) {
      setErr(e?.message || t("sds_send_error"));
      setBusy(false);
    }
  }

  const enabled = flowActive === true;
  const remaining = 160 - msg.length;

  return (
    <>
      <button
        onClick={enabled ? openModal : undefined}
        disabled={!enabled}
        title={enabled ? t("sds_send_title") : t("sds_send_only_flow")}
        data-testid="button-sds-send"
        className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold rounded border transition-all ${
          enabled
            ? "bg-violet-500/15 text-violet-300 border-violet-500/40 hover:bg-violet-500/25 hover:border-violet-400"
            : "bg-white/5 text-muted-foreground/40 border-white/10 cursor-not-allowed"
        }`}
      >
        <Send className="w-3 h-3" />
        <span className="hidden lg:inline">SDS</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-card border border-border rounded-lg w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="text-sm font-bold text-foreground flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-violet-400" />
                {t("sds_send_title")}
              </span>
              <button
                onClick={() => !busy && setOpen(false)}
                disabled={busy}
                className="text-muted-foreground hover:text-foreground disabled:opacity-40"
                data-testid="button-sds-close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3">
              <div className="text-[10px] text-muted-foreground bg-violet-500/5 border border-violet-500/20 rounded px-2 py-1.5 font-mono">
                {t("sds_send_source_note").replace("{ssi}", String(SOURCE_SSI))}
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground">{t("sds_send_dest")}</label>
                <input
                  type="number"
                  value={dest}
                  onChange={e => setDest(e.target.value)}
                  disabled={busy}
                  placeholder="2260571"
                  className="w-full bg-background border border-border rounded px-3 py-1.5 text-xs font-mono text-foreground focus:outline-none focus:border-violet-400 disabled:opacity-50"
                  data-testid="input-sds-dest"
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] text-muted-foreground">{t("sds_send_msg")}</label>
                  <span className={`text-[10px] font-mono ${remaining < 20 ? "text-amber-400" : "text-muted-foreground/60"}`}>
                    {remaining}
                  </span>
                </div>
                <textarea
                  value={msg}
                  onChange={e => setMsg(e.target.value.slice(0, 160))}
                  disabled={busy}
                  rows={3}
                  maxLength={160}
                  placeholder="..."
                  className="w-full bg-background border border-border rounded px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-violet-400 disabled:opacity-50 resize-none"
                  data-testid="input-sds-message"
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
                  onKeyDown={e => e.key === "Enter" && !busy && dest && msg.trim() && password && send()}
                  disabled={busy}
                  placeholder="••••••••"
                  className="w-full bg-background border border-border rounded px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-violet-400 disabled:opacity-50"
                  data-testid="input-sds-password"
                />
              </div>

              {err && (
                <div className="flex items-start gap-2 p-2.5 rounded bg-red-500/10 border border-red-500/30 text-red-400 text-xs" data-testid="text-sds-error">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{err}</span>
                </div>
              )}

              {done && (
                <div className="flex items-center gap-2 p-2.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold" data-testid="text-sds-success">
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
                data-testid="button-sds-cancel"
              >
                {t("update_close")}
              </button>
              <button
                onClick={send}
                disabled={busy || !dest || !msg.trim() || !password}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded text-white bg-violet-600 hover:bg-violet-500 disabled:opacity-40 transition-colors"
                data-testid="button-sds-confirm"
              >
                <Send className="w-3 h-3" />
                {busy ? t("sds_send_sending") : t("sds_send_btn")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
