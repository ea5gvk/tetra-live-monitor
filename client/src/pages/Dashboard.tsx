import { useTetraWebSocket, type Terminal, type CallLogEntry, type SdsMessage, type RfCall, type EmergencyEntry, type LastHeardEntry, type TxQuality, type HealthSnapshot, type SdrHealth, type SysHealth, type BrewStatus } from "../hooks/useTetraWebSocket";
import { useState, useEffect, useRef, useMemo } from "react";
import { Radio, Wifi, WifiOff, ArrowUpFromLine, ArrowDownToLine, Power, RotateCcw, Cpu, Thermometer, MemoryStick, Lock, RefreshCw, MessageSquare, ArrowUp, ArrowDown, MapPin, Navigation, Globe, Zap, Network, Eye, EyeOff, Signal as SignalIcon, RadioTower, Clock as ClockIcon, ShieldCheck, ShieldAlert, Siren, Activity, Gauge } from "lucide-react";
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

const TG_FLAG_KEYWORDS: [string[], string][] = [
  [["worldwide","world-wide","global","international","ww ","- ww","ww-"], "🌐"],
  [["spain","spanish","españa","espana","spagna","spanien","espagne"], "🇪🇸"],
  [["germany","german","deutsch","deutschland","allemagne","alemanha"], "🇩🇪"],
  [["france","french","français","francais","frankreich","frankrijk"], "🇫🇷"],
  [["italy","italian","italia","italiano","italie","italien","italië"], "🇮🇹"],
  [["netherlands","dutch","nederland","nederlands","niederlande","pays-bas","holland"], "🇳🇱"],
  [["belgium","belgian","belgique","belgie","belgien","belgica"], "🇧🇪"],
  [["portugal","portuguese","portugues"], "🇵🇹"],
  [["united kingdom","england","scotland","wales","british","grande bretagne"], "🇬🇧"],
  [["united states","usa","america"], "🇺🇸"],
  [["canada","canadian"], "🇨🇦"],
  [["australia","australian"], "🇦🇺"],
  [["new zealand"], "🇳🇿"],
  [["japan","japanese","japon"], "🇯🇵"],
  [["china","chinese","chine"], "🇨🇳"],
  [["russia","russian","russie","russland"], "🇷🇺"],
  [["ukraine","ukrainian"], "🇺🇦"],
  [["poland","polish","polska","pologne","polnisch"], "🇵🇱"],
  [["sweden","swedish","sverige","schweden","suede"], "🇸🇪"],
  [["norway","norwegian","norge","norwegen","norvege"], "🇳🇴"],
  [["denmark","danish","danmark","danemark"], "🇩🇰"],
  [["finland","finnish","suomi","finnland"], "🇫🇮"],
  [["austria","austrian","österreich","osterreich","autriche"], "🇦🇹"],
  [["switzerland","swiss","schweiz","suisse"], "🇨🇭"],
  [["czechia","czech republic","česká","ceska","tschechien"], "🇨🇿"],
  [["slovakia","slovak","slovensko","slowakei"], "🇸🇰"],
  [["hungary","hungarian","magyarország","magyarorszag"], "🇭🇺"],
  [["romania","romanian","românia","rumänien"], "🇷🇴"],
  [["bulgaria","bulgarian","bălgarija"], "🇧🇬"],
  [["greece","greek","grecia","griechenland","grece"], "🇬🇷"],
  [["turkey","turkish","türkiye","turkiye"], "🇹🇷"],
  [["croatia","croatian","hrvatska"], "🇭🇷"],
  [["serbia","serbian","srbija"], "🇷🇸"],
  [["slovenia","slovenian","slovenija"], "🇸🇮"],
  [["ireland","irish","éire","eire"], "🇮🇪"],
  [["israel","israeli"], "🇮🇱"],
  [["brazil","brasil","brazilian","brasiliano"], "🇧🇷"],
  [["argentina"], "🇦🇷"],
  [["mexico","mexicano"], "🇲🇽"],
  [["south africa"], "🇿🇦"],
  [["south korea","korea","korean"], "🇰🇷"],
  [["taiwan"], "🇹🇼"],
  [["india","indian"], "🇮🇳"],
  [["singapore"], "🇸🇬"],
  [["malaysia","malaysian"], "🇲🇾"],
  [["indonesia","indonesian"], "🇮🇩"],
  [["philippines","philippine"], "🇵🇭"],
  [["thailand","thai"], "🇹🇭"],
  [["vietnam","vietnamese"], "🇻🇳"],
  [["nordic","scandinavia","scandinavian"], "🌍"],
  [["africa","african"], "🌍"],
  [["europe","european"], "🇪🇺"],
  [["latin america","latinoamerica"], "🌎"],
  [["asia","asian"], "🌏"],
];

