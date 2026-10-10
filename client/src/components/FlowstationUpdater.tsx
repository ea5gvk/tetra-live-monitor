import { useState, useEffect, useRef, useCallback } from "react";
import { Waves, X, ArrowUpCircle, CheckCircle2, AlertTriangle, Lock, Download } from "lucide-react";
import { useI18n } from "@/lib/i18n";

type FlowSource = "razvan" | "miura";

interface UpdateInfo {
  demo?: boolean;
  dirNotFound?: boolean;
  upToDate?: boolean;
  switching?: boolean;
  localHash?: string;
  remoteHash?: string;
  remoteMessage?: string;
  remoteDate?: string;
  remoteAuthor?: string;
  apiError?: string;
  source?: FlowSource;
  active?: FlowSource;
  sources?: Record<FlowSource, { repo: string; branch: string; label: string; dir?: string; service?: string }>;
  // source miura: what still has to move to the package — the miura FlowStation in /root/flowstation ("legacy") or
  // a MiuraStation built from source ("source")
  needsMigration?: boolean;
  migrationKind?: "legacy" | "source" | null;
  packaged?: boolean;
  dir?: string;
  service?: string;
}

// Each check runs git/curl on the Pi next to the station; every 5 min (per open tab) lined up
// with the radios dropping the cell. Once an hour, plus on page load and when the modal opens.
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
// Two products: razvan's FlowStation (git + cargo) and MiuraStation (EA5GVK, the .deb of its releases), each in its
// own directory and unit.
const SOURCE_META: Record<FlowSource, { repo: string; branch: string; label: string; dir: string; service: string }> = {
  razvan: { repo: "razvanzeces/flowstation", branch: "main", label: "FlowStation (razvan · main)", dir: "/root/flowstation", service: "flowstation.service" },
  miura: { repo: "ea5gvk/MiuraStation-dist", branch: "latest", label: "MiuraStation (EA5GVK · paquete .deb)", dir: "/root/miurastation", service: "miurastation.service" },
};
const MIURA_INSTALL_HINT = "Descargará el paquete .deb de la última versión de ea5gvk/MiuraStation-dist (arm64: Raspberry Pi 3/4/5 con sistema de 64 bits; amd64: PC con Debian 12/13 o Ubuntu 22.04/24.04), comprobará su SHA-256 y lo instalará con apt-get. config.toml queda en /root/miurastation.";

// The i18n texts name razvan's FlowStation and its paths: for MiuraStation, its own name, directory and unit.
function forSource(text: string, src: FlowSource): string {
  if (src !== "miura") return text;
  const m = SOURCE_META.miura;
  return text
    .replace(/FLOWSTATION/g, "MIURASTATION").replace(/Flow[Ss]tation/g, "MiuraStation").replace(/\bFLOW\b/g, "MIURA")
    .replace(/\/root\/flowstation/g, m.dir).replace(/flowstation\.service/g, m.service);
}

