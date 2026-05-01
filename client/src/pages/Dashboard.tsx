import { useTetraWebSocket, type Terminal, type CallLogEntry, type SdsMessage } from "../hooks/useTetraWebSocket";
import { useState, useEffect, useRef } from "react";
import { Radio, Wifi, WifiOff, ArrowUpFromLine, ArrowDownToLine, Power, RotateCcw, Cpu, Thermometer, MemoryStick, Lock, RefreshCw, MessageSquare, ArrowUp, ArrowDown, MapPin, Navigation, Globe, Zap, Network } from "lucide-react";
import { getCountryCode, getFlagEmoji } from "@/lib/callsignFlags";
import { useI18n } from "@/lib/i18n";
import tetraLogo from "@assets/tetra_1771538916537.png";

function Clock() {
  const [time, setTime] = useState(new Date().toLocaleTimeString("en-GB"));
  useEffect(() => {
    const interval = setInterval(() => setTime(new Date().toLocaleTimeString("en-GB")), 1000);
    return () => clearInterval(interval);
  }, []);
  return <span data-testid="text-clock">{time}</span>;
}

function ActivityBadge({ activity, timeSlot }: { activity?: "TX" | "RX" | null; timeSlot?: number | null }) {
  if (!activity) return null;
  const tsLabel = timeSlot != null ? ` TS${timeSlot}` : "";
  if (activity === "TX") {
    return (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded bg-red-500/20 text-red-400 border border-red-500/30 animate-pulse"
        data-testid="badge-tx"
      >
        <ArrowUpFromLine className="w-3 h-3" />
        TX{tsLabel}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 animate-pulse"
      data-testid="badge-rx"
    >
      <ArrowDownToLine className="w-3 h-3" />
      RX{tsLabel}
    </span>
  );
}

function CountryFlag({ callsign }: { callsign?: string }) {
  if (!callsign) return null;
  const cc = getCountryCode(callsign);
  if (!cc) return null;
  return (
    <span
      className="text-base leading-none select-none"
      title={cc.toUpperCase()}
      data-testid={`flag-${cc}`}
      aria-label={cc.toUpperCase()}
    >
      {getFlagEmoji(cc)}
    </span>
  );
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    Online: "bg-emerald-400 shadow-emerald-400/50",
    Offline: "bg-gray-500",
    External: "bg-amber-400 shadow-amber-400/50",
  };
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block w-2 h-2 rounded-full ${colors[status] || "bg-gray-500"} ${status !== "Offline" ? "shadow-[0_0_6px]" : ""}`} />
      <span className={`text-xs ${status === "Online" ? "text-emerald-400" : status === "External" ? "text-amber-400" : "text-gray-500"}`}>
        {status}
      </span>
    </span>
  );
}

function TerminalRow({ t: terminal }: { t: Terminal }) {
  const selectedNum = terminal.selectedTg.replace("TG ", "");
  const rowBg = terminal.activity === "TX"
    ? "bg-red-500/10 border-l-2 border-l-red-500"
    : terminal.activity === "RX"
    ? "bg-emerald-500/10 border-l-2 border-l-emerald-500"
    : "border-l-2 border-l-transparent";

  const scanItems = terminal.groups.map((g) => {
    if (g === selectedNum) {
      return <span key={g} className="text-primary font-bold">[{g}]</span>;
    }
    return <span key={g} className="text-muted-foreground">{g}</span>;
  });

  return (
    <tr
      key={terminal.id}
      className={`${rowBg} transition-colors duration-300`}
      data-testid={`row-terminal-${terminal.id}`}
    >
      <td className="px-2 sm:px-3 py-1.5 text-center w-10 sm:w-16">
        <ActivityBadge activity={terminal.activity} timeSlot={terminal.timeSlot} />
      </td>
      <td className="px-2 sm:px-3 py-1.5 min-w-0 sm:min-w-[240px]">
        <span className="inline-flex items-center gap-1 sm:gap-1.5 flex-wrap">
          <span className="text-primary font-mono font-semibold text-xs sm:text-sm">{terminal.id}</span>
          {terminal.callsign ? (
            <>
              <CountryFlag callsign={terminal.callsign} />
              <span className="text-foreground font-bold text-xs sm:text-sm">({terminal.callsign})</span>
            </>
          ) : null}
        </span>
      </td>
      <td className="px-2 sm:px-3 py-1.5">
        <span className="text-amber-400 font-semibold font-mono text-xs sm:text-sm">{terminal.selectedTg}</span>
      </td>
      <td className="px-2 sm:px-3 py-1.5 hidden sm:table-cell">
        <StatusDot status={terminal.status} />
      </td>
      <td className="px-2 sm:px-3 py-1.5 font-mono text-xs hidden sm:table-cell">
        {scanItems.length > 0 ? (
          <span className="flex items-center gap-0.5 flex-wrap">
            [{scanItems.reduce<React.ReactNode[]>((acc, item, i) => {
              if (i > 0) acc.push(<span key={`sep-${i}`}>, </span>);
              acc.push(item);
              return acc;
            }, [])}]
          </span>
        ) : (
          <span className="text-muted-foreground/50">---</span>
        )}
      </td>
      <td className="px-2 sm:px-3 py-1.5 text-right text-xs text-muted-foreground font-mono hidden md:table-cell">{terminal.lastSeen}</td>
    </tr>
  );
}

function TerminalTable({ terminals, title, icon, isLocal }: {
  terminals: Terminal[];
  title: string;
  icon: "local" | "external";
  isLocal: boolean;
}) {
  const { t } = useI18n();
  const activityRank = (activity?: string) =>
    activity === "TX" ? 2 : activity === "RX" ? 1 : 0;

  // Stable insertion-order map: assign each terminal a fixed position when
  // it first appears. Terminals only change row when their activity rank
  // changes (idle ↔ TX/RX), never just because lastSeen was updated.
  const insertionOrder = useRef<Map<string, number>>(new Map());
  const insertionCounter = useRef(0);
  terminals.forEach(term => {
    if (!insertionOrder.current.has(term.id)) {
      insertionOrder.current.set(term.id, insertionCounter.current++);
    }
  });

  const sorted = terminals
    .filter(term => term.isLocal === isLocal)
    .sort((a, b) => {
      const rankDiff = activityRank(b.activity) - activityRank(a.activity);
      if (rankDiff !== 0) return rankDiff;
      // Within same activity rank use first-seen order (stable, no jumps)
      const orderA = insertionOrder.current.get(a.id) ?? 0;
      const orderB = insertionOrder.current.get(b.id) ?? 0;
      return orderA - orderB;
    });

  return (
    <div
      className="glass-panel rounded-md overflow-hidden"
      data-testid={`panel-${isLocal ? 'local' : 'external'}-terminals`}
    >
      <div className={`flex items-center gap-2 px-4 py-2 border-b border-white/5 ${isLocal ? "bg-primary/5" : "bg-amber-500/5"}`}>
        {icon === "local" ? (
          <Radio className={`w-4 h-4 ${isLocal ? "text-primary" : "text-amber-400"}`} />
        ) : (
          <Wifi className={`w-4 h-4 text-amber-400`} />
        )}
        <h2 className={`text-xs font-bold tracking-[0.15em] uppercase ${isLocal ? "text-primary" : "text-amber-400"}`}>
          {title}
        </h2>
        <span className="ml-auto text-[10px] text-muted-foreground font-mono">
          {sorted.length} {sorted.length === 1 ? t("terminal_one") : t("terminal_other")}
        </span>
      </div>
      <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
        <table className="w-full text-sm" data-testid={`table-${isLocal ? 'local' : 'external'}-terminals`}>
          <thead>
            <tr className="text-muted-foreground text-xs border-b border-white/5">
              <th className="text-center px-2 sm:px-3 py-2 w-10 sm:w-16 font-medium">{t("th_act")}</th>
              <th className="text-left px-2 sm:px-3 py-2 font-medium">{t("th_terminal_call")}</th>
              <th className="text-left px-2 sm:px-3 py-2 font-medium">{t("th_selected")}</th>
              <th className="text-left px-2 sm:px-3 py-2 font-medium hidden sm:table-cell">{t("th_status")}</th>
              <th className="text-left px-2 sm:px-3 py-2 font-medium hidden sm:table-cell">{t("th_scanlist")}</th>
              <th className="text-right px-2 sm:px-3 py-2 font-medium hidden md:table-cell">{t("th_seen")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.03]">
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-8 text-muted-foreground/50 text-xs">
                  {t("no_active_terminals")}
                </td>
              </tr>
            ) : (
              sorted.map(terminal => <TerminalRow key={terminal.id} t={terminal} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CallHistory({ entries, title, isLocal }: {
  entries: CallLogEntry[];
  title: string;
  isLocal: boolean;
}) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <div
      className="glass-panel rounded-md overflow-hidden flex flex-col flex-1 min-w-0"
      data-testid={`panel-${isLocal ? 'local' : 'external'}-history`}
    >
      <div className={`flex items-center gap-2 px-4 py-2 border-b border-white/5 ${isLocal ? "bg-primary/5" : "bg-amber-500/5"}`}>
        <span className={`text-xs font-bold tracking-[0.15em] uppercase ${isLocal ? "text-primary" : "text-amber-400"}`}>
          {title}
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground font-mono">
          {entries.length} {entries.length === 1 ? t("entry_one") : t("entry_other")}
        </span>
      </div>
      <div
        ref={scrollRef}
        className="overflow-y-auto flex-1 p-2 sm:p-3 font-mono text-xs sm:text-sm min-h-[150px] max-h-[300px] space-y-0.5"
      >
        {entries.length === 0 ? (
          <div className="text-muted-foreground/50 text-center py-8 text-xs">{t("no_calls_logged")}</div>
        ) : (
          entries.map((entry, i) => (
            <div
              key={entry.id}
              className={`py-0.5 px-1.5 sm:px-2 rounded transition-colors duration-500 whitespace-normal sm:whitespace-nowrap ${
                i === 0 && entry.activity === "TX" ? "bg-red-500/10" : ""
              }`}
              data-testid={`log-entry-${entry.id}`}
            >
              <span className="text-muted-foreground">[{entry.timestamp}]</span>{" "}
              <span className="text-primary">{entry.sourceId}</span>
              {entry.sourceCallsign ? (
                <span className="inline-flex items-center gap-1 align-middle">
                  {" "}<CountryFlag callsign={entry.sourceCallsign} />
                  <span className="text-foreground font-semibold">({entry.sourceCallsign})</span>
                </span>
              ) : null}
              <span className="text-muted-foreground/60"> {">"} </span>
              <span className="text-amber-400 font-semibold">TG {entry.targetTg}</span>
              {entry.timeSlot != null ? (
                <span className="text-cyan-400/80 text-[10px] ml-1">TS{entry.timeSlot}</span>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function PiStats() {
  const { t } = useI18n();
  const [stats, setStats] = useState<{
    cpuTemp: number | null;
    cpuLoad: number | null;
    memUsed: number | null;
    localIp: string | null;
    publicIp: string | null;
    voltage: number | null;
  }>({
    cpuTemp: null, cpuLoad: null, memUsed: null, localIp: null, publicIp: null, voltage: null
  });

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch("/api/system/stats");
        const data = await res.json();
        setStats(data);
      } catch {}
    };
    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, []);

  const tempColor = stats.cpuTemp !== null
    ? stats.cpuTemp >= 70 ? "text-red-400" : stats.cpuTemp >= 55 ? "text-amber-400" : "text-emerald-400"
    : "text-muted-foreground";

  const loadColor = stats.cpuLoad !== null
    ? stats.cpuLoad >= 80 ? "text-red-400" : stats.cpuLoad >= 50 ? "text-amber-400" : "text-emerald-400"
    : "text-muted-foreground";

  const memColor = stats.memUsed !== null
    ? stats.memUsed >= 85 ? "text-red-400" : stats.memUsed >= 60 ? "text-amber-400" : "text-emerald-400"
    : "text-muted-foreground";

  const voltageColor = stats.voltage !== null
    ? stats.voltage < 4.8 ? "text-red-400" : stats.voltage < 4.9 ? "text-amber-400" : "text-emerald-400"
    : "text-muted-foreground";

  return (
    <div className="flex items-center gap-3 flex-wrap" data-testid="pi-stats">
      <span className={`inline-flex items-center gap-1 text-xs font-mono ${loadColor}`} title={t("cpu_load")} data-testid="stat-cpu-load">
        <Cpu className="w-3.5 h-3.5" />
        {stats.cpuLoad !== null ? `${stats.cpuLoad}%` : "--"}
      </span>
      <span className={`inline-flex items-center gap-1 text-xs font-mono ${tempColor}`} title={t("cpu_temp")} data-testid="stat-cpu-temp">
        <Thermometer className="w-3.5 h-3.5" />
        {stats.cpuTemp !== null ? `${stats.cpuTemp}°C` : "--"}
      </span>
      <span className={`inline-flex items-center gap-1 text-xs font-mono ${memColor}`} title={t("ram_memory")} data-testid="stat-mem-used">
        <MemoryStick className="w-3.5 h-3.5" />
        {stats.memUsed !== null ? `${stats.memUsed}%` : "--"}
      </span>
      <span className={`inline-flex items-center gap-1 text-xs font-mono ${voltageColor}`} title={t("voltage")} data-testid="stat-voltage">
        <Zap className="w-3.5 h-3.5" />
        {stats.voltage !== null ? `${stats.voltage.toFixed(2)}V` : "--"}
      </span>
      {stats.localIp && (
        <span className="inline-flex items-center gap-1 text-xs font-mono text-sky-400" title={t("local_ip")} data-testid="stat-local-ip">
          <Network className="w-3.5 h-3.5" />
          {stats.localIp}
        </span>
      )}
      {stats.publicIp && (
        <span className="inline-flex items-center gap-1 text-xs font-mono text-violet-400" title={t("public_ip")} data-testid="stat-public-ip">
          <Globe className="w-3.5 h-3.5" />
          {stats.publicIp}
        </span>
      )}
    </div>
  );
}

const SERVICE_STORAGE_KEY = "tetra_restart_service";

function getStoredRestartService(): string {
  try {
    return localStorage.getItem(SERVICE_STORAGE_KEY) || "tmo.service";
  } catch {
    return "tmo.service";
  }
}

function SystemControls() {
  const { t } = useI18n();
  const [confirmAction, setConfirmAction] = useState<"shutdown" | "reboot" | "restart-service" | null>(null);
  const [password, setPassword] = useState("");
  const [serviceName, setServiceName] = useState(getStoredRestartService);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const executeAction = async (action: "shutdown" | "reboot" | "restart-service") => {
    let url: string;
    let body: Record<string, string>;

    if (action === "restart-service") {
      if (!serviceName.trim()) {
        setError(t("restart_service_name"));
        return;
      }
      url = "/api/system/restart-service";
      body = { password, serviceName: serviceName.trim() };
      try { localStorage.setItem(SERVICE_STORAGE_KEY, serviceName.trim()); } catch {}
    } else {
      url = action === "shutdown" ? "/api/system/shutdown" : "/api/system/reboot";
      body = { password };
    }

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Error");
        setTimeout(() => setError(null), 3000);
        return;
      }
      setStatus(action === "restart-service"
        ? t("restarting_service").replace("{service}", serviceName.trim())
        : data.message);
      setConfirmAction(null);
      setPassword("");
    } catch {
      setStatus(t("connection_error"));
    }
    setTimeout(() => setStatus(null), 5000);
  };

  const cancel = () => {
    setConfirmAction(null);
    setPassword("");
    setError(null);
  };

  if (status) {
    return (
      <span className="text-xs text-amber-400 font-semibold animate-pulse" data-testid="text-system-status">
        {status}
      </span>
    );
  }

  if (confirmAction) {
    const actionLabel = confirmAction === "shutdown"
      ? t("confirm_shutdown")
      : confirmAction === "reboot"
      ? t("confirm_reboot")
      : t("confirm_restart_service");

    return (
      <div className="flex items-center gap-2 flex-wrap" data-testid="confirm-system-action">
        <Lock className="w-3 h-3 text-amber-400" />
        <span className="text-xs text-amber-400 hidden sm:inline">
          {actionLabel}
        </span>
        {confirmAction === "restart-service" && (
          <input
            type="text"
            value={serviceName}
            onChange={(e) => setServiceName(e.target.value)}
            placeholder="tmo.service"
            className="w-28 px-2 py-0.5 text-[10px] rounded bg-black/30 border border-white/10 text-foreground font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:border-cyan-500/50"
            data-testid="input-service-name"
          />
        )}
        <input
          type="password"
          value={password}
          onChange={(e) => { setPassword(e.target.value); setError(null); }}
          onKeyDown={(e) => e.key === "Enter" && password && executeAction(confirmAction)}
          placeholder={t("password")}
          className="w-24 px-2 py-0.5 text-[10px] rounded bg-black/30 border border-white/10 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-amber-500/50"
          autoFocus={confirmAction !== "restart-service"}
          data-testid="input-password"
        />
        <button
          onClick={() => executeAction(confirmAction)}
          disabled={!password}
          className="px-2 py-0.5 text-[10px] font-bold rounded bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors disabled:opacity-30"
          data-testid="button-confirm-action"
        >
          {t("ok")}
        </button>
        <button
          onClick={cancel}
          className="px-2 py-0.5 text-[10px] font-bold rounded bg-white/5 text-muted-foreground border border-white/10 hover:bg-white/10 transition-colors"
          data-testid="button-cancel-action"
        >
          ✕
        </button>
        {error && <span className="text-[10px] text-red-400 animate-pulse" data-testid="text-password-error">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5" data-testid="system-controls">
      <button
        onClick={() => setConfirmAction("restart-service")}
        className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20 transition-colors"
        title={t("confirm_restart_service")}
        data-testid="button-restart-service"
      >
        <RefreshCw className="w-3 h-3" />
        <span className="hidden sm:inline">{t("restart_service")}</span>
      </button>
      <button
        onClick={() => setConfirmAction("reboot")}
        className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 transition-colors"
        title={t("confirm_reboot")}
        data-testid="button-reboot"
      >
        <RotateCcw className="w-3 h-3" />
        <span className="hidden sm:inline">{t("reboot")}</span>
      </button>
      <button
        onClick={() => setConfirmAction("shutdown")}
        className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold rounded bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
        title={t("confirm_shutdown")}
        data-testid="button-shutdown"
      >
        <Power className="w-3 h-3" />
        <span className="hidden sm:inline">{t("shutdown")}</span>
      </button>
    </div>
  );
}

function SdsPanel({ messages }: { messages: SdsMessage[] }) {
  const { t } = useI18n();
  return (
    <div
      className="glass-panel rounded-md overflow-hidden"
      data-testid="panel-sds-messages"
    >
      <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5 bg-violet-500/5">
        <MessageSquare className="w-4 h-4 text-violet-400" />
        <h2 className="text-xs font-bold tracking-[0.15em] uppercase text-violet-400">
          {t("sds_messages")}
        </h2>
        <span className="ml-auto text-[10px] text-muted-foreground font-mono">
          {messages.length} {messages.length === 1 ? t("sds_messages_count_one") : t("sds_messages_count_other")}
        </span>
      </div>
      <div className="overflow-y-auto max-h-[220px] font-mono text-xs p-2 sm:p-3 space-y-0.5">
        {messages.length === 0 ? (
          <div className="text-muted-foreground/50 text-center py-6 text-xs">
            {t("sds_no_messages")}
          </div>
        ) : (
          messages.map((msg) => {
            const isStatus = msg.messageType === "status";
            const isOut = msg.direction === "outgoing";
            const hasContent = !!(msg.textContent || msg.lipData);
            const rowBg = isStatus
              ? "bg-amber-500/5"
              : isOut ? "bg-cyan-500/5" : "bg-emerald-500/5";
            return (
              <div
                key={msg.id}
                className={`flex flex-col py-0.5 px-1.5 rounded ${rowBg} ${hasContent ? "pb-1" : ""}`}
                data-testid={`sds-entry-${msg.id}`}
              >
                {/* Main info row */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-muted-foreground shrink-0">[{msg.timestamp}]</span>
                  {isStatus ? (
                    <span className="inline-flex items-center gap-0.5 px-1 py-0.5 text-[9px] font-bold rounded shrink-0 bg-amber-500/20 text-amber-400 border border-amber-500/30">
                      <MessageSquare className="w-2.5 h-2.5" />
                      {t("sds_status")}
                    </span>
                  ) : (
                    <span
                      className={`inline-flex items-center gap-0.5 px-1 py-0.5 text-[9px] font-bold rounded shrink-0 ${
                        isOut
                          ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                          : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                      }`}
                    >
                      {isOut ? <ArrowUp className="w-2.5 h-2.5" /> : <ArrowDown className="w-2.5 h-2.5" />}
                      {isOut ? t("sds_out") : t("sds_in")}
                    </span>
                  )}
                  <span className="text-primary shrink-0">{msg.srcIssi}</span>
                  {msg.srcCallsign && (
                    <span className="inline-flex items-center gap-1 shrink-0">
                      <CountryFlag callsign={msg.srcCallsign} />
                      <span className="text-foreground/70">({msg.srcCallsign})</span>
                    </span>
                  )}
                  <span className="text-muted-foreground/60 shrink-0">{"→"}</span>
                  <span className="text-amber-400 shrink-0">{msg.dstIssi}</span>
                  {msg.dstCallsign && (
                    <span className="inline-flex items-center gap-1 shrink-0">
                      <CountryFlag callsign={msg.dstCallsign} />
                      <span className="text-foreground/70">({msg.dstCallsign})</span>
                    </span>
                  )}
                  {isStatus && msg.statusCode ? (
                    <span className="ml-auto text-amber-300/80 shrink-0 text-[9px] font-mono">
                      {msg.statusCode}
                    </span>
                  ) : (
                    <span className="ml-auto text-muted-foreground/50 shrink-0 text-[9px]">
                      T{msg.sdsType} · {msg.size}{msg.sizeUnit === "bits" ? "b" : "B"}
                    </span>
                  )}
                </div>

                {/* Text content line */}
                {msg.textContent && (
                  <div className="flex items-start gap-1 mt-0.5 pl-1">
                    <MessageSquare className="w-2.5 h-2.5 mt-0.5 shrink-0 text-violet-400" />
                    <span className="text-[10px] text-violet-300 break-all leading-tight">{msg.textContent}</span>
                  </div>
                )}

                {/* GPS / LIP line */}
                {msg.lipData && (
                  <div className="flex items-center gap-1 mt-0.5 pl-1 flex-wrap">
                    <MapPin className="w-2.5 h-2.5 shrink-0 text-cyan-400" />
                    <span className="text-[10px] text-cyan-300 font-mono">
                      {msg.lipData.lat.toFixed(5)}°, {msg.lipData.lon.toFixed(5)}°
                      {msg.lipData.speed !== undefined && (
                        <span className="ml-1 text-muted-foreground/70">
                          <Navigation className="w-2 h-2 inline mr-0.5" />
                          {msg.lipData.speed} km/h
                          {msg.lipData.heading !== undefined && ` · ${msg.lipData.heading}°`}
                        </span>
                      )}
                    </span>
                    <a
                      href={`https://maps.google.com/?q=${msg.lipData.lat},${msg.lipData.lon}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[9px] text-cyan-500 hover:text-cyan-300 underline ml-1"
                      data-testid={`sds-gps-link-${msg.id}`}
                    >
                      Maps ↗
                    </a>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { t } = useI18n();
  const { terminals, localHistory, externalHistory, sdsMessages, connected } = useTetraWebSocket();
  const terminalList = Object.values(terminals);

  const txCount = terminalList.filter(t => t.activity === "TX").length;
  const rxCount = terminalList.filter(t => t.activity === "RX").length;

  return (
    <div className="flex-1 bg-background text-foreground font-sans flex flex-col">
      <header
        className="bg-card border-b border-border px-3 sm:px-4 py-2 sticky top-0 z-50"
        data-testid="header-bar"
      >
        <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <img src={tetraLogo} alt="TETRA" className="h-6 sm:h-7 w-auto" data-testid="img-logo" />
            <h1 className="text-xs sm:text-sm font-bold tracking-wide text-foreground" data-testid="text-title">
              {t("live_monitor")}
            </h1>
          </div>

          <span className="text-muted-foreground text-xs hidden sm:inline">|</span>
          <span className="text-foreground font-mono text-xs sm:text-sm font-semibold"><Clock /></span>

          <div className="flex items-center gap-2 sm:gap-3 ml-auto">
            <span className="hidden md:flex"><PiStats /></span>

            <span className="text-muted-foreground/30 text-xs hidden md:inline">|</span>

            <SystemControls />

            <span className="text-muted-foreground/30 text-xs hidden sm:inline">|</span>

            {txCount > 0 && (
              <span className="inline-flex items-center gap-1 text-xs text-red-400 font-semibold" data-testid="status-tx-count">
                <ArrowUpFromLine className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{txCount}</span> TX
              </span>
            )}
            {rxCount > 0 && (
              <span className="inline-flex items-center gap-1 text-xs text-emerald-400 font-semibold" data-testid="status-rx-count">
                <ArrowDownToLine className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{rxCount}</span> RX
              </span>
            )}

            <span className="inline-flex items-center gap-1.5" data-testid="status-connection">
              {connected ? (
                <Wifi className="w-4 h-4 text-emerald-400" />
              ) : (
                <WifiOff className="w-4 h-4 text-red-400" />
              )}
              <span className={`text-xs font-medium hidden sm:inline ${connected ? "text-emerald-400" : "text-red-400"}`} data-testid="text-connection-status">
                {connected ? t("connected") : t("disconnected")}
              </span>
            </span>
          </div>
        </div>

        <div className="flex md:hidden items-center gap-3 mt-1.5 pt-1.5 border-t border-white/5">
          <PiStats />
        </div>
      </header>

      <main className="flex-1 p-2 sm:p-3 flex flex-col gap-2 sm:gap-3 overflow-auto">
        <TerminalTable
          terminals={terminalList}
          title={t("local_terminals")}
          icon="local"
          isLocal={true}
        />

        <TerminalTable
          terminals={terminalList}
          title={t("external_terminals")}
          icon="external"
          isLocal={false}
        />

        <div className="flex flex-col md:flex-row gap-3 flex-1">
          <CallHistory
            entries={localHistory}
            title={t("local_history")}
            isLocal={true}
          />
          <CallHistory
            entries={externalHistory}
            title={t("external_history")}
            isLocal={false}
          />
        </div>

        <SdsPanel messages={sdsMessages} />
      </main>
    </div>
  );
}
