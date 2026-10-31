import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "wouter";
import { RadioTower, X, ArrowUpCircle, CheckCircle2, AlertTriangle, Lock, Download, Info, Wrench } from "lucide-react";
import { useI18n } from "@/lib/i18n";

// DMR Tier III: EA7KEN's stack (MMDVM-Multi -> MMDVM-IQ/Host x N -> dmrtc -> DMRGateway) on the SX1255, packaged
// as the dmr-tier3 .deb of ea5gvk/MiuraStation-dist (tags dmr-tier3-vX.Y.Z; server/dmrStation.ts). Install and
// update never start anything: the station is configured (/dmr-config) and then activated with the selector.
interface Release {
  tag: string;
  version: string;
  name: string;
  date: string;
  url: string;
  prerelease: boolean;
}

interface CheckInfo {
  product: string;
  pkg: string;
  service: string;
  dir: string;
  configPath: string;
  repo: string;
  demo: boolean;
  installed: boolean;
  version: string | null;
  configExists: boolean;
  state: { exists: boolean; active: boolean; enabled: boolean; degraded: boolean; missing: string[] };
  release: Release | null;
  noReleases: boolean;
  upToDate: boolean;
  apiError?: string;
}

const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULTS = { repo: "ea5gvk/MiuraStation-dist", dir: "/opt/dmr-tier3", service: "dmr-tier3.target", configPath: "/etc/dmr-tier3/dmr-tier3.conf" };
// Other pages (the config form when the station is missing) open this modal through a window event.
export const OPEN_DMR_UPDATER_EVENT = "tlm:open-dmr-updater";
const EXIT_RE = /\[Exit: (\d+)\]/;