// MCC (Mobile Country Code) → flag emoji — covers all ITU-allocated MCCs
const MCC_FLAGS: Record<string, string> = {
  "202":"🇬🇷","204":"🇳🇱","206":"🇧🇪","208":"🇫🇷","212":"🇲🇨","213":"🇦🇩",
  "214":"🇪🇸","216":"🇭🇺","218":"🇧🇦","219":"🇭🇷","220":"🇷🇸","222":"🇮🇹",
  "226":"🇷🇴","228":"🇨🇭","230":"🇨🇿","231":"🇸🇰","232":"🇦🇹",
  "234":"🇬🇧","235":"🇬🇧","238":"🇩🇰","240":"🇸🇪","242":"🇳🇴","244":"🇫🇮",
  "246":"🇱🇹","247":"🇱🇻","248":"🇪🇪","250":"🇷🇺","255":"🇺🇦","257":"🇧🇾",
  "259":"🇲🇩","260":"🇵🇱","262":"🇩🇪","266":"🇬🇮","268":"🇵🇹","270":"🇱🇺",
  "272":"🇮🇪","274":"🇮🇸","276":"🇦🇱","278":"🇲🇹","280":"🇨🇾","282":"🇬🇪",
  "283":"🇦🇲","284":"🇧🇬","286":"🇹🇷","288":"🇫🇴","290":"🇬🇱","292":"🇸🇲",
  "293":"🇸🇮","294":"🇲🇰","295":"🇱🇮","297":"🇲🇪",
  "302":"🇨🇦",
  "310":"🇺🇸","311":"🇺🇸","312":"🇺🇸","313":"🇺🇸","314":"🇺🇸","315":"🇺🇸","316":"🇺🇸",
  "334":"🇲🇽","338":"🇯🇲","340":"🇬🇵","342":"🇧🇧","344":"🇦🇬","346":"🇰🇾",
  "348":"🇻🇬","350":"🇧🇲","352":"🇬🇩","354":"🇲🇸","356":"🇰🇳","358":"🇱🇨",
  "360":"🇻🇨","362":"🇧🇶","363":"🇦🇼","364":"🇧🇸","365":"🇦🇮","366":"🇩🇲",
  "368":"🇨🇺","370":"🇩🇴","372":"🇭🇹","374":"🇹🇹","376":"🇹🇨",
  "400":"🇦🇿","401":"🇰🇿","402":"🇧🇹","404":"🇮🇳","405":"🇮🇳","406":"🇮🇳",
  "410":"🇵🇰","412":"🇦🇫","413":"🇱🇰","414":"🇲🇲","415":"🇱🇧","416":"🇯🇴",
  "417":"🇸🇾","418":"🇮🇶","419":"🇰🇼","420":"🇸🇦","421":"🇾🇪","422":"🇴🇲",
  "424":"🇦🇪","425":"🇮🇱","426":"🇧🇭","427":"🇶🇦","428":"🇲🇳","429":"🇳🇵",
  "432":"🇮🇷","434":"🇺🇿","436":"🇹🇯","437":"🇰🇬","438":"🇹🇲",
  "440":"🇯🇵","441":"🇯🇵","450":"🇰🇷","452":"🇻🇳","454":"🇭🇰","455":"🇲🇴",
  "456":"🇰🇭","457":"🇱🇦","460":"🇨🇳","461":"🇨🇳","466":"🇹🇼","467":"🇰🇵",
  "470":"🇧🇩","472":"🇲🇻",
  "502":"🇲🇾","505":"🇦🇺","510":"🇮🇩","515":"🇵🇭","520":"🇹🇭","525":"🇸🇬",
  "528":"🇧🇳","530":"🇳🇿","537":"🇵🇬","539":"🇹🇴","541":"🇻🇺",
  "546":"🇳🇨","547":"🇵🇫","549":"🇼🇸",
  "601":"🇲🇷","602":"🇲🇱","603":"🇸🇳","604":"🇬🇳","605":"🇧🇫","606":"🇨🇮",
  "607":"🇬🇲","608":"🇬🇼","609":"🇲🇺","610":"🇱🇷","611":"🇸🇱","612":"🇬🇭",
  "613":"🇳🇬","614":"🇹🇩","615":"🇨🇫","616":"🇨🇲","617":"🇨🇻","619":"🇬🇶",
  "620":"🇬🇦","621":"🇨🇩","622":"🇨🇬","623":"🇦🇴","625":"🇸🇸","626":"🇪🇹",
  "627":"🇸🇴","628":"🇩🇯","629":"🇰🇪","630":"🇹🇿","631":"🇺🇬","632":"🇧🇮",
  "633":"🇲🇿","634":"🇿🇲","635":"🇲🇬","637":"🇿🇼","638":"🇳🇦","639":"🇲🇼",
  "640":"🇱🇸","641":"🇧🇼","642":"🇸🇿","643":"🇰🇲","645":"🇪🇷","646":"🇿🇦",
  "647":"🇸🇩","648":"🇷🇼","650":"🇱🇾","651":"🇩🇿","652":"🇲🇦","653":"🇹🇳","654":"🇪🇬",
  "702":"🇧🇿","704":"🇬🇹","706":"🇸🇻","708":"🇭🇳","710":"🇳🇮","712":"🇨🇷",
  "714":"🇵🇦","716":"🇵🇪","722":"🇦🇷","724":"🇧🇷","730":"🇨🇱","732":"🇨🇴",
  "734":"🇻🇪","736":"🇧🇴","738":"🇬🇾","740":"🇪🇨","744":"🇵🇾","746":"🇸🇷","748":"🇺🇾",
};

function getTgFlag(name: string, id?: string | number): string {
  // 1. Try name-based keyword detection first
  if (name) {
    const n = name.toLowerCase();
    for (const [keywords, flag] of TG_FLAG_KEYWORDS) {
      if (keywords.some(kw => n.includes(kw))) return flag;
    }
  }
  // 2. Fallback: MCC prefix detection from TG number
  if (id !== undefined) {
    const s = String(id);
    if (s.length >= 3) {
      const mcc = s.slice(0, 3);
      if (MCC_FLAGS[mcc]) return MCC_FLAGS[mcc];
    }
  }
  return "";
}

function useTgNames(): (id: string | number) => string {
  const [names, setNames] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem("tetra_tg_names") || "{}"); } catch { return {}; }
  });
  const [custom, setCustom] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem("tetra_tg_custom") || "{}"); } catch { return {}; }
  });
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === "tetra_tg_names") {
        try { setNames(JSON.parse(e.newValue || "{}")); } catch { setNames({}); }
      }
      if (e.key === "tetra_tg_custom") {
        try { setCustom(JSON.parse(e.newValue || "{}")); } catch { setCustom({}); }
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);
  return (id: string | number) => custom[String(id)] || names[String(id)] || "";
}

