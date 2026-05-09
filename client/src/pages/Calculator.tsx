import { useRef, useEffect, useState } from "react";
import { Radio, Waves } from "lucide-react";
import { useI18n } from "@/lib/i18n";

type StationName = "bluestation" | "flowstation";

const STATION_KEY = "tetra_calc_station";
const STATION_DEFAULTS: Record<StationName, { configPath: string; serviceName: string }> = {
  bluestation: { configPath: "/root/tetra-bluestation/config.toml", serviceName: "tmo.service" },
  flowstation: { configPath: "/root/flowstation/config.toml", serviceName: "flowstation.service" },
};

function getStoredStation(): StationName {
  try {
    const v = localStorage.getItem(STATION_KEY);
    if (v === "flowstation" || v === "bluestation") return v;
  } catch {}
  return "bluestation";
}

export default function Calculator() {
  const { lang } = useI18n();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [station, setStation] = useState<StationName>(getStoredStation);

  function postLang() {
    iframeRef.current?.contentWindow?.postMessage({ type: "setLang", lang }, "*");
  }
  function postStation(s: StationName) {
    const d = STATION_DEFAULTS[s];
    iframeRef.current?.contentWindow?.postMessage(
      { type: "setStation", station: s, configPath: d.configPath, serviceName: d.serviceName },
      "*"
    );
  }

  useEffect(() => { postLang(); }, [lang]);
  useEffect(() => {
    try { localStorage.setItem(STATION_KEY, station); } catch {}
    postStation(station);
  }, [station]);

  const handleLoad = () => {
    postLang();
    postStation(station);
  };

  return (
    <div className="h-screen w-full flex flex-col" data-testid="page-calculator">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-card border-b border-border flex-shrink-0">
        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Station:</span>
        <div className="inline-flex rounded border border-white/10 overflow-hidden">
          <button
            onClick={() => setStation("bluestation")}
            className={`inline-flex items-center gap-1 px-3 py-1 text-[11px] font-bold transition-colors ${
              station === "bluestation"
                ? "bg-violet-500/20 text-violet-300"
                : "text-muted-foreground hover:text-foreground hover:bg-white/5"
            }`}
            data-testid="button-calc-station-bluestation"
          >
            <Radio className="w-3 h-3" />
            BLUESTATION
          </button>
          <button
            onClick={() => setStation("flowstation")}
            className={`inline-flex items-center gap-1 px-3 py-1 text-[11px] font-bold transition-colors ${
              station === "flowstation"
                ? "bg-emerald-500/20 text-emerald-300"
                : "text-muted-foreground hover:text-foreground hover:bg-white/5"
            }`}
            data-testid="button-calc-station-flowstation"
          >
            <Waves className="w-3 h-3" />
            FLOWSTATION
          </button>
        </div>
        <span className="text-[10px] text-muted-foreground ml-2 truncate">
          → <code className="font-mono">{STATION_DEFAULTS[station].configPath}</code>
        </span>
      </div>
      <iframe
        ref={iframeRef}
        src="/calculator.html"
        className="w-full flex-1 border-0"
        title="TETRA Frequency Calculator"
        onLoad={handleLoad}
        data-testid="iframe-calculator"
      />
    </div>
  );
}
