import { useState, useEffect, useRef, useCallback } from "react";
import { RefreshCw, X, ArrowUpCircle, CheckCircle2, AlertTriangle, Lock } from "lucide-react";
import { useI18n } from "@/lib/i18n";

interface UpdateInfo {
  demo?: boolean;
  upToDate?: boolean;
  localHash?: string;
  remoteHash?: string;
  remoteMessage?: string;
  remoteDate?: string;
  remoteAuthor?: string;
  error?: string;
}

const CHECK_INTERVAL_MS = 5 * 60 * 1000;

export function UpdateChecker() {
  const { t } = useI18n();
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [applying, setApplying] = useState(false);
  const [output, setOutput] = useState("");
  const [done, setDone] = useState(false);
  const [applyError, setApplyError] = useState("");
  const outputRef = useRef<HTMLPreElement>(null);

  const check = useCallback(async () => {
    try {
      const r = await fetch("/api/update/check");
      const data = await r.json();
      setInfo(data);
    } catch {
      setInfo(null);
    }
  }, []);

  useEffect(() => {
    check();
    const id = setInterval(check, CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [check]);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  const hasUpdate = info && !info.demo && info.upToDate === false;

  function openModal() {
    setPassword("");
    setOutput("");
    setDone(false);
    setApplyError("");
    setApplying(false);
    setModalOpen(true);
  }

  function closeModal() {
    if (applying) return;
    setModalOpen(false);
    if (done) check();
  }

  async function applyUpdate() {
    if (!password) return;
    setApplying(true);
    setOutput("");
    setDone(false);
    setApplyError("");
    try {
      const response = await fetch("/api/update/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ message: t("update_error") }));
        setApplyError(err.message === "update_demo_mode" ? t("update_demo_mode") : err.message);
        setApplying(false);
        return;
      }
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        setOutput(prev => prev + decoder.decode(value, { stream: true }));
      }
      setDone(true);
      setApplying(false);
    } catch (err) {
      setApplyError(t("update_error"));
      setApplying(false);
    }
  }

  const fmtDate = (iso: string) => {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  };

  return (
    <>
      {/* Nav button */}
      <button
        onClick={openModal}
        className="relative inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold rounded bg-white/5 text-muted-foreground border border-white/10 hover:bg-white/10 hover:text-foreground transition-colors"
        title={hasUpdate ? t("update_available") : t("update_check_title")}
        data-testid="button-update-checker"
      >
        <RefreshCw className="w-3 h-3" />
        {t("update")}
        {hasUpdate && (
          <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-amber-400 rounded-full animate-pulse border border-background" />
        )}
      </button>

      {/* Modal overlay */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-card border border-border rounded-lg w-full max-w-xl shadow-2xl flex flex-col max-h-[90vh]">

            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="text-sm font-bold text-foreground flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-primary" />
                {t("update_check_title")}
              </span>
              <button
                onClick={closeModal}
                disabled={applying}
                className="text-muted-foreground hover:text-foreground disabled:opacity-40"
                data-testid="button-update-modal-close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-4 space-y-4 overflow-y-auto flex-1">

              {/* Status */}
              {info === null ? (
                <p className="text-xs text-muted-foreground">{t("update_checking")}</p>
              ) : info.demo ? (
                <div className="flex items-center gap-2 p-3 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {t("update_demo_mode")}
                </div>
              ) : info.upToDate ? (
                <div className="flex items-center gap-2 p-3 rounded bg-green-500/10 border border-green-500/30 text-green-400 text-xs">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  {t("update_up_to_date")}
                  {info.localHash && (
                    <span className="ml-auto font-mono text-[10px] text-muted-foreground">{info.localHash}</span>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2 p-3 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs">
                  <ArrowUpCircle className="w-4 h-4 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-bold">{t("update_new_version")}</div>
                    {info.remoteMessage && (
                      <div className="text-amber-300 truncate mt-0.5">{info.remoteMessage}</div>
                    )}
                    {info.remoteDate && (
                      <div className="text-[10px] text-amber-500/70 mt-0.5">{fmtDate(info.remoteDate)} · {info.remoteAuthor}</div>
                    )}
                  </div>
                  <div className="flex flex-col items-end text-[10px] font-mono shrink-0 gap-0.5">
                    <span className="text-muted-foreground">local: {info.localHash}</span>
                    <span className="text-amber-400">remote: {info.remoteHash}</span>
                  </div>
                </div>
              )}

              {/* Apply section */}
              {!info?.demo && !done && (
                <div className="space-y-2">
                  <label className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Lock className="w-3 h-3" />
                    {t("update_password_hint")}
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && !applying && password && applyUpdate()}
                      disabled={applying}
                      placeholder="••••••••"
                      className="flex-1 bg-background border border-border rounded px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary disabled:opacity-50"
                      data-testid="input-update-password"
                    />
                    <button
                      onClick={applyUpdate}
                      disabled={applying || !password}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded bg-amber-500 hover:bg-amber-400 text-black disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      data-testid="button-update-apply"
                    >
                      <RefreshCw className={`w-3 h-3 ${applying ? "animate-spin" : ""}`} />
                      {applying ? t("update_applying") : t("update_apply")}
                    </button>
                  </div>
                  {applyError && (
                    <p className="text-xs text-red-400">{applyError}</p>
                  )}
                </div>
              )}

              {/* Success banner */}
              {done && (
                <div className="flex items-center gap-2 p-3 rounded bg-green-500/10 border border-green-500/30 text-green-400 text-xs font-bold">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  {t("update_success")}
                </div>
              )}

              {/* Streaming output */}
              {output && (
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                    {t("update_output_log")}
                  </p>
                  <pre
                    ref={outputRef}
                    className="bg-black/60 border border-border rounded p-3 text-[10px] font-mono text-green-400 overflow-auto max-h-52 whitespace-pre-wrap break-all leading-relaxed"
                    data-testid="text-update-output"
                  >
                    {output}
                  </pre>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-4 py-3 border-t border-border flex justify-between items-center">
              <button
                onClick={check}
                disabled={applying}
                className="text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-40 flex items-center gap-1"
                data-testid="button-update-recheck"
              >
                <RefreshCw className="w-3 h-3" />
                {t("update_checking")}
              </button>
              <button
                onClick={closeModal}
                disabled={applying}
                className="px-3 py-1.5 text-xs font-bold rounded bg-white/10 hover:bg-white/20 text-foreground disabled:opacity-40 transition-colors"
                data-testid="button-update-close"
              >
                {t("update_close")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
