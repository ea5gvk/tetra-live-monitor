import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { Gauge, ExternalLink, RefreshCw, AlertTriangle } from "lucide-react";

type Status = {
  enabled: boolean;
  port: number;
  flowstationActive: boolean;
};

export default function FlowstationDash() {
  const { t } = useI18n();
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [iframeKey, setIframeKey] = useState(0);

  const refresh = () => {
    setLoading(true);
    fetch("/api/flowstation/dashboard-status")
      .then((r) => r.json())
      .then((d) => setStatus(d))
      .catch(() => setStatus({ enabled: false, port: 0, flowstationActive: false }))
      .finally(() => setLoading(false));
  };

  useEffect(() => { refresh(); }, []);

  const ready = status?.enabled && status?.flowstationActive;

  return (
    <div className="p-2 sm:p-4 flex flex-col gap-3 h-[calc(100vh-3.5rem)]">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Gauge className="w-5 h-5 text-emerald-400" />
          <h1 className="text-lg sm:text-xl font-bold tracking-wide" data-testid="text-flow-dash-title">
            {t("flow_dash_title")}
          </h1>
          {status && (
            <span
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                ready
                  ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
                  : "border-amber-500/40 text-amber-400 bg-amber-500/10"
              }`}
              data-testid="badge-flow-dash-status"
            >
              {ready ? `:${status.port} ✓` : status.enabled ? "FLOW INACTIVE" : "DISABLED"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { refresh(); setIframeKey(k => k + 1); }}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-border hover:bg-white/5 transition-colors"
            data-testid="button-flow-dash-refresh"
          >
            <RefreshCw className="w-3 h-3" />
            <span className="hidden sm:inline">Refresh</span>
          </button>
          <a
            href="/flow-iframe/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-border hover:bg-white/5 transition-colors"
            data-testid="link-flow-dash-external"
          >
            <ExternalLink className="w-3 h-3" />
            <span className="hidden sm:inline">{t("flow_dash_open_external")}</span>
          </a>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          Loading...
        </div>
      ) : !status?.enabled ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
          <AlertTriangle className="w-10 h-10 text-amber-400" />
          <p className="text-sm sm:text-base text-foreground max-w-xl" data-testid="text-flow-dash-disabled">
            {t("flow_dash_disabled")}
          </p>
          <pre className="text-xs sm:text-sm bg-card border border-border rounded p-3 text-amber-300 font-mono">
{`[dashboard]
port = 8080`}
          </pre>
        </div>
      ) : !status?.flowstationActive ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
          <AlertTriangle className="w-10 h-10 text-amber-400" />
          <p className="text-sm sm:text-base text-foreground max-w-xl" data-testid="text-flow-dash-only-flow">
            {t("flow_dash_only_flow")}
          </p>
        </div>
      ) : (
        <iframe
          key={iframeKey}
          src="/flow-iframe/"
          title="Flowstation Native Dashboard"
          className="flex-1 w-full bg-card border border-border rounded"
          data-testid="iframe-flow-dash"
        />
      )}
    </div>
  );
}