function useIssiCustomNames(): Record<string, string> {
  const [data, setData] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem("tetra_issi_custom") || "{}"); } catch { return {}; }
  });
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === "tetra_issi_custom") {
        try { setData(JSON.parse(e.newValue || "{}")); } catch { setData({}); }
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);
  return data;
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

function RssiBadge({ dbfs }: { dbfs: number }) {
  // dBFS color thresholds based on LimeSDR Mini 2.0 typical operating ranges:
  // -10..-20 = very strong, -20..-35 = normal, -35..-45 = weak, <-45 = marginal
  let color = "text-emerald-400 border-emerald-400/40 bg-emerald-400/10";
  if (dbfs < -45) color = "text-red-400 border-red-400/40 bg-red-400/10";
  else if (dbfs < -35) color = "text-orange-400 border-orange-400/40 bg-orange-400/10";
  else if (dbfs < -20) color = "text-emerald-400 border-emerald-400/40 bg-emerald-400/10";
  else color = "text-cyan-300 border-cyan-300/40 bg-cyan-300/10";
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[10px] font-mono font-semibold border rounded px-1 py-px tracking-tight ${color}`}
      title={`RSSI: ${dbfs.toFixed(1)} dBFS (≈ ${(dbfs - 30).toFixed(0)} dBm con LNA=30/TIA=6/PGA=10)`}
      data-testid={`rssi-${dbfs.toFixed(0)}`}
    >
      <SignalIcon className="w-2.5 h-2.5" />
      {dbfs.toFixed(1)}
    </span>
  );
}

function EnergySavingBadge({ mode }: { mode: string }) {
  // Flowstation Energy Economy mode (Eg1..Eg7). StayAlive is not rendered.
  // Shown as "EG1" / "EG2" / "EG3" next to the callsign — matches the
  // razvanzeces/flowstation web dashboard convention.
  const m = mode.match(/Eg(\d)/i);
  if (!m) return null;
  const n = m[1];
  return (
    <span
      className="inline-flex items-center text-[10px] font-mono font-bold border rounded px-1 py-px tracking-wide text-emerald-400 border-emerald-400/40 bg-emerald-400/10"
      title={`Energy Economy Mode ${n} (ETSI 23.5)`}
      data-testid={`energy-saving-${n}`}
    >
      EG{n}
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

function TerminalRow({ t: terminal, tgName, issiCallsign }: { t: Terminal; tgName: (id: string | number) => string; issiCallsign: (id: string | number) => string }) {
  const selectedNum = terminal.selectedTg.replace("TG ", "");
  const privDst = terminal.selectedTg.startsWith("PRIV") ? terminal.selectedTg.replace(/^PRIV\s*[→←]\s*/, "") : "";
  const privDstCs = privDst ? issiCallsign(privDst) : "";
  const rowBg = terminal.activity === "TX"
    ? "bg-red-500/10 border-l-2 border-l-red-500"
    : terminal.activity === "RX"
    ? "bg-emerald-500/10 border-l-2 border-l-emerald-500"
    : "border-l-2 border-l-transparent";

  const scanItems = terminal.groups.map((g) => {
    const name = tgName(g);
    const flag = getTgFlag(name, g);
    if (g === selectedNum) {
      return <span key={g} className="text-primary font-bold" title={(name || flag) ? `${flag ? flag+" " : ""}${name}` : undefined}>[{g}{(name||flag) ? <>{flag?<span className="text-sm"> {flag}</span>:null}{flag&&name?" ":""}{name}</>: ""}]</span>;
    }
    return <span key={g} className="text-muted-foreground" title={name ? `${flag ? flag + " " : ""}${name}` : undefined}>{g}</span>;
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
          ) : (() => {
            const custom = issiCallsign(terminal.id);
            return custom ? (
              <span
                className="text-amber-300 font-bold text-xs sm:text-sm"
                title="Custom ISSI name"
                data-testid={`text-issi-custom-${terminal.id}`}
              >
                ({custom})
              </span>
            ) : null;
          })()}
          {terminal.energySaving ? (
            <EnergySavingBadge mode={terminal.energySaving} />
          ) : null}
          {typeof terminal.rssiDbfs === "number" ? (
            <RssiBadge dbfs={terminal.rssiDbfs} />
          ) : null}
        </span>
      </td>
      <td className="px-2 sm:px-3 py-1.5">
        {terminal.selectedTg.startsWith("PRIV") ? (
          <span className="inline-flex items-center gap-1 flex-wrap">
            <span className="text-[10px] font-bold border border-cyan-400/60 text-cyan-400 rounded px-1 tracking-wide">PRIV</span>
            <span className="text-cyan-300 font-semibold font-mono text-xs sm:text-sm">{privDst}</span>
            {privDstCs ? (
              <>
                <CountryFlag callsign={privDstCs} />
                <span className="text-cyan-200 font-bold text-xs sm:text-sm">({privDstCs})</span>
              </>
            ) : null}
          </span>
        ) : (
          <>
            <span className="text-amber-400 font-semibold font-mono text-xs sm:text-sm">{terminal.selectedTg}</span>
            {(() => { const n=tgName(selectedNum); const f=getTgFlag(n,selectedNum); return (n||f) ? <span className="text-amber-300/80 text-xs font-normal ml-1.5 hidden sm:inline">{f?<span className="text-sm">{f}</span>:null}{f&&n?" ":""}{n}</span> : null; })()}
          </>
        )}
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

function RfChannelTimeslots({ rfCalls, issiCallsign, tsVoiceActivity }: {
  rfCalls: RfCall[];
  issiCallsign: (id: string | number) => string;
  tsVoiceActivity: Record<number, number>;
}) {
  const { t } = useI18n();
  // Force re-render every 500ms so the "voice activity" fade-out reacts to time
  // even when no new ts_voice arrives.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(x => x + 1), 500);
    return () => clearInterval(id);
  }, []);

  // Razvan's approach: calls tracked by call_id from the trunking layer.
  // call_started → add; call_ended → remove. No terminal activity inference needed.
  const callByTs: Record<number, RfCall | undefined> = {};
  for (const c of rfCalls) {
    const ts = c.ts;
    if (ts >= 1 && ts <= 4 && !callByTs[ts]) callByTs[ts] = c;
  }
  // Fallback (flowstation v0.2.2+): consider a TS "voice-active" when a ts_voice
  // event arrived within the last 2 s. Useful when call_started events are missing
  // (e.g. flowstation v0.2.3 group-attach-cap regression).
  const now = Date.now();
  const isVoiceActive = (n: number) => {
    const last = tsVoiceActivity[n];
    return last != null && (now - last) < 2000;
  };

  const renderSlot = (tsNum: number) => {
    const c = callByTs[tsNum];
    if (c) {
      if (c.callType === "individual") {
        const srcCs = issiCallsign(c.callerIssi) || String(c.callerIssi);
        const dstCs = issiCallsign(c.calledIssi) || String(c.calledIssi);
        return { ts: tsNum, mode: "active" as const, label: `${srcCs} → ${dstCs}`, sub: t("rf_p2p"), detail: `ISSI ${c.callerIssi} → ${c.calledIssi}` };
      }
      const speakerCs = c.callerIssi ? (issiCallsign(c.callerIssi) || String(c.callerIssi)) : "?";
      return { ts: tsNum, mode: "active" as const, label: `GSSI ${c.gssi}`, sub: t("rf_group_call"), detail: speakerCs };
    }
    if (isVoiceActive(tsNum)) {
      return { ts: tsNum, mode: "voice" as const, label: t("rf_voice_rx"), sub: t("rf_voice_activity"), detail: undefined as string | undefined };
    }
    if (tsNum === 1) {
      return { ts: 1, mode: "mcch" as const, label: t("rf_mcch"), sub: t("rf_control"), detail: undefined as string | undefined };
    }
    return { ts: tsNum, mode: "idle" as const, label: "—", sub: t("rf_idle"), detail: undefined as string | undefined };
  };

  const slots = [renderSlot(1), renderSlot(2), renderSlot(3), renderSlot(4)];

  return (
    <div className="glass-panel rounded-md overflow-hidden" data-testid="panel-rf-channel">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5 bg-cyan-500/5">
        <Network className="w-4 h-4 text-cyan-400" />
        <h2 className="text-xs font-bold tracking-[0.15em] uppercase text-cyan-400">
          {t("rf_channel_timeslots")}
        </h2>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3">
        {slots.map(s => {
          const isMcch = s.mode === "mcch";
          const isActive = s.mode === "active";
          const isVoice = s.mode === "voice";
          const borderCls = isMcch
            ? "border-cyan-400/30 bg-cyan-400/5"
            : isActive
              ? "border-emerald-400/60 bg-emerald-400/5 shadow-[0_0_12px_rgba(16,185,129,0.15)]"
              : isVoice
                ? "border-amber-400/60 bg-amber-400/5 shadow-[0_0_12px_rgba(251,191,36,0.15)]"
                : "border-white/10 bg-white/[0.02]";
          const ledCls = isMcch
            ? "bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.6)]"
            : isActive
              ? "bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.7)] animate-pulse"
              : isVoice
                ? "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.7)] animate-pulse"
                : "bg-white/15";
          const labelCls = isMcch ? "text-cyan-300" : isActive ? "text-emerald-300" : isVoice ? "text-amber-300" : "text-muted-foreground";
          return (
            <div
              key={s.ts}
              className={`relative rounded-md border ${borderCls} px-3 py-3 text-center transition-colors overflow-hidden`}
              data-testid={`rf-ts-${s.ts}`}
            >
              <div className="text-[11px] font-bold tracking-[0.18em] text-muted-foreground mb-1.5">TS {s.ts}</div>
              <div className={`w-3 h-3 rounded-full mx-auto mb-2 ${ledCls}`} />
              <div className={`text-sm font-mono font-bold tracking-wide truncate ${labelCls}`} title={s.label}>
                {s.label}
              </div>
              <div className="text-xs font-mono text-muted-foreground mt-1 truncate" title={s.sub}>
                {s.sub}
              </div>
              {s.detail && (
                <div className="text-[11px] font-mono text-muted-foreground/80 mt-0.5 truncate" title={s.detail}>
                  {s.detail}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EmergencyBanner({ emergencies, issiCallsign }: {
  emergencies: EmergencyEntry[];
  issiCallsign: (id: string | number) => string;
}) {
  const { t } = useI18n();
  if (!emergencies.length) return null;
  return (
    <div className="rounded-md border-2 border-red-500 bg-red-500/15 px-4 py-3 animate-pulse" data-testid="banner-emergency">
      <div className="flex items-center gap-2 mb-1.5">
        <Siren className="w-5 h-5 text-red-400" />
        <span className="text-sm font-bold tracking-[0.12em] uppercase text-red-300">
          {t("emergency_active")} ({emergencies.length})
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {emergencies.map((e) => {
          const cs = issiCallsign(e.issi);
          return (
            <span key={e.issi} className="font-mono text-sm text-red-100 bg-red-500/25 border border-red-500/40 rounded px-2 py-0.5" data-testid={`emergency-${e.issi}`}>
              {cs ? `${cs} · ` : ""}ISSI {e.issi}{e.dest_ssi ? ` → ${e.dest_ssi}` : ""}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function HealthBadge({ health, sdrHealth, sysHealth }: {
  health: HealthSnapshot | null;
  sdrHealth: SdrHealth | null;
  sysHealth: SysHealth | null;
}) {
  const { t } = useI18n();
  if (!health) return null;
  const lvl = health.overall;
  const cls = lvl === "ok"
    ? "text-emerald-400 border-emerald-400/40 bg-emerald-400/10"
    : lvl === "degraded"
      ? "text-amber-400 border-amber-400/40 bg-amber-400/10"
      : "text-red-400 border-red-400/40 bg-red-400/10";
  const temp = sdrHealth?.temperature_c;
  const power = sysHealth?.total_power_w;
  const title = [
    `${t("health")}: ${lvl.toUpperCase()}`,
    ...(health.domains || []).map((d) => `• ${d.domain}: ${d.level}${d.detail ? ` (${d.detail})` : ""}`),
    temp != null ? `SDR: ${temp.toFixed(1)}°C` : "",
    power != null ? `${t("power")}: ${power.toFixed(1)} W` : "",
    health.last_action ? `${t("health_last_action")}: ${health.last_action}` : "",
  ].filter(Boolean).join("\n");
  return (
    <span title={title} className={`inline-flex items-center gap-1 text-xs font-semibold rounded px-2 py-0.5 border ${cls}`} data-testid="badge-health">
      <Activity className="w-3.5 h-3.5" />
      <span className="hidden sm:inline">{t("health")}</span>
      <span>{lvl.toUpperCase()}</span>
    </span>
  );
}

function BrewBadge({ brewStatus }: { brewStatus: BrewStatus | null }) {
  const { t } = useI18n();
  if (!brewStatus) return null;
  const c = brewStatus.connected;
  return (
    <span
      title={`Brew: ${c ? t("brew_online") : t("brew_offline")}${brewStatus.version ? ` · v${brewStatus.version}` : ""}`}
      className={`inline-flex items-center gap-1 text-xs font-semibold ${c ? "text-emerald-400" : "text-red-400"}`}
      data-testid="badge-brew"
    >
      <Network className="w-3.5 h-3.5" />
      <span className="hidden md:inline">Brew</span>
    </span>
  );
}

function LastHeardPanel({ entries, issiCallsign }: {
  entries: LastHeardEntry[];
  issiCallsign: (id: string | number) => string;
}) {
  const { t } = useI18n();
  if (!entries.length) return null;
  const actLabel = (a: string) =>
    a === "call_group" ? t("lh_call_group")
      : a === "call_individual" ? t("lh_call_individual")
        : a === "sds" ? t("lh_sds")
          : a;
  const actCls = (a: string) =>
    a === "sds" ? "text-violet-300 bg-violet-500/15"
      : a === "call_individual" ? "text-cyan-300 bg-cyan-500/15"
        : "text-emerald-300 bg-emerald-500/15";
  return (
    <div className="glass-panel rounded-md overflow-hidden flex-1" data-testid="panel-last-heard">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5 bg-emerald-500/5">
        <RadioTower className="w-4 h-4 text-emerald-400" />
        <h2 className="text-xs font-bold tracking-[0.15em] uppercase text-emerald-400">{t("last_heard")}</h2>
      </div>
      <div className="max-h-64 overflow-auto divide-y divide-white/5">
        {entries.map((e, i) => {
          const cs = issiCallsign(e.issi);
          return (
            <div key={`${e.issi}-${i}`} className="flex items-center gap-2 px-3 py-1.5 text-xs" data-testid={`last-heard-${e.issi}-${i}`}>
              {e.ts && <span className="font-mono text-muted-foreground/70 shrink-0">{e.ts}</span>}
              <span className="font-mono font-semibold text-foreground truncate">
                {cs ? `${cs} ` : ""}<span className="text-muted-foreground">ISSI {e.issi}</span>
              </span>
              {e.dest ? <span className="font-mono text-muted-foreground/80">→ {e.dest}</span> : null}
              <span className={`ml-auto shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px] ${actCls(e.activity)}`}>{actLabel(e.activity)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TxQualityPanel({ q }: { q: TxQuality | null }) {
  const { t } = useI18n();
  if (!q) return null;
  const fmt = (v: number | undefined, d = 2, u = "") => v == null ? "—" : `${v.toFixed(d)}${u}`;
  const evm = q.evm_pct;
  const evmCls = evm == null ? "text-foreground" : evm < 5 ? "text-emerald-300" : evm < 10 ? "text-amber-300" : "text-red-300";
  const items: { label: string; val: string; cls?: string }[] = [
    { label: "EVM", val: fmt(evm, 2, "%"), cls: evmCls },
    { label: "PAPR", val: fmt(q.papr_db, 2, " dB") },
    { label: t("tx_carrier_leakage"), val: fmt(q.carrier_leakage_db, 1, " dB") },
    { label: t("tx_occupied_bw"), val: q.occupied_bandwidth_hz != null ? `${(q.occupied_bandwidth_hz / 1000).toFixed(1)} kHz` : "—" },
    { label: t("tx_iq_amp"), val: fmt(q.iq_amplitude_imbalance_db, 2, " dB") },
    { label: t("tx_iq_phase"), val: fmt(q.iq_phase_imbalance_deg, 2, "°") },
    { label: "DC I", val: fmt(q.dc_offset_i, 3) },
    { label: "DC Q", val: fmt(q.dc_offset_q, 3) },
  ];
  return (
    <div className="glass-panel rounded-md overflow-hidden flex-1" data-testid="panel-tx-quality">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5 bg-amber-500/5">
        <Gauge className="w-4 h-4 text-amber-400" />
        <h2 className="text-xs font-bold tracking-[0.15em] uppercase text-amber-400">{t("tx_quality")}</h2>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3">
        {items.map((it) => (
          <div key={it.label} className="rounded-md border border-white/10 bg-white/[0.02] px-2 py-2 text-center" data-testid={`tx-metric-${it.label}`}>
            <div className="text-[10px] font-bold tracking-[0.12em] uppercase text-muted-foreground mb-1 truncate" title={it.label}>{it.label}</div>
            <div className={`text-sm font-mono font-bold ${it.cls || "text-foreground"}`}>{it.val}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TerminalTable({ terminals, title, icon, isLocal, issiCallsign }: {
  terminals: Terminal[];
  title: string;
  icon: "local" | "external";
  isLocal: boolean;
  issiCallsign: (id: string | number) => string;
}) {
  const { t } = useI18n();
  const tgName = useTgNames();
  // Stable insertion-order: assign each terminal a fixed position when first seen
  const insertionOrder = useRef<Map<string, number>>(new Map());
  const insertionCounter = useRef(0);

  // Call-start order: assigned when a terminal goes from idle → active.
  // Lower number = started talking earlier = appears higher in list.
  // Deleted when terminal goes back to idle, so next call gets a fresh order.
  const callStartOrder = useRef<Map<string, number>>(new Map());
  const callCounter = useRef(0);
  const prevActivityMap = useRef<Map<string, string | null | undefined>>(new Map());

  terminals.forEach(term => {
    // Insertion order (first-seen)
    if (!insertionOrder.current.has(term.id)) {
      insertionOrder.current.set(term.id, insertionCounter.current++);
    }
    // Detect idle → active transition to stamp call-start order
    const prev = prevActivityMap.current.get(term.id);
    const isNowActive = term.activity === "TX" || term.activity === "RX";
    const wasActive = prev === "TX" || prev === "RX";
    if (isNowActive && !wasActive) {
      callStartOrder.current.set(term.id, callCounter.current++);
    } else if (!isNowActive && wasActive) {
      callStartOrder.current.delete(term.id);
    }
    prevActivityMap.current.set(term.id, term.activity);
  });

  const sorted = terminals
    .filter(term => term.isLocal === isLocal)
    .sort((a, b) => {
      const aActive = a.activity === "TX" || a.activity === "RX";
      const bActive = b.activity === "TX" || b.activity === "RX";
      // Active terminals always above idle ones
      if (aActive !== bActive) return bActive ? 1 : -1;
      if (aActive && bActive) {
        // Both active: order by when THIS call started (earlier call = higher up)
        const orderA = callStartOrder.current.get(a.id) ?? 0;
        const orderB = callStartOrder.current.get(b.id) ?? 0;
        if (orderA !== orderB) return orderA - orderB;
        // Same call-start order (e.g., both from same TG): TX above RX
        const rankA = a.activity === "TX" ? 2 : 1;
        const rankB = b.activity === "TX" ? 2 : 1;
        return rankB - rankA;
      }
      // Both idle: stable insertion order (no jumps)
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
              sorted.map(terminal => <TerminalRow key={terminal.id} t={terminal} tgName={tgName} issiCallsign={issiCallsign} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CallHistory({ entries, title, isLocal, issiCallsign }: {
  entries: CallLogEntry[];
  title: string;
  isLocal: boolean;
  issiCallsign: (id: string | number) => string;
}) {
  const { t } = useI18n();
  const tgName = useTgNames();
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
              {entry.callType === "private" ? (
                (() => {
                  const dst = String(entry.targetIssi ?? entry.targetTg ?? "");
                  const dstCs = dst ? issiCallsign(dst) : "";
                  return (
                    <span className="inline-flex items-center gap-1 align-middle">
                      <span className="text-[10px] font-bold border border-cyan-400/60 text-cyan-400 rounded px-1 tracking-wide">PRIV</span>
                      <span className="text-cyan-300 font-semibold">{dst}</span>
                      {dstCs ? (
                        <>
                          {" "}<CountryFlag callsign={dstCs} />
                          <span className="text-cyan-200 font-semibold">({dstCs})</span>
                        </>
                      ) : null}
                    </span>
                  );
                })()
              ) : (
                <>
                  <span className="text-amber-400 font-semibold">TG {entry.targetTg}</span>
                  {(() => { const n=tgName(entry.targetTg); const f=getTgFlag(n,entry.targetTg); return (n||f) ? <span className="text-amber-300/70 text-xs ml-1.5">{f?<span className="text-sm">{f}</span>:null}{f&&n?" ":""}{n}</span> : null; })()}
                </>
              )}
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

const PUBLIC_IP_REVEAL_KEY = "tetra_public_ip_revealed";

function PiStats() {
  const { t } = useI18n();
  const [stats, setStats] = useState<{
    cpuTemp: number | null;
    cpuLoad: number | null;
    memUsed: number | null;
    localIp: string | null;
    publicIp: string | null;
    voltage: number | null;
    hostname: string | null;
  }>({
    cpuTemp: null, cpuLoad: null, memUsed: null, localIp: null, publicIp: null, voltage: null, hostname: null
  });

  // Public IP visibility — persisted only for the current browser session
  const [publicIpRevealed, setPublicIpRevealed] = useState<boolean>(() => {
    try { return sessionStorage.getItem(PUBLIC_IP_REVEAL_KEY) === "1"; } catch { return false; }
  });
  const [askPublicIpPwd, setAskPublicIpPwd] = useState(false);
  const [publicIpPwd, setPublicIpPwd] = useState("");
  const [publicIpErr, setPublicIpErr] = useState<string | null>(null);
  const [publicIpBusy, setPublicIpBusy] = useState(false);

  const setRevealed = (v: boolean) => {
    setPublicIpRevealed(v);
    try { v ? sessionStorage.setItem(PUBLIC_IP_REVEAL_KEY, "1") : sessionStorage.removeItem(PUBLIC_IP_REVEAL_KEY); } catch {}
  };

  const requestReveal = async () => {
    if (!publicIpPwd) return;
    setPublicIpBusy(true);
    setPublicIpErr(null);
    try {
      const res = await fetch("/api/system/verify-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: publicIpPwd }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setPublicIpErr(data.message || "Error");
        setTimeout(() => setPublicIpErr(null), 3000);
        return;
      }
      setRevealed(true);
      setAskPublicIpPwd(false);
      setPublicIpPwd("");
    } catch {
      setPublicIpErr(t("connection_error"));
      setTimeout(() => setPublicIpErr(null), 3000);
    } finally {
      setPublicIpBusy(false);
    }
  };

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
      {stats.hostname && (
        <span className="inline-flex items-center gap-1 text-xs font-mono text-amber-400" title={t("mdns_hostname")} data-testid="stat-mdns-hostname">
          <span className="opacity-60">@</span>
          <a
            href={`http://${stats.hostname}.local`}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline hover:text-amber-300 transition-colors"
            data-testid="link-mdns-hostname"
          >
            {stats.hostname}.local
          </a>
        </span>
      )}
      {stats.publicIp && (
        askPublicIpPwd ? (
          <span className="inline-flex items-center gap-1" data-testid="public-ip-pwd-prompt">
            <Lock className="w-3 h-3 text-amber-400" />
            <input
              type="password"
              value={publicIpPwd}
              autoFocus
              onChange={(e) => { setPublicIpPwd(e.target.value); setPublicIpErr(null); }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && publicIpPwd && !publicIpBusy) requestReveal();
                if (e.key === "Escape") { setAskPublicIpPwd(false); setPublicIpPwd(""); setPublicIpErr(null); }
              }}
              placeholder={t("password")}
              className="w-24 px-2 py-0.5 text-[10px] rounded bg-black/30 border border-white/10 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-amber-500/50"
              data-testid="input-public-ip-password"
            />
            <button
              onClick={requestReveal}
              disabled={!publicIpPwd || publicIpBusy}
              className="px-2 py-0.5 text-[10px] font-bold rounded bg-violet-500/20 text-violet-300 border border-violet-500/30 hover:bg-violet-500/30 transition-colors disabled:opacity-30"
              data-testid="button-public-ip-confirm"
            >
              {t("ok")}
            </button>
            <button
              onClick={() => { setAskPublicIpPwd(false); setPublicIpPwd(""); setPublicIpErr(null); }}
              className="px-2 py-0.5 text-[10px] font-bold rounded bg-white/5 text-muted-foreground border border-white/10 hover:bg-white/10 transition-colors"
              data-testid="button-public-ip-cancel"
            >
              ✕
            </button>
            {publicIpErr && <span className="text-[10px] text-red-400 animate-pulse">{publicIpErr}</span>}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs font-mono text-violet-400" title={t("public_ip")} data-testid="stat-public-ip">
            <Globe className="w-3.5 h-3.5" />
            <span className="select-all">{publicIpRevealed ? stats.publicIp : "•••.•••.•••.•••"}</span>
            <button
              onClick={() => publicIpRevealed ? setRevealed(false) : setAskPublicIpPwd(true)}
              className="ml-0.5 text-violet-300/70 hover:text-violet-200 transition-colors"
              title={publicIpRevealed ? t("hide_public_ip") : t("show_public_ip")}
              data-testid="button-toggle-public-ip"
            >
              {publicIpRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </span>
        )
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

interface BtsInfo {
  tx_freq_hz: number | null;
  rx_freq_hz: number | null;
  shift_hz: number | null;
  mcc: number | null;
  mnc: number | null;
  main_carrier: number | null;
  neighbor_count: number;
  hangtime_secs: number | null;
  whitelist_restricted: boolean;
  whitelist_count: number;
}

function BtsDetails() {
  const { t } = useI18n();
  const [info, setInfo] = useState<BtsInfo | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/btsinfo");
        if (!r.ok) return;
        const d = await r.json();
        if (alive) setInfo(d && Object.keys(d).length ? d : null);
      } catch { /* leave placeholders */ }
    };
    load();
    const id = setInterval(load, 30000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const mhz = (hz: number | null | undefined, dp = 4) =>
    hz != null && isFinite(hz) ? `${(hz / 1e6).toFixed(dp)} MHz` : "—";
  const shiftStr = info?.shift_hz != null && isFinite(info.shift_hz)
    ? `${info.shift_hz >= 0 ? "+" : ""}${(info.shift_hz / 1e6).toFixed(3)} MHz`
    : "—";
  const val = (v: number | null | undefined) => (v == null ? "—" : String(v));
  const n = info?.neighbor_count ?? 0;
  const restricted = !!info?.whitelist_restricted;

  const tiles: { label: string; value: string; cls: string; testid: string }[] = [
    { label: t("bts_tx"), value: mhz(info?.tx_freq_hz), cls: "text-emerald-400", testid: "bts-tx" },
    { label: t("bts_rx"), value: mhz(info?.rx_freq_hz), cls: "text-sky-400", testid: "bts-rx" },
    { label: t("bts_shift"), value: shiftStr, cls: "text-foreground", testid: "bts-shift" },
    { label: t("bts_mcc"), value: val(info?.mcc), cls: "text-foreground", testid: "bts-mcc" },
    { label: t("bts_mnc"), value: val(info?.mnc), cls: "text-foreground", testid: "bts-mnc" },
    { label: t("bts_carrier"), value: val(info?.main_carrier), cls: "text-amber-400", testid: "bts-carrier" },
  ];

  return (
    <div className="glass-panel rounded-md overflow-hidden" data-testid="panel-bts-details">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5 bg-primary/5">
        <RadioTower className="w-4 h-4 text-primary" />
        <h2 className="text-xs font-bold tracking-[0.15em] uppercase text-primary">{t("bts_details")}</h2>
        <div className="ml-auto flex items-center gap-1.5">
          <span
            className={`inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded border ${
              n > 0 ? "text-emerald-400 border-emerald-400/40 bg-emerald-400/5" : "text-muted-foreground border-white/10"
            }`}
            data-testid="bts-neighbor"
          >
            <Network className="w-3 h-3" />
            {t("bts_neighbor")} · {n > 0 ? `${t("bts_on")} (${n} ${n === 1 ? t("bts_neighbor_one") : t("bts_neighbor_other")})` : t("bts_off")}
          </span>
          <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded border text-cyan-400 border-cyan-400/40 bg-cyan-400/5" data-testid="bts-hangtime">
            <ClockIcon className="w-3 h-3" />
            {t("bts_hangtime")} · {info?.hangtime_secs != null ? info.hangtime_secs : "—"} {t("bts_sec")}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 p-3">
        {tiles.map((tile) => (
          <div key={tile.testid} className="rounded-md border border-white/5 bg-black/20 px-3 py-2">
            <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{tile.label}</div>
            <div className={`mt-0.5 font-mono text-sm sm:text-base font-bold ${tile.cls}`} data-testid={`text-${tile.testid}`}>
              {tile.value}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 px-3 pb-3">
        <div className="flex items-center gap-2 flex-1 min-w-0 rounded-md border border-white/5 bg-black/20 px-3 py-2">
          {restricted ? (
            <ShieldAlert className="w-4 h-4 text-orange-400 shrink-0" />
          ) : (
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
          )}
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{t("bts_access")}</div>
            <div className="text-xs text-muted-foreground/80 truncate" data-testid="text-bts-access-sub">
              {restricted ? `${info?.whitelist_count ?? 0} ${t("bts_wl_entries")}` : t("bts_wl_open")}
            </div>
          </div>
          <span
            className={`ml-auto text-[11px] font-bold font-mono px-2.5 py-1 rounded border shrink-0 ${
              restricted
                ? "text-orange-400 border-orange-400/50 bg-orange-400/10"
                : "text-emerald-400 border-emerald-400/50 bg-emerald-400/10"
            }`}
            data-testid="text-bts-access"
          >
            {restricted ? t("bts_restricted") : t("bts_open")}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { t } = useI18n();
  const tgName = useTgNames();
  const { terminals, localHistory, externalHistory, sdsMessages, rfCalls, fsDashboardActive, tsVoiceActivity, emergencies, brewStatus, lastHeard, txQuality, health, sdrHealth, sysHealth, connected } = useTetraWebSocket();
  const terminalList = Object.values(terminals);

  // Build ISSI → callsign lookup so PRIV destinations can show callsign + flag.
  // Custom ISSI names (from Calculator) act as a fallback when there is no real callsign.
  const issiCustom = useIssiCustomNames();
  const issiCallsignMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const [id, name] of Object.entries(issiCustom)) m.set(id, name);
    for (const term of terminalList) {
      if (term.callsign) m.set(String(term.id), term.callsign);
    }
    return m;
  }, [terminalList, issiCustom]);
  const issiCallsign = (id: string | number) => issiCallsignMap.get(String(id)) || "";

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

            <HealthBadge health={health} sdrHealth={sdrHealth} sysHealth={sysHealth} />
            <BrewBadge brewStatus={brewStatus} />

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
        <EmergencyBanner emergencies={emergencies} issiCallsign={issiCallsign} />

        <BtsDetails />

        {fsDashboardActive && <RfChannelTimeslots rfCalls={rfCalls} issiCallsign={issiCallsign} tsVoiceActivity={tsVoiceActivity} />}

        {(lastHeard.length > 0 || txQuality) && (
          <div className="flex flex-col md:flex-row gap-2 sm:gap-3">
            <LastHeardPanel entries={lastHeard} issiCallsign={issiCallsign} />
            <TxQualityPanel q={txQuality} />
          </div>
        )}

        <TerminalTable
          terminals={terminalList}
          title={t("local_terminals")}
          icon="local"
          isLocal={true}
          issiCallsign={issiCallsign}
        />

        <TerminalTable
          terminals={terminalList}
          title={t("external_terminals")}
          icon="external"
          isLocal={false}
          issiCallsign={issiCallsign}
        />

        <div className="flex flex-col md:flex-row gap-3 flex-1">
          <CallHistory
            entries={localHistory}
            title={t("local_history")}
            isLocal={true}
            issiCallsign={issiCallsign}
          />
          <CallHistory
            entries={externalHistory}
            title={t("external_history")}
            isLocal={false}
            issiCallsign={issiCallsign}
          />
        </div>

        <SdsPanel messages={sdsMessages} />
      </main>
    </div>
  );
}
