import { useState, useEffect, useRef, useCallback } from "react";
import { Cpu, X, ArrowUpCircle, CheckCircle2, AlertTriangle, Lock, FolderOpen, Settings } from "lucide-react";
import { useI18n } from "@/lib/i18n";

interface UpdateInfo {
  demo?: boolean;
  dirNotFound?: boolean;
  upToDate?: boolean;
  localHash?: string;
  remoteHash?: string;
  remoteMessage?: string;
  remoteDate?: string;
  remoteAuthor?: string;
  error?: string;
}

const DIR_KEY = "tetra_bluestation_dir";
const SERVICE_KEY = "tetra_restart_service";
const DEFAULT_DIR = "/root/tetra-bluestation";
const DEFAULT_SERVICE = "tmo.service";
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

function getStoredDir(): string {
  try { return localStorage.getItem(DIR_KEY) || DEFAULT_DIR; } catch { return DEFAULT_DIR; }
}
function getStoredService(): string {
  try { return localStorage.getItem(SERVICE_KEY) || DEFAULT_SERVICE; } catch { return DEFAULT_SERVICE; }
}

export function BluestationUpdater() {
  const { t } = useI18n();
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [applying, setApplying] = useState(false);
  const [output, setOutput] = useState("");
  const [done, setDone] = useState(false);
  const [applyError, setApplyError] = useState("");

  const [dir, setDir] = useState<string>(getStoredDir);
  const [editingDir, setEditingDir] = useState(false);
  const [dirDraft, setDirDraft] = useState("");
  const serviceName = getStoredService();

  const outputRef = useRef<HTMLPreElement>(null);

  const check = useCallback(async () => {
    try {
      const r = await fetch(`/api/bluestation/check?dir=${encodeURIComponent(dir)}`);
      const data = await r.json();
      setInfo(data);
    } catch {
      setInfo(null);
    }
  }, [dir]);

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

  const hasUpdate = info && !info.demo && !info.dirNotFound && info.upToDate === false;

  function openModal() {
    setPassword("");
    setOutput("");
    setDone(false);
    setApplyError("");
    setApplying(false);
    setEditingDir(false);
    setDirDraft(dir);
    setModalOpen(true);
  }

  function closeModal() {
    if (applying) return;
    setModalOpen(false);
    if (done) check();
  }

  function saveDir() {
    const newDir = dirDraft.trim() || DEFAULT_DIR;
    setDir(newDir);
    try { localStorage.setItem(DIR_KEY, newDir); } catch {}
    setEditingDir(false);
  }

  async function applyUpdate() {
    if (!password) return;
    setApplying(true);
    setOutput("");
    setDone(false);
    setApplyError("");
    try {
      const response = await fetch("/api/bluestation/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, dir, serviceName }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ message: t("update_error") }));
        const msgKey = err.message as string;
        setApplyError(msgKey === "bluestation_dir_not_found" ? t("bluestation_dir_not_found") : msgKey || t("update_error"));
        setApplying(false);
        return;
      }
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      try {
        while (true) {
          const { value, done: streamDone } = await reader.read();
          if (streamDone) break;
          const chunk = decoder.decode(value, { stream: true });
          accumulated += chunk;
          setOutput(prev => prev + chunk);
        }
      } catch {
        // systemctl restart kills the server mid-stream — treat as success if output was received
        if (accumulated.length > 50) {
          setDone(true);
          setApplying(false);
          return;
        }
        throw new Error("stream_error");
      }
      setDone(true);
      setApplying(false);
    } catch {
      setApplyError(t("update_error"));
      setApplying(false);
    }
  }

  const fmtDate = (iso: string) => {
    if (!iso) return "";
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  };

  return (
    <>
      {/* Nav button */}
      <button
        onClick={openModal}
        className="relative inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold rounded bg-white/5 text-muted-foreground border border-white/10 hover:bg-white/10 hover:text-foreground transition-colors"
        title={hasUpdate ? `${t("update_available")} — Bluestation` : t("bluestation_check_title")}
        data-testid="button-bluestation-updater"
      >
        <Cpu className="w-3 h-3" />
        {t("bluestation_update")}
        {hasUpdate && (
          <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-violet-400 rounded-full animate-pulse border border-background" />
        )}
      </button>

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-card border border-border rounded-lg w-full max-w-xl shadow-2xl flex flex-col max-h-[90vh]">

            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="text-sm font-bold text-foreground flex items-center gap-2">
                <Cpu className="w-4 h-4 text-violet-400" />
                {t("bluestation_check_title")}
                <span className="text-[10px] font-normal text-muted-foreground">tetra-bluestation</span>
              </span>
              <button
                onClick={closeModal}
                disabled={applying}
                className="text-muted-foreground hover:text-foreground disabled:opacity-40"
                data-testid="button-bluestation-modal-close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-4 space-y-4 overflow-y-auto flex-1">

              {/* Directory config */}
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <FolderOpen className="w-3 h-3" />
                  {t("bluestation_dir")}
                </label>
                {editingDir ? (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={dirDraft}
                      onChange={e => setDirDraft(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") saveDir(); if (e.key === "Escape") setEditingDir(false); }}
                      className="flex-1 bg-background border border-primary rounded px-3 py-1.5 text-xs font-mono text-foreground focus:outline-none"
                      autoFocus
                      data-testid="input-bluestation-dir"
                    />
                    <button
                      onClick={saveDir}
                      className="px-3 py-1.5 text-xs font-bold rounded bg-primary/20 hover:bg-primary/30 text-primary transition-colors"
                    >
                      OK
                    </button>
                    <button
                      onClick={() => setEditingDir(false)}
                      className="px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-[11px] font-mono text-primary bg-primary/10 border border-primary/20 rounded px-2 py-1">
                      {dir}
                    </code>
                    <button
                      onClick={() => { setDirDraft(dir); setEditingDir(true); }}
                      disabled={applying}
                      className="text-muted-foreground hover:text-foreground disabled:opacity-40"
                      title="Edit directory"
                      data-testid="button-bluestation-edit-dir"
                    >
                      <Settings className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {/* Service name info */}
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <span className="font-medium">{t("bluestation_service")}:</span>
                <code className="font-mono text-amber-400">{serviceName}</code>
                <span className="text-muted-foreground/50">(de Calculadora → Reiniciar Servicio)</span>
              </div>

              {/* Status */}
              {info === null ? (
                <p className="text-xs text-muted-foreground">{t("update_checking")}</p>
              ) : info.dirNotFound ? (
                <div className="flex items-center gap-2 p-3 rounded bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <div>
                    <div className="font-bold">{t("bluestation_dir_not_found")}</div>
                    <div className="text-red-400/70 mt-0.5">{dir}</div>
                  </div>
                </div>
              ) : info.demo ? (
                <div className="flex items-center gap-2 p-3 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {t("bluestation_demo_mode")}
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
                <div className="flex items-center gap-2 p-3 rounded bg-violet-500/10 border border-violet-500/30 text-violet-400 text-xs">
                  <ArrowUpCircle className="w-4 h-4 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-bold">{t("update_new_version")}</div>
                    {info.remoteMessage && (
                      <div className="text-violet-300 truncate mt-0.5">{info.remoteMessage}</div>
                    )}
                    {info.remoteDate && (
                      <div className="text-[10px] text-violet-500/70 mt-0.5">{fmtDate(info.remoteDate)} · {info.remoteAuthor}</div>
                    )}
                  </div>
                  <div className="flex flex-col items-end text-[10px] font-mono shrink-0 gap-0.5">
                    <span className="text-muted-foreground">local: {info.localHash}</span>
                    <span className="text-violet-400">remote: {info.remoteHash}</span>
                  </div>
                </div>
              )}

              {/* Commands preview */}
              {!info?.demo && !info?.dirNotFound && !done && (
                <div className="bg-black/40 border border-border rounded p-2 text-[10px] font-mono text-muted-foreground space-y-0.5">
                  <div className="text-green-400">$ cd {dir}</div>
                  <div className="text-green-400">$ git pull</div>
                  <div className="text-green-400">$ cargo build --release</div>
                  {serviceName && <div className="text-amber-400">$ sudo systemctl restart {serviceName}</div>}
                </div>
              )}

              {/* Apply section */}
              {!info?.demo && !info?.dirNotFound && !done && (
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
                      data-testid="input-bluestation-password"
                    />
                    <button
                      onClick={applyUpdate}
                      disabled={applying || !password}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      data-testid="button-bluestation-apply"
                    >
                      <Cpu className={`w-3 h-3 ${applying ? "animate-spin" : ""}`} />
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
                    className="bg-black/60 border border-border rounded p-3 text-[10px] font-mono text-violet-300 overflow-auto max-h-52 whitespace-pre-wrap break-all leading-relaxed"
                    data-testid="text-bluestation-output"
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
                data-testid="button-bluestation-recheck"
              >
                <Cpu className="w-3 h-3" />
                {t("update_checking")}
              </button>
              <button
                onClick={closeModal}
                disabled={applying}
                className="px-3 py-1.5 text-xs font-bold rounded bg-white/10 hover:bg-white/20 text-foreground disabled:opacity-40 transition-colors"
                data-testid="button-bluestation-close"
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
