import { useTetraWebSocket, type Terminal, type CallLogEntry } from "../hooks/useTetraWebSocket";
import { useState, useEffect, useRef } from "react";
import { Radio, Wifi, WifiOff, ArrowUpFromLine, ArrowDownToLine } from "lucide-react";
import { getCountryCode, getFlagUrl } from "@/lib/callsignFlags";
import tetraLogo from "@assets/tetra_1771538916537.png";

function Clock() {
  const [time, setTime] = useState(new Date().toLocaleTimeString("en-GB"));
  useEffect(() => {
    const interval = setInterval(() => setTime(new Date().toLocaleTimeString("en-GB")), 1000);
    return () => clearInterval(interval);
  }, []);
  return <span data-testid="text-clock">{time}</span>;
}

function ActivityBadge({ activity }: { activity?: "TX" | "RX" | null }) {
  if (!activity) return null;
  if (activity === "TX") {
    return (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded bg-red-500/20 text-red-400 border border-red-500/30 animate-pulse"
        data-testid="badge-tx"
      >
        <ArrowUpFromLine className="w-3 h-3" />
        TX
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 animate-pulse"
      data-testid="badge-rx"
    >
      <ArrowDownToLine className="w-3 h-3" />
      RX
    </span>
  );
}

function CountryFlag({ callsign }: { callsign?: string }) {
  if (!callsign) return null;
  const cc = getCountryCode(callsign);
  if (!cc) return null;
  return (
    <img
      src={getFlagUrl(cc)}
      alt={cc.toUpperCase()}
      className="inline-block w-5 h-auto rounded-[2px] shadow-sm shadow-black/30"
      loading="lazy"
      data-testid={`flag-${cc}`}
    />
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

function TerminalRow({ t }: { t: Terminal }) {
  const selectedNum = t.selectedTg.replace("TG ", "");
  const rowBg = t.activity === "TX"
    ? "bg-red-500/10 border-l-2 border-l-red-500"
    : t.activity === "RX"
    ? "bg-emerald-500/10 border-l-2 border-l-emerald-500"
    : "border-l-2 border-l-transparent";

  const scanItems = t.groups.map((g) => {
    if (g === selectedNum) {
      return <span key={g} className="text-primary font-bold">[{g}]</span>;
    }
    return <span key={g} className="text-muted-foreground">{g}</span>;
  });

  return (
    <tr
      key={t.id}
      className={`${rowBg} transition-colors duration-300`}
      data-testid={`row-terminal-${t.id}`}
    >
      <td className="px-3 py-1.5 text-center w-16">
        <ActivityBadge activity={t.activity} />
      </td>
      <td className="px-3 py-1.5 min-w-[240px]">
        <span className="inline-flex items-center gap-1.5">
          <span className="text-primary font-mono font-semibold">{t.id}</span>
          {t.callsign ? (
            <>
              <CountryFlag callsign={t.callsign} />
              <span className="text-foreground font-bold">({t.callsign})</span>
            </>
          ) : null}
        </span>
      </td>
      <td className="px-3 py-1.5">
        <span className="text-amber-400 font-semibold font-mono">{t.selectedTg}</span>
      </td>
      <td className="px-3 py-1.5">
        <StatusDot status={t.status} />
      </td>
      <td className="px-3 py-1.5 font-mono text-xs">
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
      <td className="px-3 py-1.5 text-right text-xs text-muted-foreground font-mono">{t.lastSeen}</td>
    </tr>
  );
}

function TerminalTable({ terminals, title, icon, isLocal }: {
  terminals: Terminal[];
  title: string;
  icon: "local" | "external";
  isLocal: boolean;
}) {
  const filtered = terminals
    .filter(t => t.isLocal === isLocal)
    .sort((a, b) => {
      if (a.activity === "TX") return -1;
      if (b.activity === "TX") return 1;
      if (a.activity === "RX" && !b.activity) return -1;
      if (b.activity === "RX" && !a.activity) return 1;
      return a.id.localeCompare(b.id);
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
          {filtered.length} {filtered.length === 1 ? "terminal" : "terminales"}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid={`table-${isLocal ? 'local' : 'external'}-terminals`}>
          <thead>
            <tr className="text-muted-foreground text-xs border-b border-white/5">
              <th className="text-center px-3 py-2 w-16 font-medium">ACT</th>
              <th className="text-left px-3 py-2 font-medium">TERMINAL (CALL)</th>
              <th className="text-left px-3 py-2 font-medium">SELECTED</th>
              <th className="text-left px-3 py-2 font-medium">STATUS</th>
              <th className="text-left px-3 py-2 font-medium">SCANLIST</th>
              <th className="text-right px-3 py-2 font-medium">SEEN</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.03]">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-8 text-muted-foreground/50 text-xs">
                  Sin terminales activos
                </td>
              </tr>
            ) : (
              filtered.map(t => <TerminalRow key={t.id} t={t} />)
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
          {entries.length} {entries.length === 1 ? "entrada" : "entradas"}
        </span>
      </div>
      <div
        ref={scrollRef}
        className="overflow-y-auto flex-1 p-3 font-mono text-sm min-h-[180px] max-h-[300px] space-y-0.5"
      >
        {entries.length === 0 ? (
          <div className="text-muted-foreground/50 text-center py-8 text-xs">Sin llamadas registradas</div>
        ) : (
          entries.map((entry, i) => (
            <div
              key={entry.id}
              className={`py-0.5 px-2 rounded transition-colors duration-500 whitespace-nowrap ${
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
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { terminals, localHistory, externalHistory, connected } = useTetraWebSocket();
  const terminalList = Object.values(terminals);

  const txCount = terminalList.filter(t => t.activity === "TX").length;
  const rxCount = terminalList.filter(t => t.activity === "RX").length;

  return (
    <div className="min-h-screen bg-background text-foreground font-sans flex flex-col">
      <header
        className="bg-card border-b border-border px-4 py-2 flex items-center gap-4 flex-wrap sticky top-0 z-50"
        data-testid="header-bar"
      >
        <div className="flex items-center gap-2">
          <img src={tetraLogo} alt="TETRA" className="h-7 w-auto" data-testid="img-logo" />
          <h1 className="text-sm font-bold tracking-wide text-foreground" data-testid="text-title">
            LIVE MONITOR
          </h1>
        </div>

        <span className="text-muted-foreground text-xs">|</span>
        <span className="text-foreground font-mono text-sm font-semibold"><Clock /></span>

        <div className="flex items-center gap-3 ml-auto">
          {txCount > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-red-400 font-semibold" data-testid="status-tx-count">
              <ArrowUpFromLine className="w-3.5 h-3.5" />
              {txCount} TX
            </span>
          )}
          {rxCount > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-400 font-semibold" data-testid="status-rx-count">
              <ArrowDownToLine className="w-3.5 h-3.5" />
              {rxCount} RX
            </span>
          )}

          <span className="inline-flex items-center gap-1.5" data-testid="status-connection">
            {connected ? (
              <Wifi className="w-4 h-4 text-emerald-400" />
            ) : (
              <WifiOff className="w-4 h-4 text-red-400" />
            )}
            <span className={`text-xs font-medium ${connected ? "text-emerald-400" : "text-red-400"}`} data-testid="text-connection-status">
              {connected ? "CONECTADO" : "DESCONECTADO"}
            </span>
          </span>
        </div>
      </header>

      <main className="flex-1 p-3 flex flex-col gap-3 overflow-auto">
        <TerminalTable
          terminals={terminalList}
          title="TERMINALES LOCALES"
          icon="local"
          isLocal={true}
        />

        <TerminalTable
          terminals={terminalList}
          title="TERMINALES EXTERNOS"
          icon="external"
          isLocal={false}
        />

        <div className="flex flex-col md:flex-row gap-3 flex-1">
          <CallHistory
            entries={localHistory}
            title="HISTORIAL LOCAL"
            isLocal={true}
          />
          <CallHistory
            entries={externalHistory}
            title="HISTORIAL EXTERNO"
            isLocal={false}
          />
        </div>
      </main>
    </div>
  );
}
