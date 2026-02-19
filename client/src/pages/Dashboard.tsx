import { useTetraWebSocket, type Terminal, type CallLogEntry } from "../hooks/useTetraWebSocket";
import { useState, useEffect } from "react";

function Clock() {
  const [time, setTime] = useState(new Date().toLocaleTimeString("en-GB"));
  useEffect(() => {
    const interval = setInterval(() => setTime(new Date().toLocaleTimeString("en-GB")), 1000);
    return () => clearInterval(interval);
  }, []);
  return <span>{time}</span>;
}

function StatusIndicator({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    Online: "text-green-400",
    Offline: "text-red-400",
    External: "text-orange-400",
  };
  return <span className={colorMap[status] || "text-gray-400"}>{status}</span>;
}

function TerminalTable({ terminals, title, borderColor, isLocal }: {
  terminals: Terminal[];
  title: string;
  borderColor: string;
  isLocal: boolean;
}) {
  const filtered = terminals
    .filter(t => t.isLocal === isLocal)
    .sort((a, b) => a.id.localeCompare(b.id));

  return (
    <div className={`border ${borderColor} mb-3`} data-testid={`panel-${isLocal ? 'local' : 'external'}-terminals`}>
      <div className={`text-center py-1 ${borderColor.replace('border-', 'text-')} font-bold text-xs tracking-[0.2em] uppercase`}>
        &#9472;&#9472; {title} &#9472;&#9472;
      </div>
      <div className="overflow-x-auto">
        <table className="w-full font-mono text-sm" data-testid={`table-${isLocal ? 'local' : 'external'}-terminals`}>
          <thead>
            <tr className="text-cyan-400">
              <th className="text-center w-8 px-2 py-1">T</th>
              <th className="text-left px-2 py-1 min-w-[220px]">TERMINAL (CALL)</th>
              <th className="text-left px-2 py-1 w-28">SELECTED</th>
              <th className="text-left px-2 py-1 w-24">STATUS</th>
              <th className="text-left px-2 py-1">SCANLIST</th>
              <th className="text-right px-2 py-1 w-24">SEEN</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-6 text-gray-600">
                  &mdash;
                </td>
              </tr>
            ) : (
              filtered.map(t => {
                const selectedNum = t.selectedTg.replace("TG ", "");
                const scanItems = t.groups.map((g, i) => {
                  if (g === selectedNum) {
                    return <span key={g} className="text-yellow-300 font-bold">[{g}]</span>;
                  }
                  return <span key={g} className="text-gray-300">{g}</span>;
                });

                return (
                  <tr key={t.id} data-testid={`row-terminal-${t.id}`}>
                    <td className="text-center px-2 py-0.5 text-yellow-400 font-bold">
                      {t.isActive ? "\u25B6" : ""}
                    </td>
                    <td className="px-2 py-0.5">
                      <span className="text-yellow-300">{t.id}</span>
                      {t.callsign ? (
                        <span className="text-white font-bold ml-1">({t.callsign})</span>
                      ) : null}
                    </td>
                    <td className="px-2 py-0.5 text-yellow-400 font-bold">{t.selectedTg}</td>
                    <td className="px-2 py-0.5"><StatusIndicator status={t.status} /></td>
                    <td className="px-2 py-0.5">
                      {scanItems.length > 0 ? (
                        <span>
                          [{scanItems.reduce<React.ReactNode[]>((acc, item, i) => {
                            if (i > 0) acc.push(<span key={`sep-${i}`}>, </span>);
                            acc.push(item);
                            return acc;
                          }, [])}]
                        </span>
                      ) : (
                        <span className="text-gray-600">---</span>
                      )}
                    </td>
                    <td className="text-right px-2 py-0.5 text-gray-300">{t.lastSeen}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CallHistory({ entries, title, borderColor }: {
  entries: CallLogEntry[];
  title: string;
  borderColor: string;
}) {
  return (
    <div className={`border ${borderColor} flex-1 min-w-0 flex flex-col`} data-testid={`panel-${title.toLowerCase().includes('local') ? 'local' : 'external'}-history`}>
      <div className={`text-center py-1 ${borderColor.replace('border-', 'text-')} font-bold text-xs tracking-[0.2em] uppercase`}>
        &#9472;&#9472; {title} &#9472;&#9472;
      </div>
      <div className="overflow-y-auto flex-1 p-2 font-mono text-sm min-h-[200px] max-h-[320px]">
        {entries.length === 0 ? (
          <div className="text-gray-600 text-center py-6">&mdash;</div>
        ) : (
          entries.map(entry => (
            <div key={entry.id} className="leading-relaxed whitespace-nowrap" data-testid={`log-entry-${entry.id}`}>
              <span className="text-gray-400">[{entry.timestamp}]</span>{" "}
              <span className="text-yellow-300">{entry.sourceId}</span>
              {entry.sourceCallsign ? (
                <span className="text-white"> ({entry.sourceCallsign})</span>
              ) : null}
              <span className="text-gray-500"> -&gt; </span>
              <span className="text-cyan-400">TG {entry.targetTg}</span>
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

  return (
    <div className="min-h-screen bg-black text-gray-200 font-mono flex flex-col">
      {/* Header bar - matches screenshot */}
      <div className="bg-blue-800 px-4 py-1.5 flex items-center gap-3 flex-wrap" data-testid="header-bar">
        <span className="text-white font-bold tracking-wide text-sm" data-testid="text-title">
          TETRA LIVE MONITOR
        </span>
        <span className="text-blue-300">|</span>
        <span className="text-white font-bold text-sm" data-testid="text-clock"><Clock /></span>
        <span className="ml-auto flex items-center gap-2">
          <span
            className={`inline-block w-2 h-2 rounded-full ${connected ? "bg-green-400 animate-pulse" : "bg-red-500"}`}
            data-testid="status-connection"
          />
          <span className="text-blue-200 text-xs" data-testid="text-connection-status">
            {connected ? "CONNECTED" : "DISCONNECTED"}
          </span>
        </span>
      </div>

      {/* Main content area */}
      <div className="flex-1 p-3 flex flex-col overflow-auto">
        <TerminalTable
          terminals={terminalList}
          title="LOCAL TERMINALS"
          borderColor="border-cyan-700"
          isLocal={true}
        />

        <TerminalTable
          terminals={terminalList}
          title="EXTERNAL TERMINALS"
          borderColor="border-orange-700"
          isLocal={false}
        />

        <div className="flex flex-col md:flex-row gap-3 mt-1 flex-1">
          <CallHistory
            entries={localHistory}
            title="LOCAL CALL HISTORY"
            borderColor="border-cyan-700"
          />
          <CallHistory
            entries={externalHistory}
            title="EXTERNAL CALL HISTORY"
            borderColor="border-orange-700"
          />
        </div>
      </div>
    </div>
  );
}