export function DmrUpdater() {
  const { t } = useI18n();
  const [info, setInfo] = useState<CheckInfo | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState("");
  const [done, setDone] = useState(false);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [errMsg, setErrMsg] = useState("");
  const outputRef = useRef<HTMLPreElement>(null);

  const check = useCallback(async () => {
    try {
      const r = await fetch("/api/dmr/check");
      setInfo(await r.json());
    } catch {
      setInfo(null);
    }
  }, []);

  useEffect(() => {
    check();
    const id = setInterval(() => check(), CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [check]);

  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [output]);

  const notInstalled = info !== null && !info.installed;
  const hasRelease = !!info?.release;
  const hasUpdate = !!info && !info.demo && info.installed && hasRelease && !info.upToDate;
  const mode: "install" | "update" = notInstalled ? "install" : "update";
  const applyUrl = mode === "install" ? "/api/dmr/install" : "/api/dmr/apply";
  const repo = info?.repo ?? DEFAULTS.repo;
  const dir = info?.dir ?? DEFAULTS.dir;
  const service = info?.service ?? DEFAULTS.service;
  const configPath = info?.configPath ?? DEFAULTS.configPath;
  // the install button is of no use without a published release (the server would answer "[Exit: 1]")
  const canRun = !!info && !info.demo && hasRelease && (mode === "install" || hasUpdate);
  const succeeded = done && exitCode === 0;
  const failed = done && exitCode !== 0;
  const installedNow = succeeded && mode === "install";

  const openModal = useCallback(() => {
    setPassword(""); setOutput(""); setDone(false); setExitCode(null); setErrMsg(""); setBusy(false);
    check();
    setModalOpen(true);
  }, [check]);
  useEffect(() => {
    window.addEventListener(OPEN_DMR_UPDATER_EVENT, openModal);
    return () => window.removeEventListener(OPEN_DMR_UPDATER_EVENT, openModal);
  }, [openModal]);
  function closeModal() {
    if (busy) return;
    setModalOpen(false);
    if (done) check();
  }

  async function runStream(url: string) {
    if (!password) return;
    setBusy(true); setOutput(""); setDone(false); setExitCode(null); setErrMsg("");
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ message: t("update_error") }));
        setErrMsg(err.message === "dmr_not_installed" ? t("dmr_not_installed") : (err.message || t("update_error")));
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
        if (acc.length <= 50) throw new Error("stream_error");
      }
      // the script always ends with "[Exit: N]": without it the connection was cut, treat it as a failure
      const m = EXIT_RE.exec(acc);
      setExitCode(m ? parseInt(m[1], 10) : -1);
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
        title={notInstalled ? t("dmr_install") : (hasUpdate ? `${t("update_available")} — DMR Tier III` : t("dmr_check_title"))}
        data-testid="button-dmr-updater"
      >
        <RadioTower className="w-3 h-3" />
        {notInstalled ? t("dmr_install_short") : t("dmr_update")}
        {hasUpdate && (
          <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-cyan-400 rounded-full animate-pulse border border-background" />
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
                <RadioTower className="w-4 h-4 text-cyan-400" />
                {mode === "install" ? t("dmr_install_title") : t("dmr_check_title")}
                <span className="text-[10px] font-normal text-muted-foreground font-mono">{repo} · dmr-tier3</span>
              </span>
              <button
                onClick={closeModal}
                disabled={busy}
                className="text-muted-foreground hover:text-foreground disabled:opacity-40"
                data-testid="button-dmr-modal-close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-4 overflow-y-auto flex-1">
              <div className="text-[10px] text-muted-foreground space-y-0.5">
                <div><span className="font-medium">Dir:</span> <code className="text-cyan-400 font-mono">{dir}</code></div>
                <div><span className="font-medium">Service:</span> <code className="text-amber-400 font-mono">{service}</code></div>
                <div><span className="font-medium">Config:</span> <code className="font-mono">{configPath}</code></div>
              </div>

              {info === null ? (
                <p className="text-xs text-muted-foreground">{t("update_checking")}</p>
              ) : info.demo ? (
                <div className="flex items-center gap-2 p-3 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {t("dmr_demo_mode")}
                </div>
              ) : (
                <>
                  {/* installed / available versions */}
                  <div className="grid grid-cols-2 gap-2 text-[10px]" data-testid="text-dmr-versions">
                    <div className={`p-2 rounded border ${info.installed ? "border-cyan-500/40 bg-cyan-500/10" : "border-white/10 bg-white/5"}`}>
                      <div className="text-muted-foreground uppercase tracking-wider font-bold">{t("dmr_installed_version")}</div>
                      <div className={`font-mono text-sm ${info.installed ? "text-cyan-300" : "text-muted-foreground"}`}>{info.version ?? "—"}</div>
                    </div>
                    <div className={`p-2 rounded border ${hasRelease ? "border-emerald-500/40 bg-emerald-500/10" : "border-white/10 bg-white/5"}`}>
                      <div className="text-muted-foreground uppercase tracking-wider font-bold">{t("dmr_available_version")}</div>
                      <div className={`font-mono text-sm ${hasRelease ? "text-emerald-300" : "text-muted-foreground"}`}>
                        {info.release ? `${info.release.version}${info.release.prerelease ? " (pre)" : ""}` : "—"}
                      </div>
                      {info.release?.date && <div className="text-muted-foreground/70">{fmtDate(info.release.date)}</div>}
                    </div>
                  </div>

                  {info.apiError && (
                    <div className="flex items-start gap-2 p-3 rounded bg-red-500/10 border border-red-500/30 text-red-400 text-xs" data-testid="text-dmr-api-error">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="font-bold">{t("dmr_api_error")}</div>
                        <div className="text-[10px] break-all">{info.apiError}</div>
                      </div>
                    </div>
                  )}

                  {notInstalled ? (
                    <div className="flex items-center gap-2 p-3 rounded bg-orange-500/10 border border-orange-500/30 text-orange-400 text-xs" data-testid="text-dmr-not-installed">
                      <Download className="w-4 h-4 shrink-0" />
                      <div className="flex-1">
                        <div className="font-bold">{t("dmr_not_installed")}</div>
                        <div className="text-orange-300 text-[10px] mt-0.5">{t("dmr_install_hint")}</div>
                      </div>
                    </div>
                  ) : hasUpdate ? (
                    <div className="flex items-center gap-2 p-3 rounded bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-xs" data-testid="text-dmr-update">
                      <ArrowUpCircle className="w-4 h-4 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="font-bold">{t("update_new_version")}</div>
                        {info.release?.name && <div className="text-cyan-300 truncate mt-0.5">{info.release.name}</div>}
                        <div className="text-[10px] text-cyan-200/80 mt-0.5">{t("dmr_update_hint")}</div>
                      </div>
                      <div className="flex flex-col items-end text-[10px] font-mono shrink-0 gap-0.5">
                        <span className="text-muted-foreground">local: {info.version}</span>
                        <span className="text-cyan-400">remote: {info.release?.version}</span>
                      </div>
                    </div>
                  ) : info.upToDate ? (
                    <div className="flex items-center gap-2 p-3 rounded bg-green-500/10 border border-green-500/30 text-green-400 text-xs" data-testid="text-dmr-up-to-date">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      {t("update_up_to_date")}
                      <span className="ml-auto font-mono text-[10px] text-muted-foreground">{info.release?.tag}</span>
                    </div>
                  ) : null}

                  {info.noReleases && (
                    <div className="flex items-start gap-2 p-3 rounded bg-white/5 border border-white/10 text-muted-foreground text-xs" data-testid="text-dmr-no-releases">
                      <Info className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{t("dmr_no_releases")}</span>
                    </div>
                  )}
                </>
              )}

              {!done && canRun && (
                <div className="bg-black/40 border border-border rounded p-2 text-[10px] font-mono text-muted-foreground space-y-0.5">
                  <div className="text-green-400">$ curl -LO …/{repo}/releases/download/{info.release?.tag ?? "dmr-tier3-vX.Y.Z"}/dmr-tier3_…_arm64.deb · SHA256SUMS</div>
                  <div className="text-green-400">$ sha256sum -c</div>
                  <div className="text-green-400">$ sudo apt-get install ./dmr-tier3_…_arm64.deb</div>
                  {mode === "install" ? (
                    <div className="text-sky-400"># {service}: not enabled nor started (configure first, then the station selector)</div>
                  ) : (
                    <div className="text-amber-400"># {service}: the package stops and starts it again if it is running; {configPath} is kept</div>
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
                        if (e.key === "Enter" && !busy && password && canRun) runStream(applyUrl);
                      }}
                      disabled={busy}
                      placeholder="••••••••"
                      className="flex-1 bg-background border border-border rounded px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary disabled:opacity-50"
                      data-testid="input-dmr-password"
                    />
                    <button
                      onClick={() => runStream(applyUrl)}
                      disabled={busy || !password || !canRun}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${
                        mode === "install" ? "bg-orange-600 hover:bg-orange-500" : "bg-cyan-600 hover:bg-cyan-500"
                      }`}
                      data-testid="button-dmr-apply"
                    >
                      {mode === "install" ? <Download className={`w-3 h-3 ${busy ? "animate-pulse" : ""}`} /> : <RadioTower className={`w-3 h-3 ${busy ? "animate-pulse" : ""}`} />}
                      {busy ? t("update_applying") : (mode === "install" ? t("dmr_install") : t("update_apply"))}
                    </button>
                  </div>
                  {errMsg && <p className="text-xs text-red-400" data-testid="text-dmr-error">{errMsg}</p>}
                </div>
              )}

              {succeeded && (
                <div className="space-y-2" data-testid="text-dmr-success">
                  <div className="flex items-center gap-2 p-3 rounded bg-green-500/10 border border-green-500/30 text-green-400 text-xs font-bold">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    {t("update_success")}
                  </div>
                  {installedNow && (
                    <div className="flex items-center gap-2 p-3 rounded bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs flex-wrap">
                      <span className="flex-1 min-w-[12rem]">{t("dmr_next_step")}</span>
                      <Link
                        href="/dmr-config"
                        onClick={() => { setModalOpen(false); check(); }}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded bg-cyan-600 hover:bg-cyan-500 text-white transition-colors"
                        data-testid="link-dmr-configure"
                      >
                        <Wrench className="w-3 h-3" />
                        {t("dmr_configure")}
                      </Link>
                    </div>
                  )}
                </div>
              )}

              {failed && (
                <div className="flex items-center gap-2 p-3 rounded bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-bold" data-testid="text-dmr-failed">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {t("dmr_exit_error")}{exitCode !== null && exitCode >= 0 ? ` [Exit: ${exitCode}]` : ""}
                </div>
              )}

              {output && (
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                    {t("update_output_log")}
                  </p>
                  <pre
                    ref={outputRef}
                    className="bg-black/60 border border-border rounded p-3 text-[10px] font-mono text-cyan-200 overflow-auto max-h-52 whitespace-pre-wrap break-all leading-relaxed"
                    data-testid="text-dmr-output"
                  >
                    {output}
                  </pre>
                </div>
              )}
            </div>

            <div className="px-4 py-3 border-t border-border flex justify-between items-center">
              <button
                onClick={() => check()}
                disabled={busy}
                className="text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-40 flex items-center gap-1"
                data-testid="button-dmr-recheck"
              >
                <RadioTower className="w-3 h-3" />
                {t("update_checking")}
              </button>
              <button
                onClick={closeModal}
                disabled={busy}
                className="px-3 py-1.5 text-xs font-bold rounded bg-white/10 hover:bg-white/20 text-foreground disabled:opacity-40 transition-colors"
                data-testid="button-dmr-close"
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