export function FlowstationUpdater() {
  const { t } = useI18n();
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState("");
  const [done, setDone] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [source, setSource] = useState<FlowSource | null>(null);
  const outputRef = useRef<HTMLPreElement>(null);

  const check = useCallback(async (src?: FlowSource) => {
    try {
      const q = src ? `?source=${src}` : "";
      const r = await fetch(`/api/flowstation/check${q}`);
      const data = await r.json();
      setInfo(data);
      setSource(prev => prev ?? (data.active as FlowSource) ?? "razvan");
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

  const hasUpdate = info && !info.demo && !info.dirNotFound && info.upToDate === false && !info.switching;
  const notInstalled = info?.dirNotFound === true;
  const sel: FlowSource = source ?? "razvan";
  const meta = { ...SOURCE_META[sel], ...(info?.sources?.[sel] ?? {}) };
  const DIR = meta.dir || SOURCE_META[sel].dir;
  const SERVICE = meta.service || SOURCE_META[sel].service;
  // install = the selected product is not there; migrate = MiuraStation over the miura FlowStation
  const mode: "update" | "install" | "migrate" = notInstalled ? "install" : info?.needsMigration ? "migrate" : "update";
  // navbar button: the product in use
  const navSrc: FlowSource = info?.active ?? sel;

  function openModal() {
    setPassword(""); setOutput(""); setDone(false); setErrMsg(""); setBusy(false);
    const a: FlowSource = info?.active ?? source ?? "razvan";
    setSource(a); check(a);
    setModalOpen(true);
  }

  function pickSource(s: FlowSource) {
    if (busy) return;
    setSource(s); check(s);
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
        body: JSON.stringify({ password, dir: DIR, serviceName: SERVICE, source: sel }),
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
        title={forSource(notInstalled ? t("flowstation_install") : (hasUpdate ? `${t("update_available")} — Flowstation` : t("flowstation_check_title")), navSrc)}
        data-testid="button-flowstation-updater"
      >
        <Waves className="w-3 h-3" />
        {forSource(notInstalled ? t("flowstation_install_short") : t("flowstation_update"), navSrc)}
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
                {forSource(mode === "install" ? t("flowstation_install_title") : t("flowstation_check_title"), sel)}
                <span className="text-[10px] font-normal text-muted-foreground font-mono">{meta.repo} · {meta.branch}</span>
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

              <div className="space-y-1.5">
                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Versión / repositorio</div>
                <div className="grid grid-cols-2 gap-2">
                  {(["razvan", "miura"] as FlowSource[]).map(s => {
                    const m = { ...SOURCE_META[s], ...(info?.sources?.[s] ?? {}), label: SOURCE_META[s].label };
                    const isSel = sel === s;
                    const isActive = info?.active === s;
                    return (
                      <button
                        key={s}
                        onClick={() => pickSource(s)}
                        disabled={busy}
                        className={`text-left p-2 rounded border text-[11px] transition-colors disabled:opacity-50 ${isSel ? "border-emerald-500/60 bg-emerald-500/10 text-foreground" : "border-white/10 bg-white/5 text-muted-foreground hover:bg-white/10"}`}
                        data-testid={`button-flowstation-source-${s}`}
                      >
                        <div className="font-bold flex items-center gap-1">
                          {m.label}
                          {isActive && <span className="text-[9px] px-1 rounded bg-emerald-500/20 text-emerald-400">activa</span>}
                        </div>
                        <div className="font-mono text-[9px] text-muted-foreground truncate">{m.repo} · {m.branch}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {info === null ? (
                <p className="text-xs text-muted-foreground">{t("update_checking")}</p>
              ) : info.dirNotFound ? (
                <div className="flex items-center gap-2 p-3 rounded bg-orange-500/10 border border-orange-500/30 text-orange-400 text-xs">
                  <Download className="w-4 h-4 shrink-0" />
                  <div className="flex-1">
                    <div className="font-bold">{forSource(t("flowstation_not_installed"), sel)}</div>
                    <div className="text-orange-300 text-[10px] mt-0.5">{sel === "miura" ? MIURA_INSTALL_HINT : forSource(t("flowstation_install_hint"), sel)}</div>
                  </div>
                </div>
              ) : info.demo ? (
                <div className="flex items-center gap-2 p-3 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {forSource(t("flowstation_demo_mode"), sel)}
                </div>
              ) : info.needsMigration ? (
                <div className="flex items-start gap-2 p-3 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs" data-testid="text-flowstation-migration">
                  <ArrowUpCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0 space-y-1">
                    {info.migrationKind === "source" ? (
                      <>
                        <div className="font-bold">Pasar MiuraStation compilada al paquete .deb</div>
                        <div className="text-[10px] text-amber-200/90">
                          Se instala el paquete miurastation y se retira la unidad compilada /etc/systemd/system/{SERVICE}
                          (los drop-ins se quedan); config.toml, logs y cachés siguen en {DIR}. Si algo falla se deshace solo
                          y la MiuraStation compilada sigue como estaba.
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="font-bold">Migrar la FlowStation miura a MiuraStation</div>
                        <div className="text-[10px] text-amber-200/90">
                          /root/flowstation pasa a {DIR} con su config.toml, logs y cachés (queda un enlace /root/flowstation → {DIR}),
                          se instala el paquete miurastation, {SERVICE} recibe los drop-ins de flowstation.service y esta se
                          deshabilita. Si algo falla se deshace solo y la FlowStation miura sigue como estaba.
                        </div>
                      </>
                    )}
                    <div className="flex gap-3 text-[10px] font-mono text-muted-foreground">
                      <span>local: {info.localHash}</span>
                      <span className="text-amber-300">MiuraStation: {info.remoteHash}</span>
                    </div>
                  </div>
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
                    <div className="font-bold">{info.switching ? `Cambiar a ${meta.label}` : t("update_new_version")}</div>
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
                  {sel === "miura" ? (
                    <>
                      <div className="text-green-400">$ curl -LO …/{meta.repo}/releases/download/{info?.remoteHash ?? "vX.Y.Z"}/miurastation_…_arm64|amd64.deb · SHA256SUMS</div>
                      <div className="text-green-400">$ sha256sum -c</div>
                      {mode === "migrate" && (
                        <div className="text-red-400">$ sudo systemctl stop {info?.migrationKind === "source" ? SERVICE : "flowstation.service"}</div>
                      )}
                      {mode === "migrate" && info?.migrationKind !== "source" && (
                        <div className="text-green-400">$ mv /root/flowstation {DIR} &amp;&amp; ln -s {DIR} /root/flowstation</div>
                      )}
                      {mode === "migrate" && (
                        <div className="text-amber-400">$ {info?.migrationKind === "source" ? `rm /etc/systemd/system/${SERVICE}` : "disable flowstation.service"} (copia en /root/.tlm-miurastation-migration)</div>
                      )}
                      {mode === "update" && <div className="text-red-400">$ sudo systemctl stop {SERVICE}</div>}
                      <div className="text-green-400">$ sudo apt-get install ./miurastation_…_arm64|amd64.deb</div>
                      <div className="text-green-400">$ config.toml {mode === "install" ? "existente → se conserva (si no hay: plantilla del paquete)" : "→ solo se añade lo nuevo de la plantilla"}</div>
                      {mode !== "install" && <div className="text-amber-400">$ sudo systemctl start {SERVICE} (si estaba en marcha)</div>}
                    </>
                  ) : mode === "install" ? (
                    <>
                      <div className="text-green-400">$ cd /root</div>
                      <div className="text-green-400">$ sudo git clone -b {meta.branch} https://github.com/{meta.repo}.git</div>
                      <div className="text-green-400">$ config.toml existente → se conserva (si no hay: example_config/config.toml)</div>
                      <div className="text-green-400">$ cargo build --release</div>
                      <div className="text-amber-400">$ create /etc/systemd/system/{SERVICE}</div>
                    </>
                  ) : (
                    <>
                      <div className="text-green-400">$ git remote set-url origin https://github.com/{meta.repo}.git</div>
                      <div className="text-green-400">$ git fetch && git checkout -B {meta.branch} origin/{meta.branch}</div>
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
                        mode === "install" ? "bg-orange-600 hover:bg-orange-500" : mode === "migrate" ? "bg-amber-600 hover:bg-amber-500" : "bg-emerald-600 hover:bg-emerald-500"
                      }`}
                      data-testid="button-flowstation-apply"
                    >
                      {mode === "install" ? <Download className={`w-3 h-3 ${busy ? "animate-pulse" : ""}`} /> : <Waves className={`w-3 h-3 ${busy ? "animate-pulse" : ""}`} />}
                      {busy ? t("update_applying") : (mode === "install" ? forSource(t("flowstation_install"), sel) : mode === "migrate" ? (info?.migrationKind === "source" ? "PASAR AL PAQUETE .DEB" : "MIGRAR A MIURASTATION") : (info?.switching ? "CAMBIAR VERSIÓN" : t("update_apply")))}
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
                onClick={() => check(sel)}
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
