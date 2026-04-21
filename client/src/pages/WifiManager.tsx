import { useState, useEffect, useCallback } from "react";
import { Wifi, WifiOff, RefreshCw, Eye, EyeOff, X, Lock, Unlock, Signal, ShieldOff } from "lucide-react";
import { useI18n } from "@/lib/i18n";

interface WifiNetwork {
  ssid: string;
  signal: number;
  security: string;
  active: boolean;
  freq?: string;
}

interface SavedNetwork {
  name: string;
  type: string;
}

interface WifiStatus {
  connected: boolean;
  ssid?: string;
  ip?: string;
  signal?: number;
  security?: string;
  interface?: string;
  demo?: boolean;
}

function SignalBars({ signal }: { signal: number }) {
  const pct = Math.min(100, Math.max(0, signal));
  const color = pct >= 70 ? "text-emerald-400" : pct >= 40 ? "text-amber-400" : "text-red-400";
  return (
    <span className={`inline-flex items-center gap-0.5 ${color}`}>
      <Signal className="w-3 h-3" />
      <span className="text-[10px] font-bold">{pct}%</span>
    </span>
  );
}

function UnlockModal({ onConfirm, onCancel }: { onConfirm: (p: string) => void; onCancel: () => void }) {
  const { t } = useI18n();
  const [pass, setPass] = useState("");
  const [show, setShow] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-lg p-5 w-72 space-y-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Unlock className="w-4 h-4 text-sky-400" />
            <span className="text-xs font-bold text-primary tracking-widest">{t("wifi_unlock")}</span>
          </div>
          <button onClick={onCancel} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground">{t("wifi_unlock_hint")}</p>
        <div className="relative">
          <input
            type={show ? "text" : "password"}
            placeholder={t("password")}
            value={pass}
            onChange={e => setPass(e.target.value)}
            onKeyDown={e => e.key === "Enter" && pass && onConfirm(pass)}
            autoFocus
            className="w-full bg-black/30 border border-border rounded px-3 py-2 text-xs text-foreground placeholder-muted-foreground pr-8 outline-none focus:border-primary/50"
            data-testid="input-unlock-password"
          />
          <button
            type="button"
            onClick={() => setShow(v => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 px-3 py-1.5 text-xs font-bold rounded bg-white/5 text-muted-foreground border border-white/10 hover:bg-white/10 transition-colors"
            data-testid="button-unlock-cancel"
          >
            {t("vpn_cancel")}
          </button>
          <button
            onClick={() => pass && onConfirm(pass)}
            disabled={!pass}
            className="flex-1 px-3 py-1.5 text-xs font-bold rounded bg-sky-500/20 text-sky-400 border border-sky-500/30 hover:bg-sky-500/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            data-testid="button-unlock-confirm"
          >
            {t("vpn_confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

function WifiPasswordModal({
  ssid,
  hasPassword,
  onConfirm,
  onCancel,
}: {
  ssid: string;
  hasPassword: boolean;
  onConfirm: (wifiPass: string) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [wifiPass, setWifiPass] = useState("");
  const [show, setShow] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-lg p-5 w-72 space-y-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-primary tracking-widest truncate">{ssid}</span>
          <button onClick={onCancel} className="text-muted-foreground hover:text-foreground shrink-0 ml-2">
            <X className="w-4 h-4" />
          </button>
        </div>
        {hasPassword && (
          <div className="relative">
            <input
              type={show ? "text" : "password"}
              placeholder={t("wifi_password")}
              value={wifiPass}
              onChange={e => setWifiPass(e.target.value)}
              onKeyDown={e => e.key === "Enter" && onConfirm(wifiPass)}
              autoFocus
              className="w-full bg-black/30 border border-border rounded px-3 py-2 text-xs text-foreground placeholder-muted-foreground pr-8 outline-none focus:border-primary/50"
              data-testid="input-wifi-network-password"
            />
            <button
              type="button"
              onClick={() => setShow(v => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
        )}
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 px-3 py-1.5 text-xs font-bold rounded bg-white/5 text-muted-foreground border border-white/10 hover:bg-white/10 transition-colors"
          >
            {t("vpn_cancel")}
          </button>
          <button
            onClick={() => onConfirm(wifiPass)}
            className="flex-1 px-3 py-1.5 text-xs font-bold rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 transition-colors"
            data-testid="button-wifi-connect-ok"
          >
            {t("wifi_connect")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function WifiManager() {
  const { t } = useI18n();

  const [status, setStatus] = useState<WifiStatus | null>(null);
  const [networks, setNetworks] = useState<WifiNetwork[]>([]);
  const [saved, setSaved] = useState<SavedNetwork[]>([]);
  const [scanning, setScanning] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  // Lock / unlock
  const [unlockedPassword, setUnlockedPassword] = useState<string>("");
  const [showUnlockModal, setShowUnlockModal] = useState(false);
  const isUnlocked = unlockedPassword.length > 0;

  // Connect flow
  const [connectTarget, setConnectTarget] = useState<WifiNetwork | null>(null);

  const showMsg = (text: string, ok: boolean) => {
    setMsg({ text, ok });
    setTimeout(() => setMsg(null), 4000);
  };

  const apiCall = async (url: string, method = "GET", body?: object) => {
    try {
      const opts: RequestInit = { method, headers: { "Content-Type": "application/json" } };
      if (body) opts.body = JSON.stringify(body);
      const r = await fetch(url, opts);
      return await r.json();
    } catch {
      return { ok: false, message: "Network error" };
    }
  };

  const fetchStatus = useCallback(async () => {
    setLoadingStatus(true);
    const r = await apiCall("/api/wifi/status");
    if (r.connected !== undefined) setStatus(r);
    setLoadingStatus(false);
  }, []);

  const fetchSaved = useCallback(async () => {
    const r = await apiCall("/api/wifi/saved");
    if (Array.isArray(r.networks)) setSaved(r.networks);
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchSaved();
  }, [fetchStatus, fetchSaved]);

  const handleUnlock = async (password: string) => {
    // Validate password by attempting a harmless authenticated call
    const r = await apiCall("/api/wifi/check-password", "POST", { password });
    if (r.ok) {
      setUnlockedPassword(password);
      setShowUnlockModal(false);
      showMsg(t("wifi_unlocked"), true);
    } else {
      showMsg(r.message || t("wifi_wrong_password"), false);
    }
  };

  const doScan = async () => {
    setScanning(true);
    setNetworks([]);
    const r = await apiCall("/api/wifi/scan");
    if (Array.isArray(r.networks)) setNetworks(r.networks);
    else showMsg(r.message || "Error", false);
    setScanning(false);
  };

  const doConnect = async (ssid: string, wifiPassword: string) => {
    setConnectTarget(null);
    const r = await apiCall("/api/wifi/connect", "POST", { ssid, wifiPassword, password: unlockedPassword });
    showMsg(r.message || (r.ok ? t("wifi_connect") : "Error"), r.ok ?? false);
    if (r.ok) setTimeout(() => { fetchStatus(); fetchSaved(); }, 3000);
  };

  const doDisconnect = async () => {
    const r = await apiCall("/api/wifi/disconnect", "POST", { password: unlockedPassword });
    showMsg(r.message || (r.ok ? t("wifi_disconnect") : "Error"), r.ok ?? false);
    if (r.ok) setTimeout(fetchStatus, 2000);
  };

  const doForget = async (name: string) => {
    const r = await apiCall("/api/wifi/forget", "POST", { name, password: unlockedPassword });
    showMsg(r.message || (r.ok ? t("wifi_forget") : "Error"), r.ok ?? false);
    if (r.ok) { fetchSaved(); setTimeout(fetchStatus, 1000); }
  };

  const panelCls = "bg-card/60 border border-border/60 rounded-lg overflow-hidden";
  const headerCls = "px-4 py-2 bg-black/30 border-b border-border/40 flex items-center gap-2";
  const headerTxt = "text-[10px] font-black tracking-widest text-primary/80 uppercase";

  return (
    <div className="flex-1 p-3 space-y-3 max-w-4xl mx-auto w-full">
      {showUnlockModal && (
        <UnlockModal
          onConfirm={handleUnlock}
          onCancel={() => setShowUnlockModal(false)}
        />
      )}
      {connectTarget && (
        <WifiPasswordModal
          ssid={connectTarget.ssid}
          hasPassword={connectTarget.security !== "--" && connectTarget.security !== ""}
          onConfirm={wp => doConnect(connectTarget.ssid, wp)}
          onCancel={() => setConnectTarget(null)}
        />
      )}

      {/* Lock / unlock bar */}
      <div className={`flex items-center gap-3 px-4 py-2 rounded-lg border ${
        isUnlocked
          ? "bg-emerald-500/8 border-emerald-500/25 text-emerald-400"
          : "bg-amber-500/8 border-amber-500/25 text-amber-400"
      }`}>
        {isUnlocked
          ? <Unlock className="w-3.5 h-3.5 shrink-0" />
          : <Lock className="w-3.5 h-3.5 shrink-0" />
        }
        <span className="text-[10px] font-bold tracking-wider flex-1">
          {isUnlocked ? t("wifi_mode_unlocked") : t("wifi_mode_locked")}
        </span>
        {isUnlocked ? (
          <button
            onClick={() => { setUnlockedPassword(""); showMsg(t("wifi_locked_again"), true); }}
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold rounded bg-red-900/20 text-red-400 border border-red-800/30 hover:bg-red-900/40 transition-colors"
            data-testid="button-wifi-lock"
          >
            <ShieldOff className="w-3 h-3" />
            {t("wifi_lock")}
          </button>
        ) : (
          <button
            onClick={() => setShowUnlockModal(true)}
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold rounded bg-sky-500/20 text-sky-400 border border-sky-500/30 hover:bg-sky-500/30 transition-colors"
            data-testid="button-wifi-unlock"
          >
            <Unlock className="w-3 h-3" />
            {t("wifi_unlock_btn")}
          </button>
        )}
      </div>

      {msg && (
        <div className={`px-4 py-2 rounded text-xs font-bold border ${
          msg.ok
            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
            : "bg-red-500/10 text-red-400 border-red-500/30"
        }`}>
          {msg.text}
        </div>
      )}

      {/* STATUS */}
      <div className={panelCls}>
        <div className={headerCls}>
          <Wifi className="w-3.5 h-3.5 text-primary/70" />
          <span className={headerTxt}>{t("wifi_status")}</span>
          {loadingStatus && <RefreshCw className="w-3 h-3 text-muted-foreground animate-spin ml-1" />}
        </div>
        <div className="p-4 space-y-3">
          {status === null ? (
            <div className="text-xs text-muted-foreground">{t("vpn_loading")}</div>
          ) : status.demo ? (
            <p className="text-xs text-amber-400/80 bg-amber-500/10 border border-amber-500/20 rounded p-3">
              {t("wifi_demo")}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="space-y-1">
                <div className="text-muted-foreground text-[10px] uppercase tracking-wider">{t("wifi_status")}</div>
                <div className={`font-bold ${status.connected ? "text-emerald-400" : "text-red-400"}`}>
                  {status.connected ? (
                    <span className="flex items-center gap-1.5"><Wifi className="w-3.5 h-3.5" />{t("wifi_connected")}</span>
                  ) : (
                    <span className="flex items-center gap-1.5"><WifiOff className="w-3.5 h-3.5" />{t("wifi_not_connected")}</span>
                  )}
                </div>
              </div>
              {status.ssid && (
                <div className="space-y-1">
                  <div className="text-muted-foreground text-[10px] uppercase tracking-wider">{t("wifi_ssid")}</div>
                  <div className="font-mono text-sky-300 font-bold">{status.ssid}</div>
                </div>
              )}
              {status.ip && (
                <div className="space-y-1">
                  <div className="text-muted-foreground text-[10px] uppercase tracking-wider">{t("wifi_ip")}</div>
                  <div className="font-mono text-foreground">{status.ip}</div>
                </div>
              )}
              {status.signal !== undefined && (
                <div className="space-y-1">
                  <div className="text-muted-foreground text-[10px] uppercase tracking-wider">{t("wifi_signal")}</div>
                  <SignalBars signal={status.signal} />
                </div>
              )}
              {status.interface && (
                <div className="space-y-1">
                  <div className="text-muted-foreground text-[10px] uppercase tracking-wider">{t("wifi_interface")}</div>
                  <div className="font-mono text-foreground">{status.interface}</div>
                </div>
              )}
              {status.security && (
                <div className="space-y-1">
                  <div className="text-muted-foreground text-[10px] uppercase tracking-wider">{t("wifi_security")}</div>
                  <div className="text-foreground">{status.security}</div>
                </div>
              )}
            </div>
          )}
          <div className="flex gap-2 pt-1">
            {isUnlocked && status?.connected && !status?.demo && (
              <button
                onClick={doDisconnect}
                className="px-3 py-1.5 text-xs font-bold rounded bg-red-900/20 text-red-400 border border-red-800/30 hover:bg-red-900/40 transition-colors"
                data-testid="button-wifi-disconnect"
              >
                {t("wifi_disconnect")}
              </button>
            )}
            <button
              onClick={fetchStatus}
              className="px-3 py-1.5 text-xs font-bold rounded bg-sky-500/20 text-sky-400 border border-sky-500/30 hover:bg-sky-500/30 transition-colors"
              data-testid="button-wifi-refresh"
            >
              {t("wifi_refresh")}
            </button>
          </div>
        </div>
      </div>

      {/* AVAILABLE NETWORKS */}
      {!status?.demo && (
        <div className={panelCls}>
          <div className={headerCls}>
            <Signal className="w-3.5 h-3.5 text-primary/70" />
            <span className={headerTxt}>{t("wifi_networks")}</span>
            <button
              onClick={doScan}
              disabled={scanning}
              className="ml-auto px-3 py-1 text-[10px] font-bold rounded bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-colors disabled:opacity-40"
              data-testid="button-wifi-scan"
            >
              {scanning ? t("wifi_scanning") : t("wifi_scan")}
            </button>
          </div>
          <div className="divide-y divide-border/30">
            {networks.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                {scanning ? t("wifi_scanning") : t("wifi_no_networks")}
              </div>
            ) : (
              networks.map((net, i) => (
                <div key={`${net.ssid}-${i}`} className="px-4 py-2">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-foreground truncate">{net.ssid || "(hidden)"}</span>
                        {net.active && (
                          <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                            {t("wifi_active")}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <SignalBars signal={net.signal} />
                        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                          {net.security === "--" || net.security === "" ? (
                            <><Unlock className="w-2.5 h-2.5" />{t("wifi_open")}</>
                          ) : (
                            <><Lock className="w-2.5 h-2.5" />{net.security}</>
                          )}
                        </span>
                        {net.freq && <span className="text-[10px] text-muted-foreground">{net.freq}</span>}
                      </div>
                    </div>
                    {isUnlocked && !net.active && net.ssid && (
                      <button
                        onClick={() => setConnectTarget(net)}
                        className="px-3 py-1 text-[10px] font-bold rounded bg-sky-500/20 text-sky-400 border border-sky-500/30 hover:bg-sky-500/30 transition-colors shrink-0"
                        data-testid={`button-wifi-connect-${net.ssid}`}
                      >
                        {t("wifi_connect")}
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* SAVED NETWORKS */}
      {!status?.demo && (
        <div className={panelCls}>
          <div className={headerCls}>
            <Lock className="w-3.5 h-3.5 text-primary/70" />
            <span className={headerTxt}>{t("wifi_saved")}</span>
            <button
              onClick={fetchSaved}
              className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
              data-testid="button-wifi-refresh-saved"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          </div>
          <div className="divide-y divide-border/30">
            {saved.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-muted-foreground">{t("wifi_no_saved")}</div>
            ) : (
              saved.map((net, i) => (
                <div key={`${net.name}-${i}`} className="px-4 py-2 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-foreground truncate">{net.name}</div>
                    <div className="text-[10px] text-muted-foreground">{net.type}</div>
                  </div>
                  {isUnlocked && (
                    <button
                      onClick={() => doForget(net.name)}
                      className="px-3 py-1 text-[10px] font-bold rounded bg-red-900/20 text-red-400 border border-red-800/30 hover:bg-red-900/40 transition-colors shrink-0"
                      data-testid={`button-wifi-forget-${net.name}`}
                    >
                      {t("wifi_forget")}
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
