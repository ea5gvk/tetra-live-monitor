import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { RadioTower, History, Wrench, Network, Activity, AlertTriangle, WifiOff, Loader2, Info, Radio, Mic } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useDmrTier2, type Tier2Call, type Tier2State, type Tier2NotApplicable } from "@/hooks/useDmrTier2";
import { Card, CountryFlag, DstLabel, ago, fmt, hhmmss, mhz, th, useNow, type NameOf } from "@/pages/DmrDash";

// The DMR Tier II monitor (a conventional repeater, after Pi-Star / WPSD): what MMDVM-Host, DMRGateway and
// MMDVM-Multi write in the journal, as /api/dmr/tier2/state tells it (polled by useDmrTier2).

type T = (k: string) => string;
type Names = Tier2State["names"];

const HEARD_ROWS = 20;
const HEARD_ROWS_ALL = 100;

const pill = "inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-bold whitespace-nowrap";

// Pi-Star's colours: BER 0 none, < 2 % green, 2-5 % amber, >= 5 % red; loss <= 1 % green, 1-3 % amber, > 3 % red
const berCls = (b: number | null) => b === null ? "text-muted-foreground/50" : b === 0 ? "text-muted-foreground" : b < 2 ? "text-emerald-400" : b < 5 ? "text-amber-400" : "text-red-400";
const lossCls = (l: number | null) => l === null ? "text-muted-foreground/50" : l <= 1 ? "text-emerald-400" : l <= 3 ? "text-amber-400" : "text-red-400";

/** The callsign of the caller: from radioid.net (names) or, when DMRIds.dat resolved it, the log's own text. */
function callsignOf(c: Tier2Call, names: Names): string | null {
  const n = c.from_id !== null ? names[String(c.from_id)] : undefined;
  return n?.callsign || (c.from_id === null ? c.from : null);
}

function Caller({ c, names }: { c: Tier2Call; names: Names }) {
  const call = callsignOf(c, names);
  const n = c.from_id !== null ? names[String(c.from_id)] : undefined;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap" title={c.ta ? `«${c.ta}»` : undefined}>
      <CountryFlag callsign={call ?? undefined} />
      {call ? <span className="font-semibold text-foreground">{call}</span> : <span className="font-mono text-primary">{c.from}</span>}
      {call && c.from_id !== null && <span className="font-mono text-[10px] text-muted-foreground">{c.from_id}</span>}
      {n?.name && <span className="text-[11px] text-muted-foreground hidden sm:inline">{n.name}</span>}
    </span>
  );
}

function Target({ c, nameOf }: { c: Tier2Call; nameOf: NameOf }) {
  if (c.to === "ALL") return <span className={`${pill} text-secondary-foreground bg-secondary/50 border-white/5 font-mono`}>ALL</span>;
  return <DstLabel dst={c.group ? c.to : (c.to_id ?? c.to)} group={c.group} nameOf={nameOf} />;
}

function SrcPill({ c, t }: { c: Tier2Call; t: T }) {
  if (c.src === "rf") return <span className={`${pill} text-emerald-300 border-emerald-400/30 bg-emerald-400/10`}>RF</span>;
  return (
    <span className={`${pill} text-amber-300 border-amber-400/30 bg-amber-400/5 gap-1`}>
      {t("dmr2_src_net")}{c.net && <span className="font-normal text-amber-200/90">{c.net}</span>}
    </span>
  );
}

function EndPill({ c, t }: { c: Tier2Call; t: T }) {
  if (!c.end_kind || c.end_kind === "end") return null;
  const cls = c.end_kind === "restart" ? "text-sky-300 border-sky-400/40" : c.end_kind === "timeout" ? "text-amber-300 border-amber-400/40" : "text-red-300 border-red-400/40";
  return <span className={`text-[9px] font-bold uppercase tracking-wider rounded px-1 border ${cls}`} title={t(`dmr2_end_${c.end_kind}_hint`)}>{t(`dmr2_end_${c.end_kind}`)}</span>;
}

