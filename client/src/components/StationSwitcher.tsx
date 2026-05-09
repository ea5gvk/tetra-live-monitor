import { useState, useEffect, useCallback } from "react";
import { Radio, Waves, X, Lock, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";

type StationName = "bluestation" | "flowstation";

interface StationInfo {
  exists: boolean;
  active: boolean;
  enabled: boolean;
  installed: boolean;
  dir: string;
  configPath: string;
  service: string;
}

interface ActiveResp {
  station: StationName;
  persisted: StationName;
  services: { bluestation: StationInfo; flowstation: StationInfo };
}

const POLL_MS = 30 * 1000;

export function StationSwitcher() {
  const { t } = useI18n();
  const [data, setData] = useState<ActiveResp | null>(null);
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<StationName>("bluestation");
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
      try {
        if (j?.services?.[j.station]?.service) {
          const svc = j.services[j.station].service;
          if (localStorage.getItem("tetra_restart_service") !== svc) {
            localStorage.setItem("tetra_restart_service", svc);
          }
          if (localStorage.getItem("tetra_log_service") !== svc) {
            localStorage.setItem("tetra_log_service", svc);
          }
        }
      } catch {}
    } catch {}
  }, []);

  useEffect(() => {
    fetchActive();
    const id = setInterval(fetchActive, POLL_MS);
    return () => clearInterval(id);
  }, [fetchActive]);

  function openSwitch(to: StationName) {
    setTarget(to);
    setPassword("");
    setErr("");
    setDone(false);
    setLogOut("");
    setBusy(false);
    setOpen(true);
  }

  async function doSwitch() {
    if (!password) return;
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/station/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, station: target }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setErr(j.message || t("station_switch_error"));
        if (j.log) setLogOut(j.log);
        setBusy(false);
        return;
      }
      setLogOut(j.log || "");
      setDone(true);
      setBusy(false);
      // Update localStorage for restart/log service immediately
      try {
        if (j.service) {
          localStorage.setItem("tetra_restart_service", j.service);
          localStorage.setItem("tetra_log_service", j.service);
        }
      } catch {}
      setTimeout(fetchActive, 600);
    } catch {
      setErr(t("station_switch_error"));
      setBusy(false);
    }
  }

  if (!data) return null;
  const blueOK = data.services.bluestation.installed;
  const flowOK = data.services.flowstation.installed;
  const active = data.station;

  return (
    <>
      <div
        className="inline-flex items-center rounded border border-white/10 bg-white/5 overflow-hidden"
        title={t("station_active")}
        data-testid="station-switcher"
      >
        <button
          onClick={() => active === "flowstation" ? openSwitch("bluestation") : null}
          disabled={!blueOK || active === "bluestation"}
          className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold transition-colors ${
            active === "bluestation"
              ? "bg-violet-500/20 text-violet-300"
              : blueOK
                ? "text-muted-foreground hover:text-foreground hover:bg-white/5"
                : "text-muted-foreground/40 cursor-not-allowed"
          }`}
          title={!blueOK ? t("station_not_installed") : t("station_switch_to_blue")}
          data-testid="button-station-bluestation"
        >
          <Radio className="w-3 h-3" />
          BLUE
          {data.services.bluestation.active && <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />}
        </button>
        <div className="w-px h-4 bg-white/10" />
        <button
          onClick={() => flowOK ? (active === "bluestation" ? openSwitch("flowstation") : null) : null}
          disabled={!flowOK || active === "flowstation"}
          className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold transition-colors ${
            active === "flowstation"
              ? "bg-emerald-500/20 text-emerald-300"
              : flowOK
                ? "text-muted-foreground hover:text-foreground hover:bg-white/5"
                : "text-muted-foreground/40 cursor-not-allowed"
          }`}
          title={!flowOK ? t("flowstation_not_installed") : t("station_switch_to_flow")}
          data-testid="button-station-flowstation"
        >
          <Waves className="w-3 h-3" />
          FLOW
          {data.services.flowstation.active && <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />}
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-card border border-border rounded-lg w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <span className="text-sm font-bold text-foreground flex items-center gap-2">
                {target === "bluestation" ? <Radio className="w-4 h-4 text-violet-400" /> : <Waves className="w-4 h-4 text-emerald-400" />}
                {t("station_switch_title")}
              </span>
              <button onClick={() => !busy && setOpen(false)} disabled={busy} className="text-muted-foreground hover:text-foreground disabled:opacity-40">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div className="text-xs text-muted-foreground">
                {t("station_switch_confirm")} <strong className={target === "bluestation" ? "text-violet-300" : "text-emerald-300"}>
                  {target === "bluestation" ? "BLUESTATION" : "FLOWSTATION"}
                </strong>
              </div>
              <div className="bg-black/40 border border-border rounded p-2 text-[10px] font-mono text-muted-foreground space-y-0.5">
                <div className="text-red-400">$ sudo systemctl disable {target === "bluestation" ? "flowstation.service" : "tmo.service"}</div>
                <div className="text-red-400">$ sudo systemctl stop {target === "bluestation" ? "flowstation.service" : "tmo.service"}</div>
                <div className="text-green-400">$ sudo systemctl enable {target === "bluestation" ? "tmo.service" : "flowstation.service"}</div>
                <div className="text-green-400">$ sudo systemctl start {target === "bluestation" ? "tmo.service" : "flowstation.service"}</div>
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
                        target === "bluestation" ? "bg-violet-600 hover:bg-violet-500" : "bg-emerald-600 hover:bg-emerald-500"
                      }`}
                      data-testid="button-station-confirm"
                    >
                      {busy ? t("station_switching") : t("station_switch_btn")}
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
