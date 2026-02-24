import { useState, useEffect, useRef } from "react";
import { useI18n } from "@/lib/i18n";
import { Trash2 } from "lucide-react";

const MAX_LINES = 5000;

export default function LogLive() {
  const { t } = useI18n();
  const [lines, setLines] = useState<string[]>([]);
  const [isDemo, setIsDemo] = useState(false);
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource("/api/log-stream");
    eventSourceRef.current = es;

    es.onopen = () => {
      setConnected(true);
    };

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.demo) {
          setIsDemo(true);
          setConnected(true);
          return;
        }
        if (data.line) {
          setConnected(true);
          setLines((prev) => {
            const next = [data.line, ...prev];
            if (next.length > MAX_LINES) {
              return next.slice(0, MAX_LINES);
            }
            return next;
          });
        }
      } catch {}
    };

    es.onerror = () => {
      setConnected(false);
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, []);

  const handleClear = () => {
    setLines([]);
  };

  return (
    <div className="flex flex-col h-full bg-background" data-testid="log-live-page">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <h1 className="text-xs font-bold text-foreground tracking-wider" data-testid="text-log-title">
            {t("log_live_title")}
          </h1>
          <span className={`inline-flex items-center gap-1.5 text-[10px] font-mono ${connected ? "text-green-400" : "text-red-400"}`} data-testid="text-log-status">
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-green-400 animate-pulse" : "bg-red-400"}`} />
            {connected ? t("connected") : t("disconnected")}
          </span>
          <span className="text-[10px] text-muted-foreground font-mono" data-testid="text-log-line-count">
            {lines.length} {t("log_live_lines")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleClear}
            className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold rounded bg-white/5 text-muted-foreground border border-white/10 hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/30 transition-colors"
            title={t("log_live_clear")}
            data-testid="button-clear-log"
          >
            <Trash2 className="w-3 h-3" />
            {t("log_live_clear")}
          </button>
        </div>
      </div>

      <div
        className="flex-1 overflow-auto p-2 font-mono text-[11px] leading-[1.6] bg-black/40"
        data-testid="log-live-container"
      >
        {isDemo ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-muted-foreground text-xs text-center max-w-md" data-testid="text-log-demo">
              {t("log_live_demo")}
            </p>
          </div>
        ) : lines.length === 0 && connected ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-muted-foreground text-xs animate-pulse" data-testid="text-log-connecting">
              {t("log_live_connecting")}
            </p>
          </div>
        ) : (
          lines.map((line, i) => (
            <div
              key={i}
              className={`whitespace-pre-wrap break-all px-1 hover:bg-white/5 ${
                line.includes("ERROR") || line.includes("error")
                  ? "text-red-400"
                  : line.includes("WARN") || line.includes("warn")
                  ? "text-yellow-400"
                  : line.includes("DEBUG")
                  ? "text-blue-300/70"
                  : line.includes("TRACE")
                  ? "text-gray-500"
                  : "text-green-300/90"
              }`}
              data-testid={`text-log-line-${i}`}
            >
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