const blocksText = (c: Tier2Call, t: T) => c.blocks !== null ? fmt(t("dmr2_blocks"), { n: c.blocks }) : t("dmr2_data");

// ── tiles ──

function Tiles({ d, t }: { d: Tier2State; t: T }) {
  const s = d.station, w = d.window;
  const active = [d.slots["1"], d.slots["2"]];
  const trx = active.some((c) => c?.src === "rf")
    ? { v: t("dmr2_trx_rx"), cls: "text-emerald-300", led: "bg-emerald-400" }
    : d.modem.tx || active.some((c) => c?.src === "net")
      ? { v: "TX DMR", cls: "text-red-400", led: "bg-red-400 rf-led-voice" }
      : { v: t("dmr2_trx_listening"), cls: "text-emerald-400/80", led: "bg-emerald-400/40" };
  const lostCls = w?.rx_lost == null ? "text-muted-foreground" : w.rx_lost === 0 ? "text-emerald-400" : w.rx_lost < 10 ? "text-amber-400" : "text-red-400";
  const m = w?.min_margin_ms ?? null;
  const marginCls = m === null ? "text-muted-foreground" : m < 5 ? "text-red-400" : m < 10 || (w?.tx_late ?? 0) > 0 ? "text-amber-400" : "text-emerald-400";
  const tiles: { id: string; label: string; value: string; sub?: string; cls: string; led?: string; title?: string }[] = [
    { id: "repeater", label: t("dmr2_tile_repeater"), value: s.callsign ?? "—", sub: s.id !== null ? String(s.id) : undefined, cls: "text-foreground" },
    { id: "tx", label: t("dmr2_tile_tx"), value: mhz(s.tx_hz), cls: "text-emerald-400" },
    { id: "rx", label: t("dmr2_tile_rx"), value: mhz(s.rx_hz), cls: "text-sky-400" },
    { id: "cc", label: t("dmr2_tile_cc"), value: s.color_code !== null ? String(s.color_code) : "—", cls: "text-foreground" },
    { id: "trx", label: "TRX", value: trx.v, cls: trx.cls, led: trx.led },
  ];
  if (s.shared) {
    tiles.push(
      {
        id: "sdr", label: t("dmr2_tile_sdr"),
        value: w?.attached ? (w.sdr_rate !== null ? `${Math.round(w.sdr_rate / 1000)} kS/s` : "—") : t("dmr2_sdr_detached"),
        cls: w?.attached ? "text-cyan-400" : "text-amber-400",
        title: w?.attached ? `RX ${w.rx_hz ?? "?"} Hz · TX ${w.tx_hz ?? "?"} Hz · TX gain ${w.tx_gain ?? "?"}` : undefined,
      },
      { id: "margin", label: t("dmr2_tile_margin"), value: m !== null ? `${m.toFixed(1)} ms` : "—", cls: marginCls, title: w?.tx_late ? fmt(t("dmr2_tx_late"), { n: w.tx_late }) : undefined },
      { id: "lost", label: t("dmr2_tile_lost"), value: w?.rx_lost != null ? String(w.rx_lost) : "—", cls: lostCls },
    );
  }
  return (
    <div className={`grid grid-cols-2 sm:grid-cols-4 ${s.shared ? "xl:grid-cols-8" : "lg:grid-cols-5"} gap-2`} data-testid="panel-dmr2-tiles">
      {tiles.map((tile) => (
        <div key={tile.id} className="glass-panel rounded-md px-3 py-2 min-w-0" title={tile.title}>
          <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground truncate">{tile.label}</div>
          <div className={`mt-0.5 font-mono text-sm font-bold truncate flex items-center gap-1.5 ${tile.cls}`} data-testid={`text-dmr2-tile-${tile.id}`}>
            {tile.led && <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${tile.led}`} />}
            <span className="truncate">{tile.value}</span>
          </div>
          {tile.sub && <div className="font-mono text-[10px] text-muted-foreground truncate">{tile.sub}</div>}
        </div>
      ))}
    </div>
  );
}

// ── on air: one big card per timeslot (WPSD's Live Caller) ──

function SlotCard({ n, c, last, names, nameOf, now, t }: { n: 1 | 2; c: Tier2Call | null; last: Tier2Call | undefined; names: Names; nameOf: NameOf; now: number; t: T }) {
  if (!c) {
    return (
      <div className="glass-panel rounded-md p-3 sm:p-4 sm:min-h-[8.5rem] flex flex-col gap-2" data-testid={`panel-dmr2-ts${n}`}>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-white/20" />
          <span className="text-xs font-bold tracking-[0.15em] text-muted-foreground">TS{n}</span>
          <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground/70">{t("dmr2_slot_idle")}</span>
        </div>
        {last && (
          <div className="mt-auto text-[11px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
            <span>{t("dmr2_last")}:</span>
            <Caller c={last} names={names} />
            <span className="text-muted-foreground/60">{">"}</span>
            <Target c={last} nameOf={nameOf} />
            <span>· {fmt(t("dmrd_ago"), { n: ago(last.end ?? last.start, now) })}</span>
          </div>
        )}
      </div>
    );
  }
  const call = callsignOf(c, names);
  const nm = c.from_id !== null ? names[String(c.from_id)] : undefined;
  const where = [nm?.city, nm?.country].filter(Boolean).join(", ");
  const secs = Math.max(0, Math.floor((now - c.start) / 1000));
  return (
    <div className="rounded-md p-3 sm:p-4 sm:min-h-[8.5rem] flex flex-col gap-1.5 border border-red-500/50 bg-red-500/15" data-testid={`panel-dmr2-ts${n}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="w-2.5 h-2.5 rounded-full bg-red-400 rf-led-voice" />
        <span className="text-xs font-bold tracking-[0.15em] text-red-300">TS{n}</span>
        <SrcPill c={c} t={t} />
        {c.kind === "data" && <span className={`${pill} text-violet-300 border-violet-400/30 bg-violet-400/5`}>{blocksText(c, t)}</span>}
        <span className="ml-auto px-2 py-0.5 rounded bg-red-600 text-white font-mono font-bold text-sm" data-testid={`text-dmr2-ts${n}-timer`}>TX {secs} s</span>
      </div>
      <div className="flex items-center gap-2 flex-wrap min-w-0">
        <CountryFlag callsign={call ?? undefined} />
        <span className={`text-2xl sm:text-3xl font-bold tracking-wide break-all ${call ? "text-foreground" : "font-mono text-primary"}`}>{call ?? c.from}</span>
        {call && c.from_id !== null && <span className="font-mono text-xs text-muted-foreground">{c.from_id}</span>}
      </div>
      {(nm?.name || where) && <div className="text-xs text-foreground/80">{[nm?.name, where].filter(Boolean).join(" · ")}</div>}
      <div className="mt-auto flex items-center gap-2 flex-wrap text-xs">
        <span className="text-muted-foreground/70">{">"}</span>
        <Target c={c} nameOf={nameOf} />
        {c.ta && <span className="text-[11px] text-cyan-300 italic break-all">«{c.ta}»</span>}
      </div>
    </div>
  );
}

// ── last heard (RF + network) and local RF activity ──

function HeardCard({ d, names, nameOf, now, rf, t }: { d: Tier2State; names: Names; nameOf: NameOf; now: number; rf: boolean; t: T }) {
  const [all, setAll] = useState(false);
  const active = [d.slots["1"], d.slots["2"]]
    .filter((c): c is Tier2Call => !!c && (!rf || c.src === "rf"))
    .sort((a, b) => b.start - a.start);
  const done = rf ? d.heard.filter((c) => c.src === "rf") : d.heard;
  const shown = done.slice(0, !rf && all ? HEARD_ROWS_ALL : HEARD_ROWS);
  const cols = 8;
  const cell = "px-2 sm:px-3 py-1.5";
  const row = (c: Tier2Call, live: boolean) => (
    <tr key={`${live ? "a" : "h"}-${c.key}`} className={live ? "bg-red-500/10" : "hover:bg-white/[0.02]"} data-testid={`row-dmr2-${rf ? "rf" : "heard"}-${c.key}`}>
      <td className={`${cell} font-mono text-xs text-muted-foreground whitespace-nowrap`}>{hhmmss(c.start)}</td>
      <td className={cell}>
        <span className="inline-flex items-center gap-1.5">
          {live && <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-400 rf-led-voice shrink-0" />}
          <Caller c={c} names={names} />
        </span>
      </td>
      <td className={`${cell} font-mono text-xs text-muted-foreground whitespace-nowrap`}>TS{c.slot}</td>
      <td className={`${cell} whitespace-nowrap`}><Target c={c} nameOf={nameOf} /></td>
      {!rf && <td className={`${cell} whitespace-nowrap`}><SrcPill c={c} t={t} /></td>}
      <td className={`${cell} font-mono text-xs whitespace-nowrap`}>
        <span className="inline-flex items-center gap-1.5">
          {live
            ? <span className="px-1.5 py-0.5 rounded bg-red-600 text-white font-bold">TX {Math.max(0, Math.floor((now - c.start) / 1000))} s</span>
            : c.kind === "data"
              ? <span className={`${pill} text-violet-300 border-violet-400/30 bg-violet-400/5`}>{blocksText(c, t)}</span>
              : <span className="text-foreground">{c.dur !== null ? c.dur.toFixed(1) : "—"}</span>}
          <EndPill c={c} t={t} />
        </span>
      </td>
      {!rf && <td className={`${cell} font-mono text-xs whitespace-nowrap hidden sm:table-cell ${lossCls(c.loss)}`}>{c.loss !== null ? `${c.loss}%` : "—"}</td>}
      <td className={`${cell} font-mono text-xs whitespace-nowrap ${berCls(c.ber)}`}>{c.ber !== null ? `${c.ber.toFixed(1)}%` : "—"}</td>
      {rf && <td className={`${cell} font-mono text-xs whitespace-nowrap text-muted-foreground hidden sm:table-cell`}>{c.rssi ? `${c.rssi.min}/${c.rssi.ave}/${c.rssi.max} dBm` : "—"}</td>}
    </tr>
  );
  return (
    <Card icon={rf ? <Mic className="w-4 h-4" /> : <History className="w-4 h-4" />} title={rf ? t("dmr2_local_rf") : t("dmr2_heard")}
      count={`${shown.length + active.length}`} testid={rf ? "panel-dmr2-rf" : "panel-dmr2-heard"}
      tone={active.length ? "text-red-400" : rf ? "text-emerald-400" : "text-amber-400"} band={active.length ? "bg-red-500/5" : rf ? "bg-emerald-500/5" : "bg-amber-500/5"}
      right={!rf && done.length > HEARD_ROWS ? (
        <button onClick={() => setAll((v) => !v)} className="px-1.5 py-0.5 rounded text-[10px] font-bold border text-muted-foreground border-white/10 hover:text-foreground hover:bg-white/5 transition-colors" data-testid="button-dmr2-heard-more">
          {all ? fmt(t("dmr2_show_less"), { n: HEARD_ROWS }) : fmt(t("dmr2_show_more"), { n: Math.min(done.length, HEARD_ROWS_ALL) })}
        </button>
      ) : undefined}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid={rf ? "table-dmr2-rf" : "table-dmr2-heard"}>
          <thead>
            <tr className="text-muted-foreground text-xs border-b border-white/5">
              <th className={th}>{t("dmr2_th_time")}</th>
              <th className={th}>{t("dmr2_th_callsign")}</th>
              <th className={th}>TS</th>
              <th className={th}>{t("dmr2_th_target")}</th>
              {!rf && <th className={th}>{t("dmr2_th_src")}</th>}
              <th className={th}>{t("dmr2_th_dur")}</th>
              {!rf && <th className={`${th} hidden sm:table-cell`}>{t("dmr2_th_loss")}</th>}
              <th className={th}>BER</th>
              {rf && <th className={`${th} hidden sm:table-cell`}>{t("dmr2_th_rssi")}</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.03]">
            {active.length + shown.length === 0
              ? <tr><td colSpan={cols} className="text-center py-6 text-muted-foreground/50 text-xs">{rf ? t("dmr2_no_rf") : t("dmr2_no_heard")}</td></tr>
              : <>{active.map((c) => row(c, true))}{shown.map((c) => row(c, false))}</>}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ── networks and status ──

function NetsCard({ d, now, t }: { d: Tier2State; now: number; t: T }) {
  const pillOf = (s: string) => s === "up" ? `${pill} text-emerald-300 border-emerald-400/40 bg-emerald-400/10`
    : s === "down" ? `${pill} text-red-300 border-red-400/40 bg-red-500/10`
    : s === "connecting" ? `${pill} text-amber-300 border-amber-400/40 bg-amber-400/10`
    : `${pill} text-muted-foreground border-white/10`;
  return (
    <Card icon={<Network className="w-4 h-4" />} title={t("dmr2_nets")} count={`${d.nets.length}`} testid="panel-dmr2-nets" tone="text-cyan-400" band="bg-cyan-500/5">
      <div className="divide-y divide-white/[0.03]">
        {d.nets.length === 0 && <div className="text-center py-6 text-muted-foreground/50 text-xs">{t("dmr2_no_nets")}</div>}
        {d.nets.map((n) => (
          <div key={n.n} className="px-3 py-2 flex flex-col gap-0.5" data-testid={`row-dmr2-net-${n.n}`}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-[10px] text-muted-foreground">{n.n}</span>
              <span className="font-semibold text-sm text-foreground">{n.name}</span>
              <span className={pillOf(n.status)} data-testid={`badge-dmr2-net-${n.n}`}>{t(`dmr2_net_${n.status}`)}</span>
              {n.since !== null && <span className="ml-auto text-[10px] text-muted-foreground" title={hhmmss(n.since)}>{fmt(t("dmrd_ago"), { n: ago(n.since, now) })}</span>}
            </div>
            {(n.address || n.routes) && (
              <div className="text-[11px] font-mono text-muted-foreground break-all">
                {n.address ? `${n.address}${n.port !== null ? `:${n.port}` : ""}` : ""}
                {n.routes ? `${n.address ? " · " : ""}${t("dmr2_routes")} ${n.routes}` : ""}
              </div>
            )}
            {n.status === "down" && n.reason && <div className="text-[11px] text-red-300 break-words">{n.reason}</div>}
          </div>
        ))}
      </div>
    </Card>
  );
}

function StatusCard({ d, now, t }: { d: Tier2State; now: number; t: T }) {
  const st = d.stack;
  const degraded = st.degraded && st.missing.length > 0;
  const level = d.station.display_level;
  const levelCls = (l: string) => l === "error" ? "text-red-400" : l === "warn" ? "text-amber-400" : "text-muted-foreground";
  return (
    <Card icon={<Activity className="w-4 h-4" />} title={t("dmr2_status")} testid="panel-dmr2-status" tone="text-emerald-400" band="bg-emerald-500/5">
      <div className="p-3 flex flex-col gap-2 text-xs">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`${pill} ${degraded ? "text-amber-300 border-amber-400/40 bg-amber-400/10" : "text-emerald-300 border-emerald-400/40 bg-emerald-400/10"}`} data-testid="badge-dmr2-stack">
            {degraded ? `${t("dmrd_stack_degraded")} · ${t("dmrd_stack_missing")} ${st.missing.join(", ")}` : t("dmrd_stack_running")}
          </span>
          {st.version && <span className="font-mono text-[10px] text-muted-foreground">dmr-tier3 {st.version}</span>}
        </div>
        <div className="flex items-center gap-2 flex-wrap text-muted-foreground" data-testid="text-dmr2-modem">
          <Radio className="w-3.5 h-3.5" />
          <span>{t("dmr2_modem")}:</span>
          <span className={`font-mono font-bold ${d.modem.tx ? "text-red-400" : "text-foreground"}`}>TX {d.modem.tx ? "ON" : "OFF"}</span>
          {d.modem.mode && <span>· {t("dmr2_modem_mode")} <span className="font-mono text-foreground">{d.modem.mode}</span></span>}
          {d.modem.since !== null && <span className="text-[10px]">· {fmt(t("dmrd_ago"), { n: ago(d.modem.since, now) })}</span>}
          {d.station.timeout_s !== null && <span className="text-[10px]">· Timeout {d.station.timeout_s} s</span>}
        </div>
        {level !== null && (level === 0 || level > 2) && (
          <div className="flex items-start gap-2 p-2 rounded border bg-amber-500/10 border-amber-500/30 text-amber-300 text-[11px]" data-testid="banner-dmr2-display-level">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{fmt(t("dmr2_display_level"), { n: level })}</span>
          </div>
        )}
        <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground mt-1">{t("dmr2_alerts")} <span className="font-mono">{d.alerts.length}</span></div>
        <div className="max-h-[260px] overflow-y-auto font-mono text-[11px] space-y-0.5" data-testid="list-dmr2-alerts">
          {d.alerts.length === 0
            ? <div className="text-muted-foreground/50">{t("dmr2_no_alerts")}</div>
            : d.alerts.map((a, i) => (
              <div key={`${a.ts}-${i}`} className="break-words">
                <span className="text-muted-foreground">[{hhmmss(a.ts)}]</span> <span className={levelCls(a.level)}>{a.text}</span>
              </div>
            ))}
        </div>
      </div>
    </Card>
  );
}

function NotApplicable({ na, t }: { na: Tier2NotApplicable; t: T }) {
  return (
    <div className="glass-panel rounded-md p-4 sm:p-6 flex flex-col items-center text-center gap-3 border border-cyan-500/30" data-testid="panel-dmr2-na">
      <Info className="w-10 h-10 text-cyan-400" />
      <h2 className="text-sm font-bold tracking-[0.15em] uppercase text-foreground">{t("dmr2_title")}</h2>
      <p className="text-xs text-muted-foreground max-w-xl leading-relaxed" data-testid="text-dmr2-na">{t(`dmr2_na_${na.reason}`)}</p>
      {na.state?.version && <p className="text-[10px] font-mono text-muted-foreground">dmr-tier3 {na.state.version}</p>}
      <div className="flex items-center gap-2 flex-wrap justify-center">
        <Link href="/dmr" className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded text-white bg-cyan-600 hover:bg-cyan-500 transition-colors" data-testid="button-dmr2-open-dmr">
          <RadioTower className="w-3.5 h-3.5" />
          {t("dmr2_open_dmr")}
        </Link>
        <Link href="/dmr-config" className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded bg-white/10 hover:bg-white/20 text-foreground transition-colors">
          <Wrench className="w-3.5 h-3.5" />
          {t("dmr_config")}
        </Link>
      </div>
    </div>
  );
}

// ── the monitor ──

export function Tier2Monitor() {
  const { t } = useI18n();
  const { data: d, notApplicable, fails, stale, fetchedAt, skew } = useDmrTier2();
  // the server's clock: the call times come from the Pi's journal
  const now = useNow(true) + skew;

  const buttons: ReactNode = (
    <div className="ml-auto flex items-center gap-2 flex-wrap">
      <Link href="/log-live" onClick={() => { try { localStorage.setItem("tetra_log_service", "dmr"); } catch {} }} className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded text-white bg-cyan-600 hover:bg-cyan-500 transition-colors" data-testid="button-dmr2-log">
        <History className="w-3.5 h-3.5" />
        {t("dmr2_log")}
      </Link>
      <Link href="/dmr-config" className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded bg-white/10 hover:bg-white/20 text-foreground transition-colors" data-testid="button-dmr2-config">
        <Wrench className="w-3.5 h-3.5" />
        {t("dmr_config")}
      </Link>
    </div>
  );

  if (notApplicable && !d) return <NotApplicable na={notApplicable} t={t} />;

  const nameOf: NameOf = (id) => (id === undefined || id === null || !d ? undefined : d.names[String(id)]);
  const lastOn = (n: 1 | 2) => d?.heard.find((c) => c.slot === n);

  return (
    <div className="flex flex-col gap-2 sm:gap-3" data-testid="panel-dmr2">
      <div className="flex items-center gap-2 flex-wrap px-1">
        <RadioTower className="w-4 h-4 text-cyan-400" />
        <h2 className="text-xs font-bold tracking-[0.15em] uppercase text-cyan-400" data-testid="text-dmr2-title">{t("dmr2_title")}</h2>
        {d?.demo && <span className="text-[9px] font-bold tracking-widest px-1.5 py-0.5 rounded border border-amber-400/40 text-amber-300 bg-amber-400/5" data-testid="badge-dmr2-demo">DEMO</span>}
        {stale
          ? <span className="inline-flex items-center gap-1 text-[10px] text-red-400"><WifiOff className="w-3 h-3 animate-pulse" />{t("dmr2_no_response_short")}</span>
          : fetchedAt !== null && <span className="text-[10px] font-mono text-muted-foreground" data-testid="text-dmr2-updated">{fmt(t("dmr2_updated"), { t: hhmmss(fetchedAt) })}</span>}
        {buttons}
      </div>

      {stale && (
        <div className="flex items-center gap-2 p-2 rounded bg-red-500/10 border border-red-500/30 text-red-300 text-xs" data-testid="banner-dmr2-stale">
          <WifiOff className="w-4 h-4 shrink-0 animate-pulse" />
          <span>{fmt(t("dmr2_no_response"), { n: fails, t: hhmmss(fetchedAt) })}</span>
        </div>
      )}

      {!d ? (
        <div className="glass-panel rounded-md p-8 text-center text-xs text-muted-foreground" data-testid="text-dmr2-loading">
          {!stale && <Loader2 className="w-4 h-4 animate-spin inline mr-2" />}
          {t("dmr2_loading")}
        </div>
      ) : (
        <div className={`flex flex-col gap-2 sm:gap-3 ${stale ? "opacity-70" : ""}`}>
          <Tiles d={d} t={t} />
          <div>
            <div className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground px-1 pb-1">{t("dmr2_on_air")}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
              <SlotCard n={1} c={d.slots["1"]} last={lastOn(1)} names={d.names} nameOf={nameOf} now={now} t={t} />
              <SlotCard n={2} c={d.slots["2"]} last={lastOn(2)} names={d.names} nameOf={nameOf} now={now} t={t} />
            </div>
          </div>
          <div className="flex flex-col xl:flex-row gap-2 sm:gap-3 items-start">
            <div className="flex-1 min-w-0 w-full flex flex-col gap-2 sm:gap-3">
              <HeardCard d={d} names={d.names} nameOf={nameOf} now={now} rf={false} t={t} />
              <HeardCard d={d} names={d.names} nameOf={nameOf} now={now} rf={true} t={t} />
            </div>
            <div className="xl:w-[22rem] w-full grid grid-cols-1 md:grid-cols-2 xl:grid-cols-1 gap-2 sm:gap-3 items-start">
              <NetsCard d={d} now={now} t={t} />
              <StatusCard d={d} now={now} t={t} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** /dmr/tier2: the monitor on its own (full screen, and the demo on a PC). */
export function Tier2Page() {
  return (
    <main className="flex-1 p-2 sm:p-3 flex flex-col gap-2 sm:gap-3 overflow-auto bg-background text-foreground" data-testid="page-dmr2">
      <Tier2Monitor />
    </main>
  );
}
