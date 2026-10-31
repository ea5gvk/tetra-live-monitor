import { useState, useEffect, useRef, useCallback } from "react";
import { useI18n } from "@/lib/i18n";
import { Trash2, Settings2, RadioTower, FileText } from "lucide-react";

const MAX_LINES = 5000;
const SERVICE_STORAGE_KEY = "tetra_log_service";
// Presets of the DMR Tier III station (the selector stores "dmr" when it is the active one): the journal of its
// five units (/api/log-stream?service=dmr) and the dmrtc.log file (?file=dmrtc). Anything else is one unit.
const DMR_JOURNAL = "dmr";
const DMRTC_FILE = "file:dmrtc";

function getStoredService(): string {
  try {
    return localStorage.getItem(SERVICE_STORAGE_KEY) || "tmo.service";
  } catch {
    return "tmo.service";
  }
}

function logStreamUrl(sel: string): string {
  if (sel === DMRTC_FILE) return "/api/log-stream?file=dmrtc";
  return sel ? `/api/log-stream?service=${encodeURIComponent(sel)}` : "/api/log-stream";
}

export default function LogLive() {
  const { t } = useI18n();
  const [lines, setLines] = useState<string[]>([]);
  const [isDemo, setIsDemo] = useState(false);
  const [connected, setConnected] = useState(false);
  const [streamError, setStreamError] = useState("");
  const [service, setService] = useState(getStoredService);
  const [serviceInput, setServiceInput] = useState(getStoredService);
  const [showServiceInput, setShowServiceInput] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  const connect = useCallback((svc: string) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    setLines([]);
    setIsDemo(false);
    setConnected(false);
    setStreamError("");

    const es = new EventSource(logStreamUrl(svc));
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
        if (data.error) {
          // e.g. a file that is not on the server's list: the stream closes right after
          setStreamError(String(data.error));
          es.close();
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
  }, []);

  useEffect(() => {
    connect(service);
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [service, connect]);

  const applyService = (sel: string) => {
    const trimmed = sel.trim();
    try {
      localStorage.setItem(SERVICE_STORAGE_KEY, trimmed);
    } catch {}
    setServiceInput(trimmed);
    setService(trimmed);
    setShowServiceInput(false);
  };
  const handleApplyService = () => applyService(serviceInput);

  const handleClear = () => {
    setLines([]);
  };

  const isFile = service === DMRTC_FILE;
  const badge = service === DMR_JOURNAL ? t("log_live_preset_dmr") : isFile ? "dmrtc.log" : service;

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
          {service && (
            <span className="text-[10px] text-cyan-400 font-mono bg-cyan-400/10 px-1.5 py-0.5 rounded border border-cyan-400/20" data-testid="text-log-service-badge">
              {badge}
            </span>
          )}
          <span className="text-[10px] text-muted-foreground font-mono" data-testid="text-log-line-count">
            {lines.length} {t("log_live_lines")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowServiceInput(!showServiceInput)}
            className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold rounded border transition-colors ${
              showServiceInput
                ? "bg-primary/20 text-primary border-primary/30"
                : "bg-white/5 text-muted-foreground border-white/10 hover:bg-white/10 hover:text-foreground"
            }`}
            title={t("log_live_service_hint")}
            data-testid="button-toggle-service"
          >
            <Settings2 className="w-3 h-3" />
            {t("log_live_service")}
          </button>
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

      {showServiceInput && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card/80 flex-wrap" data-testid="service-input-bar">
          <label className="text-[10px] text-muted-foreground font-mono whitespace-nowrap">
            journalctl -u
          </label>
          <input
            type="text"
            value={serviceInput === DMR_JOURNAL || serviceInput === DMRTC_FILE ? "" : serviceInput}
            onChange={(e) => setServiceInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleApplyService(); }}
            placeholder="tmo.service"
            className="flex-1 max-w-xs bg-black/40 border border-white/10 rounded px-2 py-1 text-xs font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50"
            data-testid="input-service-name"
          />
          <button
            onClick={handleApplyService}
            className="px-3 py-1 text-[10px] font-bold rounded bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-colors"
            data-testid="button-apply-service"
          >
            {t("log_live_apply")}
          </button>
          <span className="w-px h-4 bg-white/10 hidden sm:inline-block" />
          <button
            onClick={() => applyService(DMR_JOURNAL)}
            title={t("log_live_preset_hint")}
            className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold rounded border transition-colors ${
              service === DMR_JOURNAL
                ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40"
                : "bg-white/5 text-muted-foreground border-white/10 hover:bg-white/10 hover:text-foreground"
            }`}
            data-testid="button-log-preset-dmr"
          >
            <RadioTower className="w-3 h-3" />
            {t("log_live_preset_dmr")}
          </button>
          <button
            onClick={() => applyService(DMRTC_FILE)}
            title={t("log_live_preset_hint")}
            className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold rounded border font-mono transition-colors ${
              isFile
                ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40"
                : "bg-white/5 text-muted-foreground border-white/10 hover:bg-white/10 hover:text-foreground"
            }`}
            data-testid="button-log-preset-dmrtc"
          >
            <FileText className="w-3 h-3" />
            dmrtc.log
          </button>
          <span className="text-[10px] text-muted-foreground/60 font-mono hidden lg:inline">
            {t("log_live_service_hint")}
          </span>
        </div>
      )}

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
        ) : streamError ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-red-400 text-xs text-center max-w-md" data-testid="text-log-error">
              {t("log_live_error")}: {streamError}
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
