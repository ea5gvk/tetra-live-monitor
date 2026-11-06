import { useState, useEffect, useCallback } from "react";
import { Radio, Waves, RadioTower, X, Lock, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { useLocation } from "wouter";
import { useI18n } from "@/lib/i18n";

type StationName = "bluestation" | "flowstation" | "miurastation" | "dmr";
// The buttons: the four stations and MIURA+DMR, MiuraStation's unit with the DMR stack next to it on the SDR.
type ButtonName = StationName | "miuradmr";
const unitOf = (b: ButtonName): StationName => b === "miuradmr" ? "miurastation" : b;

interface StationInfo {
  exists: boolean;
  active: boolean;
  enabled: boolean;
  installed: boolean;
  dir: string;
  configPath: string;
  service: string;
  product?: string;
  // dmr only: the target is up but mmdvm-multi.service / dmrtc.service (missing) are not
  degraded?: boolean;
  missing?: string[];
}

interface ActiveResp {
  station: StationName;
  persisted: StationName;
  services: Record<StationName, StationInfo | undefined>;
  // shared: SDR_COMPARTIDO applied; sharedAvailable: MIURA+DMR can be chosen (dmr-tier3 0.4.0 + MiuraStation 1.4.0)
  dmr?: { degraded: boolean; missing: string[]; shared?: boolean; sharedAvailable?: boolean };
}

// MIURA = MiuraStation (EA5GVK), FLOW = razvan's FlowStation, BLUE = BlueStation (tmo),
// DMR = the DMR Tier III stack (EA7KEN's MMDVM-Multi/dmrtc/DMRGateway on the SX1255) as one systemd target,
// MIURA+DMR = both at once on the SDR (SDR_COMPARTIDO=1). MIURA and DMR are each alone on the SDR.
const STATIONS: { name: ButtonName; label: string; long: string; Icon: typeof Radio; on: string; text: string; btn: string; switchKey: string }[] = [
  { name: "bluestation", label: "BLUE", long: "BLUESTATION", Icon: Radio, on: "bg-violet-500/20 text-violet-300", text: "text-violet-300", btn: "bg-violet-600 hover:bg-violet-500", switchKey: "station_switch_to_blue" },
  { name: "flowstation", label: "FLOW", long: "FLOWSTATION", Icon: Waves, on: "bg-emerald-500/20 text-emerald-300", text: "text-emerald-300", btn: "bg-emerald-600 hover:bg-emerald-500", switchKey: "station_switch_to_flow" },
  { name: "miurastation", label: "MIURA", long: "MIURASTATION", Icon: Waves, on: "bg-amber-500/20 text-amber-300", text: "text-amber-300", btn: "bg-amber-600 hover:bg-amber-500", switchKey: "station_switch_to_flow" },
  { name: "miuradmr", label: "MIURA+DMR", long: "MIURASTATION + DMR TIER III", Icon: Waves, on: "bg-amber-500/20 text-amber-300", text: "text-amber-300", btn: "bg-amber-600 hover:bg-amber-500", switchKey: "station_switch_to_miura_dmr" },
  { name: "dmr", label: "DMR", long: "DMR TIER III", Icon: RadioTower, on: "bg-cyan-500/20 text-cyan-300", text: "text-cyan-300", btn: "bg-cyan-600 hover:bg-cyan-500", switchKey: "station_switch_to_dmr" },
];

// The button of the station in use: MiuraStation with SDR_COMPARTIDO applied is MIURA+DMR.
const activeButton = (d: ActiveResp): ButtonName => d.station === "miurastation" && d.dmr?.shared ? "miuradmr" : d.station;
// A button's units are on air: MIURA+DMR only with the stack up too; MIURA and DMR only alone on the SDR.
function onAir(d: ActiveResp, b: ButtonName): boolean {
  const shared = !!d.dmr?.shared;
  if (b === "miuradmr") return shared && !!d.services.miurastation?.active && !!d.services.dmr?.active;
  if (b === "miurastation" || b === "dmr") return !shared && !!d.services[b]?.active;
  return !!d.services[b]?.active;
}

const POLL_MS = 30 * 1000;
// Other pages (the DMR dashboard when the stack is stopped) open the switch dialog through this window event,
// with { detail: { station } }; nothing happens when that station is not installed or is already running.
export const OPEN_STATION_SWITCHER_EVENT = "tlm:open-station-switcher";
// The live log of the DMR station is the journal of its five units (/api/log-stream?service=dmr), not the target.
const DMR_LOG_SERVICE = "dmr";
// Switching to the DMR stack waits up to 60 s on the server for mmdvm-multi and dmrtc, and every systemctl of a
// switch may take up to 15 s: give the request room (before there was no limit at all).
const SWITCH_TIMEOUT_MS = 120 * 1000;

function rememberServices(station: StationName, service: string) {
  try {
    const logSvc = station === "dmr" ? DMR_LOG_SERVICE : service;
    if (localStorage.getItem("tetra_restart_service") !== service) localStorage.setItem("tetra_restart_service", service);
    if (localStorage.getItem("tetra_log_service") !== logSvc) localStorage.setItem("tetra_log_service", logSvc);
  } catch {}
}

export function StationSwitcher() {
  const { t } = useI18n();
  const [location, setLocation] = useLocation();
  const [data, setData] = useState<ActiveResp | null>(null);
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<ButtonName>("bluestation");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const [logOut, setLogOut] = useState("");

  const fetchActive = useCallback(async () => {
    try {
      const r = await fetch("/api/station/active");
      const j: ActiveResp = await r.json();
      setData(j);
      // Auto-update restart-service & log-service localStorage to match the running station
      const svc = j?.services?.[j.station]?.service;
      if (svc) rememberServices(j.station, svc);
    } catch {}
  }, []);

  useEffect(() => {
    fetchActive();
    const id = setInterval(fetchActive, POLL_MS);
    return () => clearInterval(id);
  }, [fetchActive]);

  function openSwitch(to: ButtonName) {
    setTarget(to);
    setPassword("");
    setErr("");
    setDone(false);
    setLogOut("");
    setBusy(false);
    setOpen(true);
  }

  useEffect(() => {
    const onOpen = (e: Event) => {
      let to: ButtonName | undefined = (e as CustomEvent<{ station?: StationName }>).detail?.station;
      // shared: reactivating the DMR is MIURA+DMR again, which is up only with the stack up too
      if (data?.dmr?.shared && to === "dmr") to = "miuradmr";
      if (!to || !data?.services[unitOf(to)]?.installed) return;
      if (activeButton(data) === to && onAir(data, to)) return;
      openSwitch(to);
    };
    window.addEventListener(OPEN_STATION_SWITCHER_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_STATION_SWITCHER_EVENT, onOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  async function doSwitch() {
    if (!password) return;
    setBusy(true);
    setErr("");
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), SWITCH_TIMEOUT_MS);
    try {
      const r = await fetch("/api/station/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // alone: MIURA and DMR each alone on the SDR (without it the server keeps MIURA+DMR when it is applied)
        body: JSON.stringify({ password, station: target, ...(target === "miurastation" || target === "dmr" ? { alone: true } : {}) }),
        signal: ctl.signal,
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setErr(j.message || t("station_switch_error"));
        if (j.log) setLogOut(j.log);
        setBusy(false);
        // a failed switch may have changed things all the same (MIURA+DMR with the stack not up, SDR_COMPARTIDO)
        setTimeout(fetchActive, 600);
        return;
      }
      setLogOut(j.log || "");
      setDone(true);
      setBusy(false);
      // Update localStorage for restart/log service immediately
      if (j.service) rememberServices(unitOf(target), j.service);
      if (target === "dmr") setLocation("/dmr");
      // MIURA+DMR keeps the DMR dashboard (it is the DMR being started from there)
      else if (location === "/dmr" && target !== "miuradmr") setLocation("/");
      setTimeout(fetchActive, 600);
    } catch {
      setErr(t("station_switch_error"));
      setBusy(false);
      setTimeout(fetchActive, 600);
    } finally {
      clearTimeout(timer);
    }
  }

  if (!data) return null;
  const current = activeButton(data);
  const shared = !!data.dmr?.shared;
  // MIURA+DMR only where it can run (dmr-tier3 0.4.0 + MiuraStation 1.4.0 or later) or is already applied
  const buttons = STATIONS.filter(s => s.name !== "miuradmr" || shared || data.dmr?.sharedAvailable);
  const meta = STATIONS.find(s => s.name === target) ?? STATIONS[0];
  const targetUnit = unitOf(target);
  // to MIURA+DMR: BLUE / FLOW stopped first, MiuraStation (re)started and the stack started next to it
  const toShared = target === "miuradmr";
  // SDR_COMPARTIDO changes first (stack stopped, gen-config.py): on for MIURA+DMR, off for MIURA and DMR
  const sharedOn = toShared && !shared;
  const sharedOff = shared && (target === "miurastation" || target === "dmr");
  const units = STATIONS.filter(s => s.name !== "miuradmr").map(s => s.name as StationName);
  // the dialog lists the units the switch will stop (the installed ones other than the target; MIURA+DMR keeps the stack)
  const others = units.filter(n => n !== targetUnit && !(toShared && n === "dmr") && data.services[n]?.exists).map(n => data.services[n]!.service);
  const targetService = data.services[targetUnit]?.service ?? "";
  const toDmr = target === "dmr";
  const sharedStopped = toShared ? units.filter(n => (n === "bluestation" || n === "flowstation") && data.services[n]?.active).map(n => data.services[n]!.service) : [];
  // to the DMR: the station in use is stopped first (the SDR must be free), then the target is started
  const running = toDmr ? units.find(n => n !== "dmr" && data.services[n]?.active) : undefined;
  const runningService = running ? (data.services[running]?.service ?? "") : "";
  const dmrInfo = data.services.dmr;
  const dmrUp = !!(dmrInfo?.active || dmrInfo?.degraded);
  // leaving the DMR for BLUE or FLOW (no Conflicts= with them): the server stops the stack first, MIURA's unit does it
  const dmrStoppedFirst = !toDmr && targetUnit !== "miurastation" && dmrUp ? (dmrInfo?.service ?? "") : "";
  const dmrMissing = dmrInfo?.missing ?? data.dmr?.missing ?? [];
  const dmrDegraded = !!(dmrInfo?.degraded ?? data.dmr?.degraded) && dmrMissing.length > 0;
  // MIURA+DMR with MiuraStation on air and the stack not (fully) up: what is missing, the target when it is stopped
  const miuraInfo = data.services.miurastation;
  const sharedDown = shared && !!miuraInfo?.active && !dmrInfo?.active;
  const sharedMissing = dmrMissing.length ? dmrMissing : [dmrInfo?.service ?? "dmr-tier3.target"];

  return (
    <>
      <div
        className="inline-flex items-center rounded border border-white/10 bg-white/5 overflow-hidden"
        title={t("station_active")}
        data-testid="station-switcher"
      >
        {buttons.map((st, i) => {
          const info = data.services[unitOf(st.name)];
          const merged = st.name === "miuradmr";
          const ok = !!info?.installed && (!merged || !!dmrInfo?.installed);
          const isActive = current === st.name;
          const on = onAir(data, st.name);
          // the chosen station with its unit stopped (a failed apply, a crash) can be started again from here
          const canSwitch = ok && !(isActive && on);
          const degraded = (st.name === "dmr" && !shared && dmrDegraded) || (merged && sharedDown);
          const missing = merged ? sharedMissing : dmrMissing;
          const title = !ok
            ? st.name === "bluestation" ? t("station_not_installed")
              : st.name === "dmr" || merged ? `${t("station_not_installed")}: ${st.long} — ${t("station_install_first")}`
              : `${t("station_not_installed")}: ${info?.product ?? st.long}`
            : degraded ? `${t("station_dmr_degraded")} ${missing.join(", ")}`
            : st.name === "miurastation" ? t(st.switchKey).replace(/Flow[Ss]tation|FLOWSTATION/, "MiuraStation")
            : t(st.switchKey);
          return (
            <span key={st.name} className="inline-flex items-center">
              {i > 0 && <div className="w-px h-4 bg-white/10" />}
              <button
                onClick={() => canSwitch ? openSwitch(st.name) : null}
                disabled={!canSwitch}
                className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold transition-colors ${
                  isActive
                    ? st.on
                    : ok
                      ? "text-muted-foreground hover:text-foreground hover:bg-white/5"
                      : "text-muted-foreground/40 cursor-not-allowed"
                }`}
                title={title}
                data-testid={`button-station-${st.name}`}
              >
                <st.Icon className="w-3 h-3" />
                {st.label}
                {on && <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />}
                {!on && degraded && (
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" title={`${t("station_dmr_degraded")} ${missing.join(", ")}`} data-testid="dot-station-dmr-degraded" />
                )}
              </button>
            </span>
          );
        })}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-card border border-border rounded-lg w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="text-sm font-bold text-foreground flex items-center gap-2">
                <meta.Icon className={`w-4 h-4 ${meta.text}`} />
                {t("station_switch_title")}
              </span>
              <button onClick={() => !busy && setOpen(false)} disabled={busy} className="text-muted-foreground hover:text-foreground disabled:opacity-40">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div className="text-xs text-muted-foreground">
                {t(toDmr ? "station_switch_confirm_dmr" : "station_switch_confirm")} <strong className={meta.text}>
                  {meta.long}
                </strong>
              </div>
              {(sharedOn || sharedOff) && (
                <div className="text-[10px] text-amber-200/90 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1.5" data-testid="text-station-shared-explain">
                  {t(sharedOn ? "station_switch_shared_on_explain" : "station_switch_shared_off_explain")}
                </div>
              )}
              {toDmr && (
                <div className="text-[10px] text-cyan-200/90 bg-cyan-500/10 border border-cyan-500/30 rounded px-2 py-1.5" data-testid="text-station-dmr-explain">
                  {t("station_switch_dmr_explain")}
                </div>
              )}
              <div className="bg-black/40 border border-border rounded p-2 text-[10px] font-mono text-muted-foreground space-y-0.5">
                {(sharedOn || sharedOff) && (
                  <>
                    {dmrUp && <div className="text-red-400">$ sudo systemctl stop {dmrInfo?.service}</div>}
                    <div className="text-amber-400"># SDR_COMPARTIDO={sharedOn ? 1 : 0} (dmr-tier3.conf)</div>
                    <div className="text-green-400">$ sudo python3 gen-config.py</div>
                  </>
                )}
                {toDmr ? (
                  <>
                    {runningService && <div className="text-red-400">$ sudo systemctl stop {runningService}</div>}
                    <div className="text-green-400">$ sudo systemctl enable {targetService}</div>
                    <div className="text-green-400">$ sudo systemctl start --no-block {targetService}</div>
                    <div className="text-amber-400"># mmdvm-multi.service + dmrtc.service (≤ 60 s)</div>
                  </>
                ) : toShared ? (
                  <>
                    {sharedStopped.map(svc => <div key={`stop-${svc}`} className="text-red-400">$ sudo systemctl stop {svc}</div>)}
                    <div className="text-green-400">$ sudo systemctl enable {targetService}</div>
                    <div className="text-red-400">$ sudo systemctl disable {dmrInfo?.service}</div>
                    <div className="text-green-400">
                      $ {miuraInfo?.active ? (sharedOn ? `sudo systemctl restart --no-block ${targetService}` : `[ -e /dev/shm/miurastation-dmr ] || ! [ config.toml -nt ${targetService} ] || sudo systemctl restart --no-block ${targetService}`) : `sudo systemctl start --no-block ${targetService}`}
                    </div>
                    <div className="text-green-400">$ sudo systemctl start --no-block {dmrInfo?.service}</div>
                    <div className="text-amber-400"># {targetService} + mmdvm-multi.service + dmrtc.service (≤ 60 s)</div>
                  </>
                ) : (
                  <>
                    {dmrStoppedFirst && <div className="text-red-400">$ sudo systemctl stop {dmrStoppedFirst}</div>}
                    <div className="text-green-400">$ sudo systemctl enable {targetService}</div>
                    <div className="text-green-400">$ sudo systemctl {sharedOff && miuraInfo?.active ? "restart --no-block" : "start"} {targetService}</div>
                  </>
                )}
                {others.filter(svc => svc !== runningService).map(svc => (
                  <div key={svc} className="text-red-400">
                    {svc.endsWith(".target") ? `$ sudo systemctl disable --now ${svc}` : `$ sudo systemctl disable ${svc} && sudo systemctl stop ${svc}`}
                  </div>
                ))}
              </div>

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
                      onKeyDown={e => e.key === "Enter" && !busy && password && doSwitch()}
                      disabled={busy}
                      placeholder="••••••••"
                      className="flex-1 bg-background border border-border rounded px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary disabled:opacity-50"
                      data-testid="input-station-password"
                    />
                    <button
                      onClick={doSwitch}
                      disabled={busy || !password}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded text-white disabled:opacity-50 transition-colors ${
                        meta.btn
                      }`}
                      data-testid="button-station-confirm"
                    >
                      {busy && <Loader2 className="w-3 h-3 animate-spin" />}
                      {busy ? t(toDmr || toShared ? "station_switching_dmr" : "station_switching") : t("station_switch_btn")}
                    </button>
                  </div>
                </div>
              )}

              {err && (
                <div className="flex items-start gap-2 p-3 rounded bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{err}</span>
                </div>
              )}

              {done && (
                <div className="flex items-center gap-2 p-3 rounded bg-green-500/10 border border-green-500/30 text-green-400 text-xs font-bold">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  {t("station_switch_done")}
                </div>
              )}

              {logOut && (
                <pre className="bg-black/60 border border-border rounded p-2 text-[10px] font-mono text-muted-foreground overflow-auto max-h-40 whitespace-pre-wrap break-all">
                  {logOut}
                </pre>
              )}
            </div>
            <div className="px-4 py-3 border-t border-border flex justify-end">
              <button
                onClick={() => !busy && setOpen(false)}
                disabled={busy}
                className="px-3 py-1.5 text-xs font-bold rounded bg-white/10 hover:bg-white/20 text-foreground disabled:opacity-40 transition-colors"
                data-testid="button-station-close"
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
