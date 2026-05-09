import { useState, useEffect, useRef, useCallback } from "react";
import { Waves, X, ArrowUpCircle, CheckCircle2, AlertTriangle, Lock, Download } from "lucide-react";
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
  apiError?: string;
}

const DIR = "/root/flowstation";
const SERVICE = "flowstation.service";
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

export function FlowstationUpdater() {
  const { t } = useI18n();
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState("");
  const [done, setDone] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [mode, setMode] = useState<"update" | "install">("update");
  const outputRef = useRef<HTMLPreElement>(null);

  const check = useCallback(async () => {
    try {
      const r = await fetch(`/api/flowstation/check?dir=${encodeURIComponent(DIR)}`);
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
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [output]);

  const hasUpdate = info && !info.demo && !info.dirNotFound && info.upToDate === false;
  const notInstalled = info?.dirNotFound === true;

  function openModal() {
    setPassword(""); setOutput(""); setDone(false); setErrMsg(""); setBusy(false);
    setMode(notInstalled ? "install" : "update");
    setModalOpen(true);
  }
  function closeModal() {
    if (busy) return;
    setModalOpen(false);
    if (done) check();
  }

  async function runStream(url: string) {
    if (!password) return;
    setBusy(true); setOutput(""); setDone(false); setErrMsg("");
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, dir: DIR, serviceName: SERVICE }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ message: t("update_error") }));
        setErrMsg(err.message || t("update_error"));
        setBusy(false);
        return;
      }
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      try {
        while (true) {
          const { value, done: streamDone } = await reader.read();
          if (streamDone) break;
          const chunk = decoder.decode(value, { stream: true });
          acc += chunk;
          setOutput(prev => prev + chunk);
        }
      } catch {
        if (acc.length > 50) { setDone(true); setBusy(false); return; }
        throw new Error("stream_error");
      }
      setDone(true); setBusy(false);
    } catch {
      setErrMsg(t("update_error")); setBusy(false);
    }
  }

  const fmtDate = (iso: string) => {
    if (!iso) return "";
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  };

  return (
    <>
      <button
        onClick={openModal}
        className="relative inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold rounded bg-white/5 text-muted-foreground border border-white/10 hover:bg-white/10 hover:text-foreground transition-colors"
        title={notInstalled ? t("flowstation_install") : (hasUpdate ? `${t("update_available")} — Flowstation` : t("flowstation_check_title"))}
        data-testid="button-flowstation-updater"
      >
        <Waves className="w-3 h-3" />
        {notInstalled ? t("flowstation_install_short") : t("flowstation_update")}
        {hasUpdate && (
          <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-400 rounded-full animate-pulse border border-background" />
        )}
        {notInstalled && (
          <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-orange-400 rounded-full border border-background" />
        )}
      </button>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-card border border-border rounded-lg w-full max-w-xl shadow-2xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="text-sm font-bold text-foreground flex items-center gap-2">
                <Waves className="w-4 h-4 text-emerald-400" />
                {mode === "install" ? t("flowstation_install_title") : t("flowstation_check_title")}
                <span className="text-[10px] font-normal text-muted-foreground">razvanzeces/flowstation</span>
              </span>
              <button
                onClick={closeModal}
                disabled={busy}
                className="text-muted-foreground hover:text-foreground disabled:opacity-40"
                data-testid="button-flowstation-modal-close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-4 overflow-y-auto flex-1">
              <div className="text-[10px] text-muted-foreground space-y-0.5">
                <div><span className="font-medium">Dir:</span> <code className="text-emerald-400 font-mono">{DIR}</code></div>
                <div><span className="font-medium">Service:</span> <code className="text-amber-400 font-mono">{SERVICE}</code></div>
              </div>

              {info === null ? (
                <p className="text-xs text-muted-foreground">{t("update_checking")}</p>
              ) : info.dirNotFound ? (
                <div className="flex items-center gap-2 p-3 rounded bg-orange-500/10 border border-orange-500/30 text-orange-400 text-xs">
                  <Download className="w-4 h-4 shrink-0" />
                  <div className="flex-1">
                    <div className="font-bold">{t("flowstation_not_installed")}</div>
                    <div className="text-orange-300 text-[10px] mt-0.5">{t("flowstation_install_hint")}</div>
                  </div>
                </div>
              ) : info.demo ? (
                <div className="flex items-center gap-2 p-3 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {t("flowstation_demo_mode")}
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
                <div className="flex items-center gap-2 p-3 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs">
                  <ArrowUpCircle className="w-4 h-4 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-bold">{t("update_new_version")}</div>
                    {info.remoteMessage && (
                      <div className="text-emerald-300 truncate mt-0.5">{info.remoteMessage}</div>
                    )}
                    {info.remoteDate && (
                      <div className="text-[10px] text-emerald-500/70 mt-0.5">{fmtDate(info.remoteDate)} · {info.remoteAuthor}</div>
                    )}
                  </div>
                  <div className="flex flex-col items-end text-[10px] font-mono shrink-0 gap-0.5">
                    <span className="text-muted-foreground">local: {info.localHash}</span>
                    <span className="text-emerald-400">remote: {info.remoteHash}</span>
                  </div>
                </div>
              )}

              {!done && (
                <div className="bg-black/40 border border-border rounded p-2 text-[10px] font-mono text-muted-foreground space-y-0.5">
                  {mode === "install" ? (
                    <>
                      <div className="text-green-400">$ cd /root</div>
                      <div className="text-green-400">$ sudo git clone https://github.com/{`razvanzeces/flowstation`}</div>
                      <div className="text-green-400">$ cargo build --release</div>
                      <div className="text-green-400">$ cp example_config/config.toml config.toml</div>
                      <div className="text-amber-400">$ create /etc/systemd/system/flowstation.service</div>
                    </>
                  ) : (
                    <>
                      <div className="text-green-400">$ cd {DIR}</div>
                      <div className="text-green-400">$ sudo git pull</div>
                      <div className="text-green-400">$ cargo build --release</div>
                      <div className="text-amber-400">$ sudo systemctl restart {SERVICE} (si activo)</div>
                    </>
                  )}
                </div>
              )}

              {!done && (
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
                      onKeyDown={e => {
                        if (e.key === "Enter" && !busy && password) {
                          runStream(mode === "install" ? "/api/flowstation/install" : "/api/flowstation/apply");
                        }
                      }}
                      disabled={busy}
                      placeholder="••••••••"
                      className="flex-1 bg-background border border-border rounded px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary disabled:opacity-50"
                      data-testid="input-flowstation-password"
                    />
                    <button
                      onClick={() => runStream(mode === "install" ? "/api/flowstation/install" : "/api/flowstation/apply")}
                      disabled={busy || !password || (mode === "update" && info?.dirNotFound)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${
                        mode === "install" ? "bg-orange-600 hover:bg-orange-500" : "bg-emerald-600 hover:bg-emerald-500"
                      }`}
                      data-testid="button-flowstation-apply"
                    >
                      {mode === "install" ? <Download className={`w-3 h-3 ${busy ? "animate-pulse" : ""}`} /> : <Waves className={`w-3 h-3 ${busy ? "animate-pulse" : ""}`} />}
                      {busy ? t("update_applying") : (mode === "install" ? t("flowstation_install") : t("update_apply"))}
                    </button>
                  </div>
                  {errMsg && <p className="text-xs text-red-400">{errMsg}</p>}
                </div>
              )}

              {done && (
                <div className="flex items-center gap-2 p-3 rounded bg-green-500/10 border border-green-500/30 text-green-400 text-xs font-bold">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  {t("update_success")}
                </div>
              )}

              {output && (
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                    {t("update_output_log")}
                  </p>
                  <pre
                    ref={outputRef}
                    className="bg-black/60 border border-border rounded p-3 text-[10px] font-mono text-emerald-300 overflow-auto max-h-52 whitespace-pre-wrap break-all leading-relaxed"
                    data-testid="text-flowstation-output"
                  >
                    {output}
                  </pre>
                </div>
              )}
            </div>

            <div className="px-4 py-3 border-t border-border flex justify-between items-center">
              <button
                onClick={check}
                disabled={busy}
                className="text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-40 flex items-center gap-1"
                data-testid="button-flowstation-recheck"
              >
                <Waves className="w-3 h-3" />
                {t("update_checking")}
              </button>
              <button
                onClick={closeModal}
                disabled={busy}
                className="px-3 py-1.5 text-xs font-bold rounded bg-white/10 hover:bg-white/20 text-foreground disabled:opacity-40 transition-colors"
                data-testid="button-flowstation-close"
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
