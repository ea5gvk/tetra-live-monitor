import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "wouter";
import {
  RadioTower, Wifi, WifiOff, RefreshCw, Users, PhoneCall, History, Megaphone, MessageSquare, Hexagon, ShieldCheck,
  Clock as ClockIcon, Lock, X, Eye, EyeOff, AlertTriangle, CheckCircle2, Loader2, Download, Network, Zap, Signal,
  MapPin, ListRestart, Timer, Power, Activity, Wrench, Satellite, Info,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { getCountryCode, getFlagEmoji } from "@/lib/callsignFlags";
import { OPEN_DMR_UPDATER_EVENT } from "@/components/DmrUpdater";
import { OPEN_STATION_SWITCHER_EVENT } from "@/components/StationSwitcher";
import { Tier2Monitor } from "@/components/dmr/Tier2Monitor";
import {
  useDmrEvents, eventRadioId, eventCallType, isPrivateType, DMR_ID_MAX, DMR_SMS_MAX, DMR_DGNA_MAX,
  type DmrCmd, type DmrState, type DmrStackState, type DmrChannel, type DmrSlot, type DmrRegistered, type DmrCall,
  type DmrName, type HistoryEntry, type ConnStatus, type CmdResult,
} from "@/hooks/useDmrEvents";

// The DMR Tier III dashboard (phase 3b): what dmrtc's status server reports, in the TETRA dashboard's clothes.
// Data: useDmrEvents (/api/dmr/state + /api/dmr/events); actions: /api/dmr/cmd with the system password.

type T = (k: string) => string;
export type NameOf = (id: number | string | undefined | null) => DmrName | undefined;

const POLL_FORMATS = ["nmea", "binary", "address", "4bcd", "iso7", "iso8", "ip", "utf16", "status"];
const REPLY_WAIT_MS = 6000;

// ── small helpers ──

export const fmt = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));

export function mhz(hz: number | null | undefined): string {
  if (hz == null || !isFinite(hz)) return "—";
  return (hz / 1e6).toFixed(hz % 1000 === 0 ? 4 : 5);
}

export function hhmmss(iso: string | number | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleTimeString("en-GB");
}

function hms(totalS: number): string {
  const s = Math.max(0, Math.floor(totalS));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(r).padStart(2, "0")}s`;
  return `${r}s`;
}

export function ago(iso: string | number | null | undefined, now: number): string {
  if (!iso) return "—";
  const ms = now - new Date(iso).getTime();
  if (!isFinite(ms)) return "—";
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86400)} d`;
}

function callTypeLabel(t: T, type: string | undefined): string {
  switch (type) {
    case "group": return t("dmrd_type_group");
    case "private": return t("dmrd_type_private");
    case "group_packet": return t("dmrd_type_group_packet");
    case "private_packet": return t("dmrd_type_private_packet");
    default: return t("dmrd_type_unknown");
  }
}

function Clock() {
  const [time, setTime] = useState(new Date().toLocaleTimeString("en-GB"));
  useEffect(() => {
    const id = setInterval(() => setTime(new Date().toLocaleTimeString("en-GB")), 1000);
    return () => clearInterval(id);
  }, []);
  return <span data-testid="text-dmr-clock">{time}</span>;
}

/** A ticking "now" (1 s) while `on`; frozen otherwise. */
export function useNow(on: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [on]);
  return now;
}

export function CountryFlag({ callsign }: { callsign?: string }) {
  if (!callsign) return null;
  const cc = getCountryCode(callsign);
  if (!cc) return null;
  return <span className="text-base leading-none select-none" title={cc.toUpperCase()} aria-label={cc.toUpperCase()}>{getFlagEmoji(cc)}</span>;
}

/** A radio: its ID and, when the cache knows it, flag + callsign + name. */
export function RadioLabel({ id, nameOf, withName = true }: { id: number | string | undefined; nameOf: NameOf; withName?: boolean }) {
  if (id === undefined || id === null || id === "") return <span className="text-muted-foreground">?</span>;
  const n = nameOf(id);
  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      <span className="font-mono text-primary">{id}</span>
      {n && (
        <span className="inline-flex items-center gap-1">
          <CountryFlag callsign={n.callsign} />
          <span className="font-semibold text-foreground">{n.callsign}</span>
          {withName && n.name && <span className="text-[10px] text-muted-foreground hidden sm:inline">{n.name}</span>}
        </span>
      )}
    </span>
  );
}

/** The destination of a call or SMS: a talkgroup pill or a radio. */
export function DstLabel({ dst, group, nameOf }: { dst: number | string | undefined; group: boolean; nameOf: NameOf }) {
  if (dst === undefined || dst === null) return <span className="text-muted-foreground">?</span>;
  if (group) return <span className="px-1.5 py-0.5 rounded bg-secondary/50 border border-white/5 text-secondary-foreground text-xs font-mono">TG {dst}</span>;
  return <RadioLabel id={dst} nameOf={nameOf} />;
}

export function Card({ icon, title, count, right, children, testid, tone = "text-primary", band = "bg-primary/5" }: {
  icon: ReactNode; title: string; count?: string; right?: ReactNode; children: ReactNode; testid: string; tone?: string; band?: string;
}) {
  return (
    <div className="glass-panel rounded-md overflow-hidden flex flex-col min-w-0" data-testid={testid}>
      <div className={`flex items-center gap-2 px-3 sm:px-4 py-2 border-b border-white/5 ${band} flex-wrap`}>
        <span className={tone}>{icon}</span>
        <h2 className={`text-xs font-bold tracking-[0.15em] uppercase ${tone}`}>{title}</h2>
        {count !== undefined && <span className="text-[10px] text-muted-foreground font-mono">{count}</span>}
        {right && <div className="ml-auto flex items-center gap-1.5 flex-wrap">{right}</div>}
      </div>
      {children}
    </div>
  );
}

export const th = "text-left px-2 sm:px-3 py-2 font-medium whitespace-nowrap";

// ── events as text (history, modal replies) ──

function describeEvent(e: HistoryEntry, t: T, nameOf: NameOf): ReactNode {
  const radio = (id: number | string | undefined) => id === undefined ? <span className="text-muted-foreground italic">{t("dmrd_ev_unknown_radio")}</span> : <RadioLabel id={id} nameOf={nameOf} />;
  const arrow = <span className="text-muted-foreground/60"> {">"} </span>;
  const call = (label: string, extra?: ReactNode) => {
    const type = eventCallType(e);
    return (
      <>
        <span className="text-foreground">{label}</span>{" "}
        <RadioLabel id={e.src as number} nameOf={nameOf} />{arrow}
        <DstLabel dst={e.dst as number} group={!isPrivateType(type)} nameOf={nameOf} />
        {type && <span className="text-muted-foreground"> · {callTypeLabel(t, type)}</span>}
        {typeof e.network === "boolean" && <span className="text-muted-foreground"> · {e.network ? t("dmrd_via_network") : t("dmrd_via_local")}</span>}
        {e.channel_id !== undefined && <span className="text-muted-foreground"> · ch {String(e.channel_id)}/{String(e.slot)}</span>}
        {extra}
      </>
    );
  };
  switch (e.type) {
    case "registration":
      return <><span className="text-emerald-400">{t("dmrd_ev_registration")}</span> {radio(eventRadioId(e))} <span className="text-muted-foreground">({e.new === false ? t("dmrd_ev_again") : t("dmrd_ev_new")})</span></>;
    case "deregistration":
      return <><span className="text-orange-400">{t("dmrd_ev_deregistration")}</span> {radio(eventRadioId(e))}</>;
    case "mass_registration":
      return <span className="text-emerald-300">{fmt(t("dmrd_ev_mass"), { n: Array.isArray(e.cleared) ? e.cleared.length : 0 })}</span>;
    case "call_start":
      return call(t("dmrd_ev_call_start"));
    case "call_end":
      return call(t("dmrd_ev_call_end"), e.duration_s !== undefined ? <span className="text-amber-300"> · {hms(Number(e.duration_s))}</span> : null);
    case "call_stats":
      return call(t("dmrd_ev_call_stats"), (
        <span className="text-muted-foreground"> · RSSI {Number(e.rssi).toFixed(0)} dBm · BER {Number(e.ber).toFixed(2)}% (max {Number(e.max_ber).toFixed(2)}%) · {hms(Number(e.call_time_s) || 0)}</span>
      ));
    case "channel":
      return <><span className="text-cyan-300">{t("dmrd_ev_channel")}</span> <span className="font-mono">{String(e.channel_id)}/{String(e.slot)}</span>: <span className="text-muted-foreground">{String(e.previous ?? "?")}</span>{arrow}<span className="text-foreground">{String(e.state)}</span>{e.enabled === false && <span className="text-red-400"> · {t("dmrd_slot_disabled").toLowerCase()}</span>}</>;
    case "sms":
      return <><span className="text-sky-400">{t("dmrd_ev_sms")}</span> <RadioLabel id={e.src as number} nameOf={nameOf} />{arrow}<DstLabel dst={e.dst as number} group={e.group === true} nameOf={nameOf} />: <span className="text-foreground">«{String(e.text ?? "")}»</span></>;
    case "call_rejected":
      return <><span className="text-red-400">{t("dmrd_ev_rejected")}</span> <RadioLabel id={e.src as number} nameOf={nameOf} />{arrow}<span className="font-mono">{String(e.dst)}</span> <span className="text-muted-foreground">({e.local ? t("dmrd_via_local") : t("dmrd_via_network")})</span></>;
    case "ping":
      return e.ok === true
        ? <><span className="text-violet-400">{t("dmrd_ev_ping_ok")}</span> {radio(eventRadioId(e))}: <span className="text-foreground font-mono">{String(e.ms)} ms</span></>
        : <span className="text-violet-400/80">{t("dmrd_ev_ping_timeout")}</span>;
    case "position":
      return <><span className="text-violet-400">{t("dmrd_ev_position")}</span> {radio(eventRadioId(e))}: <span className="text-foreground break-all">{String(e.text ?? "")}</span></>;
    case "auth":
      return e.success ? <span className="text-emerald-400">{t("dmrd_ev_auth_ok")}</span> : <span className="text-red-400">{t("dmrd_ev_auth_fail")}</span>;
    case "subscriptions":
      return <><span className="text-cyan-300">{t("dmrd_ev_subscriptions")}</span>: <span className="font-mono text-foreground">{(Array.isArray(e.talkgroups) ? e.talkgroups : []).join(", ") || "—"}</span></>;
    case "gateway":
      return <span className="text-emerald-300">{t("dmrd_ev_gateway")}</span>;
    case "announce":
      return <><span className="text-cyan-300">{t("dmrd_ev_announce")}</span>: <span className="text-foreground">{String(e.text ?? "")}</span></>;
    case "command":
      return e.local
        ? <><span className="text-red-400">{t("dmrd_ev_command")} {String(e.cmd)} {t("dmrd_ev_command_rejected")}</span>{e.error ? <span className="text-red-300">: {String(e.error)}</span> : null}</>
        : <><span className="text-amber-300">{t("dmrd_ev_command")}</span> <span className="font-mono text-foreground">{String(e.cmd)}</span>{e.args && typeof e.args === "object" && Object.keys(e.args as object).length > 0 && <span className="text-muted-foreground break-all"> {JSON.stringify(e.args)}</span>}</>;
    case "log": {
      const level = String(e.level ?? "info");
      const cls = level === "critical" || level === "fatal" ? "text-red-400" : level === "warning" ? "text-amber-400" : "text-muted-foreground";
      return <><span className={`${cls} uppercase text-[10px]`}>[{level}]</span> <span className="text-muted-foreground/90 break-words">{String(e.msg ?? "")}</span></>;
    }
    default:
      return <><span className="text-muted-foreground">{e.type}</span> <span className="text-muted-foreground/70 break-all">{JSON.stringify(Object.fromEntries(Object.entries(e).filter(([k]) => !["key", "ts", "type", "id", "local"].includes(k))))}</span></>;
  }
}

type Filter = "all" | "registration" | "call" | "sms" | "ping" | "site" | "command" | "log";
const FILTERS: Filter[] = ["all", "registration", "call", "sms", "ping", "site", "command", "log"];
const FILTER_TYPES: Record<Exclude<Filter, "all">, string[]> = {
  registration: ["registration", "deregistration", "mass_registration"],
  call: ["call_start", "call_end", "call_stats", "call_rejected"],
  sms: ["sms"],
  ping: ["ping", "position", "auth"],
  site: ["announce", "gateway", "subscriptions", "channel"],
  command: ["command"],
  log: ["log"],
};

// ── actions (modal with arguments + system password) ──

interface Field {
  name: string; label: string; hint?: string;
  kind: "id" | "text" | "bool" | "ids" | "select";
  required?: boolean; options?: string[]; value?: string | boolean;
}
interface ActionSpec {
  cmd: DmrCmd; title: string; hint?: string; fields: Field[];
  fixed?: Record<string, unknown>; danger?: boolean;
  reply?: string;          // event type that answers the command (ping, auth, position)
  replyRadio?: number;     // the radio it should come from
}

const parseIds = (s: string): number[] | null => {
  const parts = s.split(/[\s,;]+/).filter(Boolean);
  const out: number[] = [];
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null;
    const n = Number(p);
    if (n < 1 || n > DMR_ID_MAX) return null;
    out.push(n);
  }
  return out;
};

function ActionModal({ spec, onClose, sendCmd, history, nameOf, initialPassword, onPassword, t }: {
  spec: ActionSpec; onClose: () => void;
  sendCmd: (password: string, cmd: DmrCmd, args: Record<string, unknown>) => Promise<CmdResult>;
  history: HistoryEntry[]; nameOf: NameOf; initialPassword: string; onPassword: (pw: string) => void; t: T;
}) {
  const [values, setValues] = useState<Record<string, string | boolean>>(() => Object.fromEntries(spec.fields.map((f) => [f.name, f.value ?? (f.kind === "bool" ? false : f.kind === "select" ? (f.options?.[0] ?? "") : "")])));
  const [password, setPassword] = useState(initialPassword);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [sentAt, setSentAt] = useState<string | null>(null);
  const [result, setResult] = useState<CmdResult | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  // the history entries that already existed when the command was sent: the reply is whatever of the right
  // type shows up after them (the Pi's clock and the browser's may differ, so timestamps are not compared)
  const seenAtSend = useRef<Set<string> | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape" && !busy) onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  // the reply event, when the command has one: the first of that type that arrived after the send, from that
  // radio (or from an unidentified one: dmrtc 3a may not say which)
  const reply = useMemo(() => {
    const seen = seenAtSend.current;
    if (!sentAt || !spec.reply || !seen) return undefined;
    return [...history].reverse().find((h) => h.type === spec.reply && !seen.has(h.key) && !h.local && (spec.replyRadio === undefined || eventRadioId(h) === undefined || eventRadioId(h) === spec.replyRadio));
  }, [history, sentAt, spec.reply, spec.replyRadio]);

  useEffect(() => {
    if (!sentAt || !spec.reply || reply) return;
    const id = setTimeout(() => setTimedOut(true), REPLY_WAIT_MS);
    return () => clearTimeout(id);
  }, [sentAt, spec.reply, reply]);

  function build(): Record<string, unknown> | null {
    const args: Record<string, unknown> = { ...(spec.fixed ?? {}) };
    const errs: Record<string, string> = {};
    for (const f of spec.fields) {
      const v = values[f.name];
      switch (f.kind) {
        case "id": {
          const s = String(v ?? "").trim();
          if (!s && !f.required) break;
          if (!/^\d+$/.test(s) || Number(s) < 1 || Number(s) > DMR_ID_MAX) { errs[f.name] = t("dmrd_invalid_id"); break; }
          args[f.name] = Number(s);
          break;
        }
        case "text": {
          const s = String(v ?? "").trim();
          if (!s || s.length > DMR_SMS_MAX) { errs[f.name] = t("dmrd_invalid_text"); break; }
          args[f.name] = s;
          break;
        }
        case "bool": args[f.name] = v === true; break;
        case "ids": {
          const ids = parseIds(String(v ?? ""));
          if (ids === null || ids.length > DMR_DGNA_MAX) { errs[f.name] = t("dmrd_invalid_dgids"); break; }
          args[f.name] = ids;
          break;
        }
        case "select": args[f.name] = String(v ?? ""); break;
      }
    }
    setFieldErr(errs);
    return Object.keys(errs).length ? null : args;
  }

  async function run() {
    if (busy || !password) return;
    const args = build();
    if (!args) return;
    setBusy(true);
    setError("");
    const r = await sendCmd(password, spec.cmd, args);
    setBusy(false);
    if (!r.ok) {
      setError(r.message || t("dmr_config_error"));
      return;
    }
    onPassword(password);
    seenAtSend.current = new Set(history.map((h) => h.key));
    setResult(r);
    setSentAt(new Date().toISOString());
  }

  const sent = !!result;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" data-testid="modal-dmr-action">
      <div className="bg-card border border-border rounded-lg w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm font-bold text-foreground flex items-center gap-2">
            <Lock className={`w-4 h-4 ${spec.danger ? "text-amber-400" : "text-cyan-400"}`} />
            {spec.title}
          </span>
          <button onClick={() => !busy && onClose()} disabled={busy} className="text-muted-foreground hover:text-foreground disabled:opacity-40" data-testid="button-dmr-action-close-x">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          {spec.hint && (
            <div className={`flex items-start gap-2 p-2 rounded text-[11px] border ${spec.danger ? "bg-amber-500/10 border-amber-500/30 text-amber-300" : "bg-white/5 border-white/10 text-muted-foreground"}`}>
              {spec.danger ? <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> : <Info className="w-4 h-4 shrink-0 mt-0.5" />}
              <span>{spec.hint}</span>
            </div>
          )}
          <div className="text-[10px] font-mono text-muted-foreground">POST /api/dmr/cmd · {spec.cmd}{spec.fixed && Object.entries(spec.fixed).map(([k, v]) => ` · ${k}=${String(v)}`)}</div>

          {spec.fields.map((f) => (
            <div key={f.name} className="space-y-1" data-testid={`field-dmr-action-${f.name}`}>
              {f.kind === "bool" ? (
                <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
                  <input type="checkbox" checked={values[f.name] === true} disabled={sent || busy} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.checked }))} className="accent-cyan-500" />
                  {f.label}
                </label>
              ) : (
                <>
                  <label className="text-[10px] text-muted-foreground uppercase tracking-wider">{f.label}{f.required && " *"}</label>
                  {f.kind === "select" ? (
                    <select value={String(values[f.name] ?? "")} disabled={sent || busy} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                      className="w-full bg-background border border-border rounded px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary disabled:opacity-50">
                      {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : f.kind === "text" ? (
                    <textarea value={String(values[f.name] ?? "")} disabled={sent || busy} rows={3} maxLength={DMR_SMS_MAX}
                      onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                      className={`w-full bg-background border rounded px-3 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary disabled:opacity-50 ${fieldErr[f.name] ? "border-red-500/60" : "border-border"}`} />
                  ) : (
                    <input type="text" inputMode="numeric" value={String(values[f.name] ?? "")} disabled={sent || busy} spellCheck={false}
                      onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                      className={`w-full bg-background border rounded px-3 py-1.5 text-xs font-mono text-foreground focus:outline-none focus:border-primary disabled:opacity-50 ${fieldErr[f.name] ? "border-red-500/60" : "border-border"}`} />
                  )}
                  {f.hint && <p className="text-[10px] text-muted-foreground">{f.hint}</p>}
                </>
              )}
              {fieldErr[f.name] && <p className="text-[10px] text-red-400">{f.label}: {fieldErr[f.name]}</p>}
            </div>
          ))}

          {!sent && (
            <>
              <label className="text-[10px] text-muted-foreground">{t("dmr_config_password_hint")}</label>
              <div className="relative">
                <input
                  type={show ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && run()}
                  disabled={busy}
                  autoFocus={spec.fields.length === 0}
                  placeholder="••••••••"
                  className="w-full bg-background border border-border rounded px-3 py-1.5 pr-8 text-xs text-foreground focus:outline-none focus:border-primary disabled:opacity-50"
                  data-testid="input-dmr-action-password"
                />
                <button type="button" onClick={() => setShow((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </>
          )}

          {error && <p className="text-xs text-red-400 flex items-center gap-1.5" data-testid="text-dmr-action-error"><AlertTriangle className="w-3.5 h-3.5 shrink-0" />{error}</p>}

          {sent && (
            <div className="space-y-2" data-testid="text-dmr-action-result">
              <div className="flex items-center gap-2 p-2 rounded bg-green-500/10 border border-green-500/30 text-green-400 text-xs font-bold">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                {t("dmrd_sent")}
              </div>
              {spec.reply && (
                <div className="p-2 rounded bg-black/40 border border-border text-xs font-mono">
                  {reply ? (
                    <><span className="text-muted-foreground">[{hhmmss(reply.ts)}] </span>{describeEvent(reply, t, nameOf)}</>
                  ) : timedOut ? (
                    <span className="text-amber-300">{fmt(t("dmrd_no_reply"), { s: REPLY_WAIT_MS / 1000 })}</span>
                  ) : (
                    <span className="text-muted-foreground inline-flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" />{t("dmrd_waiting_reply")}</span>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <button onClick={onClose} disabled={busy} className="px-3 py-1.5 text-xs font-bold rounded bg-white/10 hover:bg-white/20 text-foreground disabled:opacity-40 transition-colors" data-testid="button-dmr-action-cancel">
              {sent ? t("update_close") : t("dmr_config_cancel")}
            </button>
            {!sent && (
              <button onClick={run} disabled={busy || !password}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded text-white disabled:opacity-50 transition-colors ${spec.danger ? "bg-amber-600 hover:bg-amber-500" : "bg-cyan-600 hover:bg-cyan-500"}`}
                data-testid="button-dmr-action-confirm">
                {busy && <Loader2 className="w-3 h-3 animate-spin" />}
                {busy ? t("dmr_config_working") : t("dmrd_send")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── the cards ──

function StackCard({ conn, stack, reason, onRetry, t }: { conn: ConnStatus; stack: DmrStackState | null; reason: string; onRetry: () => void; t: T }) {
  const notInstalled = stack !== null && !stack.installed;
  const degraded = !!stack?.degraded && (stack?.missing?.length ?? 0) > 0;
  const unreachable = conn === "unreachable";
  // SDR shared with MiuraStation: the stack is started with MIURA+DMR and the TETRA stays on air
  const [shared, setShared] = useState(false);
  useEffect(() => {
    fetch("/api/station/active").then(r => r.ok ? r.json() : null).then(j => setShared(!!j?.dmr?.shared)).catch(() => {});
  }, []);
  // Tier II (DMR_TIER=2): a conventional repeater without dmrtc; the Tier II monitor (journal of MMDVM-Host,
  // DMRGateway, MMDVM-Multi) takes the place of this dashboard. A Tier II stack not on air (stopped, degraded,
  // not installed) shows the card below like a Tier III one.
  if (conn === "tier2" && stack?.installed && stack.active) return <Tier2Monitor />;
  const open = () => {
    if (notInstalled) window.dispatchEvent(new Event(OPEN_DMR_UPDATER_EVENT));
    else window.dispatchEvent(new CustomEvent(OPEN_STATION_SWITCHER_EVENT, { detail: { station: "dmr" } }));
    window.scrollTo({ top: 0 });
  };
  return (
    <div className={`glass-panel rounded-md p-4 sm:p-6 flex flex-col items-center text-center gap-3 border ${unreachable ? "border-amber-500/30" : "border-white/5"}`} data-testid="panel-dmr-stack">
      {unreachable ? <Wrench className="w-10 h-10 text-amber-400" /> : notInstalled ? <Download className="w-10 h-10 text-orange-400" /> : <Power className="w-10 h-10 text-muted-foreground" />}
      <h2 className="text-sm font-bold tracking-[0.15em] uppercase text-foreground">
        {unreachable ? t("dmrd_unreachable_title") : notInstalled ? t("dmrd_stack_not_installed") : degraded ? `${t("dmrd_stack_degraded").toUpperCase()}` : t("dmrd_stack_stopped")}
      </h2>
      <p className="text-xs text-muted-foreground max-w-xl leading-relaxed" data-testid="text-dmr-stack-explain">
        {unreachable ? t("dmrd_unreachable_explain") : notInstalled ? t("dmr_config_not_installed") : degraded ? `${t("dmrd_degraded_explain")} ${stack?.missing.join(", ")}` : t(shared ? "dmrd_stopped_explain_shared" : "dmrd_stopped_explain")}
      </p>
      {reason && !["stopped", "unreachable", "sse"].includes(reason) && <p className="text-[10px] font-mono text-muted-foreground/70 break-all max-w-xl">{reason}</p>}
      {stack?.version && <p className="text-[10px] font-mono text-muted-foreground">dmr-tier3 {stack.version}</p>}
      <div className="flex items-center gap-2 flex-wrap justify-center">
        {!unreachable && (
          <button onClick={open} className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded text-white transition-colors ${notInstalled ? "bg-orange-600 hover:bg-orange-500" : "bg-cyan-600 hover:bg-cyan-500"}`} data-testid="button-dmr-stack-open">
            {notInstalled ? <Download className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />}
            {notInstalled ? t("dmr_config_open_installer") : t("dmrd_open_switcher")}
          </button>
        )}
        {unreachable && (
          <button onClick={() => window.dispatchEvent(new Event(OPEN_DMR_UPDATER_EVENT))} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded text-white bg-amber-600 hover:bg-amber-500 transition-colors" data-testid="button-dmr-stack-update">
            <Download className="w-3.5 h-3.5" />
            {t("dmr_update")}
          </button>
        )}
        <button onClick={onRetry} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded bg-white/10 hover:bg-white/20 text-foreground transition-colors" data-testid="button-dmr-stack-retry">
          <RefreshCw className="w-3.5 h-3.5" />
          {t("dmrd_retry")}
        </button>
        <Link href="/dmr-config" className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded bg-white/10 hover:bg-white/20 text-foreground transition-colors">
          <Wrench className="w-3.5 h-3.5" />
          {t("dmr_config")}
        </Link>
      </div>
    </div>
  );
}

function Tiles({ s, t }: { s: DmrState; t: T }) {
  const cc = s.config?.control_channel;
  const tiles: { label: string; value: string; cls: string; id: string }[] = [
    { label: t("dmrd_tile_system_code"), value: String(s.config?.system_code ?? "—"), cls: "text-foreground", id: "system-code" },
    { label: t("dmrd_tile_control"), value: cc ? `${cc.channel_id} / ${t("dmrd_slot")} ${cc.slot}` : "—", cls: "text-cyan-400", id: "control" },
    { label: t("dmrd_tile_channels"), value: String(s.channels?.length ?? s.config?.channel_number ?? "—"), cls: "text-foreground", id: "channels" },
    { label: t("dmrd_tile_registered"), value: String(s.registered?.length ?? 0), cls: "text-emerald-400", id: "registered" },
    { label: t("dmrd_tile_calls"), value: String(s.calls_active?.length ?? 0), cls: (s.calls_active?.length ?? 0) > 0 ? "text-red-400" : "text-foreground", id: "calls" },
    { label: t("dmrd_tile_tgs"), value: (s.config?.local_tg_ids ?? []).join(", ") || "—", cls: "text-amber-400", id: "tgs" },
    { label: t("dmrd_tile_subscribed"), value: (s.subscribed_talkgroups ?? []).join(", ") || "—", cls: "text-sky-400", id: "subscribed" },
    { label: t("dmrd_tile_registration"), value: `${s.config?.registration_required ? t("dmrd_required") : t("dmrd_optional")} · ${t("dmrd_auth").toLowerCase()} ${s.config?.authentication_required ? t("dmrd_required") : t("dmrd_optional")}`, cls: "text-foreground", id: "registration" },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2" data-testid="panel-dmr-tiles">
      {tiles.map((tile) => (
        <div key={tile.id} className="glass-panel rounded-md px-3 py-2 min-w-0">
          <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground truncate">{tile.label}</div>
          <div className={`mt-0.5 font-mono text-sm font-bold truncate ${tile.cls}`} title={tile.value} data-testid={`text-dmr-tile-${tile.id}`}>{tile.value}</div>
        </div>
      ))}
    </div>
  );
}

function SlotCell({ ch, slot, nameOf, onToggle, t }: { ch: DmrChannel; slot: DmrSlot | undefined; nameOf: NameOf; onToggle: (ch: DmrChannel, slot: DmrSlot) => void; t: T }) {
  if (!slot) return <span className="text-muted-foreground/50">—</span>;
  const cls = slot.state === "control" ? "text-cyan-300 border-cyan-400/40 bg-cyan-400/10"
    : slot.state === "busy" ? "text-red-300 border-red-400/50 bg-red-500/15 rf-led-voice"
    : slot.state === "disabled" ? "text-muted-foreground/70 border-white/10 bg-white/5 line-through"
    : "text-emerald-300 border-emerald-400/30 bg-emerald-400/5";
  const label = slot.state === "control" ? t("dmrd_slot_control") : slot.state === "busy" ? t("dmrd_slot_busy") : slot.state === "disabled" ? t("dmrd_slot_disabled") : t("dmrd_slot_idle");
  const c = slot.call;
  return (
    <div className="flex flex-col gap-1 min-w-[9rem]">
      <div className="flex items-center gap-1.5">
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${cls}`} data-testid={`badge-dmr-slot-${ch.channel_id}-${slot.slot}`}>{label}</span>
        {!slot.control && (
          <button onClick={() => onToggle(ch, slot)} title={slot.enabled ? t("dmrd_disable_slot") : t("dmrd_enable_slot")}
            className={`p-0.5 rounded border transition-colors ${slot.enabled ? "text-muted-foreground border-white/10 hover:text-red-300 hover:border-red-400/40" : "text-emerald-300 border-emerald-400/30 hover:bg-emerald-400/10"}`}
            data-testid={`button-dmr-slot-toggle-${ch.channel_id}-${slot.slot}`}>
            <Power className="w-3 h-3" />
          </button>
        )}
      </div>
      {c && slot.state === "busy" && (
        <div className="text-[11px] leading-tight">
          <RadioLabel id={c.src} nameOf={nameOf} withName={false} />
          <span className="text-muted-foreground/60"> {">"} </span>
          <DstLabel dst={c.dst} group={!isPrivateType(c.type)} nameOf={nameOf} />
          <div className="text-[10px] text-muted-foreground">{callTypeLabel(t, c.type)} · {c.network ? t("dmrd_via_network") : t("dmrd_via_local")}{c.call_time_s > 0 && ` · ${hms(c.call_time_s)}`}</div>
        </div>
      )}
      {slot.state !== "busy" && slot.text && <div className="text-[10px] text-muted-foreground/70 truncate max-w-[14rem]" title={slot.text}>{slot.text}</div>}
    </div>
  );
}

function ChannelsCard({ s, nameOf, onToggle, t }: { s: DmrState; nameOf: NameOf; onToggle: (ch: DmrChannel, slot: DmrSlot) => void; t: T }) {
  const channels = s.channels ?? [];
  return (
    <Card icon={<Network className="w-4 h-4" />} title={t("dmrd_channels")} count={`${channels.length}`} testid="panel-dmr-channels"
      right={<span className="text-[10px] font-mono text-muted-foreground">{s.config?.freq_base ? `${mhz(s.config.freq_base)} + n×${(s.config.freq_separation / 1e3).toFixed(1)} kHz · split ${(s.config.freq_duplexsplit / 1e6).toFixed(1)} MHz` : ""}</span>}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="table-dmr-channels">
          <thead>
            <tr className="text-muted-foreground text-xs border-b border-white/5">
              <th className={th}>{t("dmrd_th_channel")}</th>
              <th className={`${th} hidden sm:table-cell`}>{t("dmrd_th_lcn")}</th>
              <th className={th}>{t("dmrd_th_tx")}</th>
              <th className={`${th} hidden md:table-cell`}>{t("dmrd_th_rx")}</th>
              <th className={`${th} hidden sm:table-cell`}>{t("dmrd_th_cc")}</th>
              <th className={th}>{t("dmrd_th_slot1")}</th>
              <th className={th}>{t("dmrd_th_slot2")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.03]">
            {channels.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-8 text-muted-foreground/50 text-xs">{t("dmrd_no_channels")}</td></tr>
            ) : channels.map((ch) => (
              <tr key={ch.channel_id} className="hover:bg-white/[0.02]" data-testid={`row-dmr-channel-${ch.channel_id}`}>
                <td className="px-2 sm:px-3 py-2 whitespace-nowrap">
                  <span className="font-mono font-bold text-foreground">{ch.channel_id}</span>
                  {ch.control && <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wider text-cyan-300 border border-cyan-400/40 rounded px-1">{t("dmrd_role_control")}</span>}
                </td>
                <td className="px-2 sm:px-3 py-2 font-mono text-muted-foreground hidden sm:table-cell">{ch.logical_channel}</td>
                <td className="px-2 sm:px-3 py-2 font-mono text-emerald-400 whitespace-nowrap">{mhz(ch.tx_freq)}</td>
                <td className="px-2 sm:px-3 py-2 font-mono text-sky-400 whitespace-nowrap hidden md:table-cell">{mhz(ch.rx_freq)}</td>
                <td className="px-2 sm:px-3 py-2 font-mono text-muted-foreground hidden sm:table-cell">{ch.colour_code}</td>
                <td className="px-2 sm:px-3 py-2 align-top"><SlotCell ch={ch} slot={ch.slots?.find((x) => x.slot === 1)} nameOf={nameOf} onToggle={onToggle} t={t} /></td>
                <td className="px-2 sm:px-3 py-2 align-top"><SlotCell ch={ch} slot={ch.slots?.find((x) => x.slot === 2)} nameOf={nameOf} onToggle={onToggle} t={t} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function RadiosCard({ s, nameOf, onAction, t }: { s: DmrState; nameOf: NameOf; onAction: (spec: ActionSpec) => void; t: T }) {
  const now = useNow(true);
  const radios = useMemo(() => [...(s.registered ?? [])].sort((a, b) => (a.last_seen < b.last_seen ? 1 : a.last_seen > b.last_seen ? -1 : a.id - b.id)), [s.registered]);
  const specsFor = (r: DmrRegistered): { key: string; icon: ReactNode; label: string; spec: ActionSpec }[] => {
    const who = `${t("dmrd_for_radio")} ${r.id}${nameOf(r.id)?.callsign ? ` (${nameOf(r.id)!.callsign})` : ""}`;
    return [
      { key: "ping", icon: <Zap className="w-3.5 h-3.5" />, label: t("dmrd_act_ping"), spec: { cmd: "pingRadio", title: `${t("dmrd_act_ping")} · ${who}`, fields: [{ name: "group", label: t("dmrd_f_group_ping"), kind: "bool", value: false }], fixed: { id: r.id }, reply: "ping", replyRadio: r.id } },
      { key: "status", icon: <Activity className="w-3.5 h-3.5" />, label: t("dmrd_act_status"), spec: { cmd: "pollStatus", title: `${t("dmrd_act_status")} · ${who}`, hint: t("dmrd_act_status_hint"), fields: [], fixed: { id: r.id } } },
      { key: "position", icon: <MapPin className="w-3.5 h-3.5" />, label: t("dmrd_act_position"), spec: { cmd: "pollData", title: `${t("dmrd_act_position")} · ${who}`, fields: [{ name: "poll_format", label: t("dmrd_f_format"), kind: "select", options: POLL_FORMATS }], fixed: { id: r.id }, reply: "position", replyRadio: r.id } },
      { key: "sms", icon: <MessageSquare className="w-3.5 h-3.5" />, label: t("dmrd_act_sms"), spec: { cmd: "sendUDTShortMessage", title: `${t("dmrd_act_sms")} · ${who}`, fields: [{ name: "text", label: t("dmrd_f_text"), hint: t("dmrd_f_text_hint"), kind: "text", required: true }], fixed: { dst: r.id, group: false } } },
      { key: "dgna", icon: <Hexagon className="w-3.5 h-3.5" />, label: t("dmrd_act_dgna"), spec: { cmd: "sendUDTDGNA", title: `${t("dmrd_act_dgna")} · ${who}`, fields: [{ name: "dgids", label: t("dmrd_f_dgids"), hint: t("dmrd_f_dgids_hint"), kind: "ids", value: r.dgna.join(", ") }, { name: "attach", label: t("dmrd_f_attach"), kind: "bool", value: true }], fixed: { dst: r.id } } },
      { key: "auth", icon: <ShieldCheck className="w-3.5 h-3.5" />, label: t("dmrd_act_auth"), spec: { cmd: "sendAuthCheck", title: `${t("dmrd_act_auth")} · ${who}`, hint: t("dmrd_act_auth_hint"), fields: [], fixed: { id: r.id }, reply: "auth" } },
    ];
  };
  return (
    <Card icon={<Users className="w-4 h-4" />} title={t("dmrd_registered")} count={`${radios.length} ${radios.length === 1 ? t("dmrd_radio_one") : t("dmrd_radio_other")}`} testid="panel-dmr-registered" tone="text-emerald-400" band="bg-emerald-500/5">
      <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
        <table className="w-full text-sm" data-testid="table-dmr-registered">
          <thead>
            <tr className="text-muted-foreground text-xs border-b border-white/5">
              <th className={th}>{t("dmrd_th_id")}</th>
              <th className={th}>{t("dmrd_th_callsign")}</th>
              <th className={`${th} hidden sm:table-cell`}>{t("dmrd_th_tgs")}</th>
              <th className={`${th} hidden md:table-cell`}>{t("dmrd_th_dgna")}</th>
              <th className={`${th} hidden lg:table-cell`}>{t("dmrd_th_since")}</th>
              <th className={th}>{t("dmrd_th_last")}</th>
              <th className={`${th} text-right`}>{t("dmrd_th_actions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.03]">
            {radios.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-8 text-muted-foreground/50 text-xs">{t("dmrd_no_registered")}</td></tr>
            ) : radios.map((r) => {
              const n = nameOf(r.id);
              const busy = (s.calls_active ?? []).some((c) => c.src === r.id || (isPrivateType(c.type) && c.dst === r.id));
              return (
                <tr key={r.id} className={`hover:bg-white/[0.02] ${busy ? "bg-red-500/5" : ""}`} data-testid={`row-dmr-radio-${r.id}`}>
                  <td className="px-2 sm:px-3 py-2 font-mono font-bold text-primary whitespace-nowrap">
                    {busy && <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-400 rf-led-voice mr-1.5 align-middle" />}
                    {r.id}
                  </td>
                  <td className="px-2 sm:px-3 py-2">
                    {n ? (
                      <span className="inline-flex items-center gap-1.5 flex-wrap">
                        <CountryFlag callsign={n.callsign} />
                        <span className="font-semibold text-foreground">{n.callsign}</span>
                        {n.name && <span className="text-[11px] text-muted-foreground">{n.name}</span>}
                        {(n.city || n.country) && <span className="text-[10px] text-muted-foreground/60 hidden lg:inline">{[n.city, n.country].filter(Boolean).join(", ")}</span>}
                      </span>
                    ) : <span className="text-muted-foreground/50">—</span>}
                  </td>
                  <td className="px-2 sm:px-3 py-2 font-mono text-xs text-amber-300 hidden sm:table-cell">{r.talkgroups?.length ? r.talkgroups.join(", ") : <span className="text-muted-foreground/50">—</span>}</td>
                  <td className="px-2 sm:px-3 py-2 font-mono text-xs text-violet-300 hidden md:table-cell">{r.dgna?.length ? r.dgna.join(", ") : <span className="text-muted-foreground/50">—</span>}</td>
                  <td className="px-2 sm:px-3 py-2 font-mono text-xs text-muted-foreground whitespace-nowrap hidden lg:table-cell" title={r.registered_at}>{hhmmss(r.registered_at)}</td>
                  <td className="px-2 sm:px-3 py-2 font-mono text-xs text-muted-foreground whitespace-nowrap" title={r.last_seen}>{fmt(t("dmrd_ago"), { n: ago(r.last_seen, now) })}</td>
                  <td className="px-2 sm:px-3 py-2">
                    <div className="flex items-center justify-end gap-0.5 sm:gap-1">
                      {specsFor(r).map((a) => (
                        <button key={a.key} onClick={() => onAction(a.spec)} title={a.label}
                          className="p-1 rounded border border-white/10 text-muted-foreground hover:text-cyan-300 hover:border-cyan-400/40 hover:bg-cyan-400/10 transition-colors"
                          data-testid={`button-dmr-radio-${a.key}-${r.id}`}>
                          {a.icon}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function CallsCard({ s, nameOf, t }: { s: DmrState; nameOf: NameOf; t: T }) {
  const calls = s.calls_active ?? [];
  const now = useNow(calls.length > 0);
  const duration = (c: DmrCall) => {
    if (c.started) { const d = (now - new Date(c.started).getTime()) / 1000; if (isFinite(d) && d >= 0) return hms(d); }
    return c.call_time_s ? hms(c.call_time_s) : "—";
  };
  return (
    <Card icon={<PhoneCall className="w-4 h-4" />} title={t("dmrd_calls")} count={`${calls.length} ${calls.length === 1 ? t("dmrd_call_one") : t("dmrd_call_other")}`} testid="panel-dmr-calls" tone={calls.length ? "text-red-400" : "text-primary"} band={calls.length ? "bg-red-500/5" : "bg-primary/5"}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid="table-dmr-calls">
          <thead>
            <tr className="text-muted-foreground text-xs border-b border-white/5">
              <th className={th}>{t("dmrd_th_channel")}</th>
              <th className={th}>{t("dmrd_th_src")}</th>
              <th className={th}>{t("dmrd_th_dst")}</th>
              <th className={`${th} hidden sm:table-cell`}>{t("dmrd_th_type")}</th>
              <th className={`${th} hidden md:table-cell`}>{t("dmrd_th_origin")}</th>
              <th className={th}>{t("dmrd_th_duration")}</th>
              <th className={`${th} hidden sm:table-cell`}>{t("dmrd_th_rssi")}</th>
              <th className={`${th} hidden sm:table-cell`}>{t("dmrd_th_ber")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.03]">
            {calls.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-6 text-muted-foreground/50 text-xs">{t("dmrd_no_calls")}</td></tr>
            ) : calls.map((c) => (
              <tr key={`${c.index}-${c.src}-${c.dst}`} className="bg-red-500/5" data-testid={`row-dmr-call-${c.index}`}>
                <td className="px-2 sm:px-3 py-2 font-mono whitespace-nowrap"><span className="inline-block w-1.5 h-1.5 rounded-full bg-red-400 rf-led-voice mr-1.5 align-middle" />{c.channel_id}/{c.slot}</td>
                <td className="px-2 sm:px-3 py-2"><RadioLabel id={c.src} nameOf={nameOf} /></td>
                <td className="px-2 sm:px-3 py-2"><DstLabel dst={c.dst} group={!isPrivateType(c.type)} nameOf={nameOf} /></td>
                <td className="px-2 sm:px-3 py-2 text-xs text-muted-foreground hidden sm:table-cell">{callTypeLabel(t, c.type)}</td>
                <td className="px-2 sm:px-3 py-2 text-xs hidden md:table-cell">
                  <span className={`px-1.5 py-0.5 rounded border text-[10px] font-bold uppercase ${c.network ? "text-amber-300 border-amber-400/30 bg-amber-400/5" : "text-emerald-300 border-emerald-400/30 bg-emerald-400/5"}`}>{c.network ? t("dmrd_via_network") : t("dmrd_via_local")}</span>
                </td>
                <td className="px-2 sm:px-3 py-2 font-mono text-amber-300 whitespace-nowrap">{duration(c)}</td>
                <td className="px-2 sm:px-3 py-2 font-mono text-xs text-muted-foreground hidden sm:table-cell">{c.rssi ? `${c.rssi.toFixed(0)} dBm` : "—"}</td>
                <td className="px-2 sm:px-3 py-2 font-mono text-xs text-muted-foreground hidden sm:table-cell">{c.ber || c.max_ber ? `${c.ber.toFixed(2)}% (max ${c.max_ber.toFixed(2)}%)` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function HistoryCard({ history, nameOf, t }: { history: HistoryEntry[]; nameOf: NameOf; t: T }) {
  const [filter, setFilter] = useState<Filter>("all");
  const shown = useMemo(() => filter === "all" ? history : history.filter((h) => FILTER_TYPES[filter].includes(h.type)), [history, filter]);
  return (
    <Card icon={<History className="w-4 h-4" />} title={t("dmrd_history")} count={`${shown.length}${filter !== "all" ? ` / ${history.length}` : ""} ${history.length === 1 ? t("entry_one") : t("entry_other")}`} testid="panel-dmr-history" tone="text-amber-400" band="bg-amber-500/5"
      right={FILTERS.map((f) => (
        <button key={f} onClick={() => setFilter(f)}
          className={`px-1.5 py-0.5 rounded text-[10px] font-bold border transition-colors ${filter === f ? "bg-amber-500/20 text-amber-300 border-amber-400/40" : "text-muted-foreground border-white/10 hover:text-foreground hover:bg-white/5"}`}
          data-testid={`button-dmr-filter-${f}`}>
          {t(`dmrd_filter_${f}`)}
        </button>
      ))}>
      <div className="overflow-y-auto p-2 sm:p-3 font-mono text-xs min-h-[150px] max-h-[420px] space-y-0.5" data-testid="list-dmr-history">
        {shown.length === 0 ? (
          <div className="text-muted-foreground/50 text-center py-8 text-xs">{t("dmrd_no_history")}</div>
        ) : shown.map((h, i) => (
          <div key={h.key} className={`py-0.5 px-1.5 sm:px-2 rounded whitespace-normal ${i === 0 && (h.type === "call_start" || h.type === "sms") ? "bg-red-500/10" : ""}`} data-testid={`history-${h.key}`}>
            <span className="text-muted-foreground">[{hhmmss(h.ts)}]</span>{" "}
            {describeEvent(h, t, nameOf)}
          </div>
        ))}
      </div>
    </Card>
  );
}

function ActionsCard({ s, onAction, t }: { s: DmrState; onAction: (spec: ActionSpec) => void; t: T }) {
  const tgs = (s.config?.local_tg_ids ?? []);
  const actions: { key: string; icon: ReactNode; label: string; spec: ActionSpec; cls: string }[] = [
    { key: "mass", icon: <ListRestart className="w-3.5 h-3.5" />, label: t("dmrd_act_mass"), cls: "text-amber-300 border-amber-400/30 hover:bg-amber-400/10", spec: { cmd: "requestMassRegistration", title: t("dmrd_act_mass"), hint: t("dmrd_act_mass_hint"), danger: true, fields: [] } },
    { key: "time", icon: <ClockIcon className="w-3.5 h-3.5" />, label: t("dmrd_act_time"), cls: "text-cyan-300 border-cyan-400/30 hover:bg-cyan-400/10", spec: { cmd: "announceLocalTime", title: t("dmrd_act_time"), fields: [], reply: "announce" } },
    { key: "freqs", icon: <Signal className="w-3.5 h-3.5" />, label: t("dmrd_act_freqs"), cls: "text-cyan-300 border-cyan-400/30 hover:bg-cyan-400/10", spec: { cmd: "announceSystemFreqs", title: t("dmrd_act_freqs"), fields: [], reply: "announce" } },
    { key: "message", icon: <Megaphone className="w-3.5 h-3.5" />, label: t("dmrd_act_message"), cls: "text-cyan-300 border-cyan-400/30 hover:bg-cyan-400/10", spec: { cmd: "announceSystemMessage", title: t("dmrd_act_message"), hint: s.config?.system_announcement_message ? `«${s.config.system_announcement_message}»` : undefined, fields: [], reply: "announce" } },
    { key: "adjacent", icon: <Satellite className="w-3.5 h-3.5" />, label: t("dmrd_act_adjacent"), cls: "text-cyan-300 border-cyan-400/30 hover:bg-cyan-400/10", spec: { cmd: "announceAdjacentSites", title: t("dmrd_act_adjacent"), fields: [], reply: "announce" } },
    { key: "sms", icon: <MessageSquare className="w-3.5 h-3.5" />, label: t("dmrd_act_sms_site"), cls: "text-sky-300 border-sky-400/30 hover:bg-sky-400/10", spec: { cmd: "sendUDTShortMessage", title: t("dmrd_act_sms_site"), fields: [
      { name: "dst", label: t("dmrd_f_dst"), hint: `${t("dmrd_f_dst_hint")}${tgs.length ? ` · TG: ${tgs.join(", ")}` : ""}`, kind: "id", required: true, value: tgs.length ? String(tgs[0]) : "" },
      { name: "group", label: t("dmrd_f_group"), kind: "bool", value: tgs.length > 0 },
      { name: "text", label: t("dmrd_f_text"), hint: t("dmrd_f_text_hint"), kind: "text", required: true },
    ] } },
    { key: "dgna", icon: <Hexagon className="w-3.5 h-3.5" />, label: t("dmrd_act_dgna_site"), cls: "text-violet-300 border-violet-400/30 hover:bg-violet-400/10", spec: { cmd: "sendUDTDGNA", title: t("dmrd_act_dgna_site"), fields: [
      { name: "dst", label: t("dmrd_f_radio"), kind: "id", required: true },
      { name: "dgids", label: t("dmrd_f_dgids"), hint: t("dmrd_f_dgids_hint"), kind: "ids" },
      { name: "attach", label: t("dmrd_f_attach"), kind: "bool", value: true },
    ] } },
    { key: "snapshot", icon: <RefreshCw className="w-3.5 h-3.5" />, label: t("dmrd_act_snapshot"), cls: "text-muted-foreground border-white/10 hover:bg-white/5", spec: { cmd: "requestStatusSnapshot", title: t("dmrd_act_snapshot"), hint: t("dmrd_act_snapshot_hint"), fields: [] } },
  ];
  return (
    <Card icon={<Megaphone className="w-4 h-4" />} title={t("dmrd_actions")} testid="panel-dmr-actions" tone="text-cyan-400" band="bg-cyan-500/5"
      right={<span className="text-[10px] text-muted-foreground hidden sm:inline">{t("dmrd_act_hint")}</span>}>
      <div className="flex flex-wrap gap-2 p-3">
        {actions.map((a) => (
          <button key={a.key} onClick={() => onAction(a.spec)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-[11px] font-bold transition-colors bg-black/20 ${a.cls}`}
            data-testid={`button-dmr-site-${a.key}`}>
            {a.icon}
            {a.label}
          </button>
        ))}
      </div>
    </Card>
  );
}

// ── the page ──

export default function DmrDash() {
  const { t } = useI18n();
  const { state, stack, conn, connReason, history, fetchedAt, latencyMs, refresh, sendCmd, nameOf } = useDmrEvents();
  const [action, setAction] = useState<ActionSpec | null>(null);
  // the system password typed for the last accepted action, offered again for the next one while the page lives
  const pwRef = useRef("");

  const live = conn === "live";
  // the stack card only when the server said so: with the SSE already open and the first state still in flight
  // the page shows the loading placeholder, never a false "stopped"
  const showStack = conn === "stopped" || conn === "unreachable" || conn === "tier2";
  const gw = state?.gateway;
  const gwLabel = !gw ? "" : !gw.enabled ? t("dmrd_gw_disabled") : gw.logged_in === true ? t("dmrd_gw_logged_in") : gw.logged_in === null ? t("dmrd_gw_unknown") : t("dmrd_gw_waiting");
  const gwCls = !gw || !gw.enabled ? "text-muted-foreground border-white/10" : gw.logged_in === true ? "text-emerald-400 border-emerald-400/40 bg-emerald-400/5" : "text-amber-400 border-amber-400/40 bg-amber-400/5";

  const connBadge = conn === "live"
    ? { icon: <Wifi className="w-4 h-4 text-emerald-400" />, text: t("dmrd_live"), cls: "text-emerald-400" }
    : conn === "stopped"
      ? { icon: <Power className="w-4 h-4 text-muted-foreground" />, text: t("dmrd_stack_stopped"), cls: "text-muted-foreground" }
      : conn === "unreachable"
        ? { icon: <WifiOff className="w-4 h-4 text-amber-400" />, text: t("dmrd_no_status_server"), cls: "text-amber-400" }
        : conn === "tier2"
          ? { icon: <Info className="w-4 h-4 text-cyan-400" />, text: "DMR TIER II", cls: "text-cyan-400" }
          : conn === "loading"
            ? { icon: <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />, text: t("dmrd_loading"), cls: "text-muted-foreground" }
            : { icon: <WifiOff className="w-4 h-4 text-red-400 animate-pulse" />, text: t("dmrd_reconnecting"), cls: "text-red-400" };

  // the direction comes from the button pressed and goes as a fixed argument (a checkbox to tick would read
  // backwards): the modal states it in its title and in its fixed-arguments line
  const toggleSlot = (ch: DmrChannel, slot: DmrSlot) => setAction({
    cmd: "setChannelEnabled",
    title: `${slot.enabled ? t("dmrd_disable_slot") : t("dmrd_enable_slot")} · ${fmt(t("dmrd_confirm_slot"), { slot: slot.slot, ch: ch.channel_id })}`,
    hint: t("dmrd_slot_disable_hint"),
    danger: slot.enabled,
    fields: [],
    fixed: { channel_id: ch.channel_id, slot: slot.slot, enabled: !slot.enabled },
    reply: "channel",
  });

  return (
    <div className="flex-1 bg-background text-foreground font-sans flex flex-col" data-testid="page-dmr-dash">
      <header className="bg-card border-b border-border px-3 sm:px-4 py-2 sticky top-0 z-40" data-testid="header-dmr">
        <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <RadioTower className="w-5 h-5 text-cyan-400" />
            <h1 className="text-xs sm:text-sm font-bold tracking-wide text-foreground" data-testid="text-dmr-title">{conn === "tier2" ? t("dmr2_title") : t("dmrd_title")}</h1>
          </div>
          <span className="text-muted-foreground text-xs hidden sm:inline">|</span>
          <span className="text-foreground font-mono text-xs sm:text-sm font-semibold"><Clock /></span>

          <div className="flex items-center gap-2 sm:gap-3 ml-auto flex-wrap">
            {state && (
              <>
                <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded border text-cyan-300 border-cyan-400/40 bg-cyan-400/5" title={`${t("dmrd_dmrtc_version")} · ${t("dmrd_uptime")} ${hms(state.uptime_s)}`} data-testid="badge-dmr-version">
                  <Timer className="w-3 h-3" />
                  dmrtc {state.version} · {hms(state.uptime_s)}
                </span>
                <span className={`hidden sm:inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded border ${gwCls}`} title={gw?.enabled ? `${gw.address || "?"} · ${gw.gateways?.map((g) => g.gateway_name).join(", ") || ""}${gw.logged_in_at ? ` · ${hhmmss(gw.logged_in_at)}` : ""}` : undefined} data-testid="badge-dmr-gateway">
                  <Network className="w-3 h-3" />
                  {t("dmrd_gateway")} · {gwLabel}{gw?.enabled && gw.address ? <span className="hidden lg:inline"> · {gw.address}</span> : null}
                </span>
                <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded border text-emerald-400 border-emerald-400/40 bg-emerald-400/5" data-testid="badge-dmr-stack">
                  <Activity className="w-3 h-3" />
                  {t("dmrd_stack_running")}
                </span>
              </>
            )}
            {!state && stack && (
              <span className={`inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded border ${stack.degraded ? "text-amber-400 border-amber-400/40 bg-amber-400/5" : stack.active ? "text-emerald-400 border-emerald-400/40 bg-emerald-400/5" : "text-muted-foreground border-white/10"}`} data-testid="badge-dmr-stack">
                <Power className="w-3 h-3" />
                {stack.degraded ? `${t("dmrd_stack_degraded")} · ${t("dmrd_stack_missing")} ${stack.missing.join(", ")}` : stack.active ? t("dmrd_stack_running") : stack.installed ? t("dmr_config_stopped") : t("dmr_not_installed")}
              </span>
            )}
            <button onClick={refresh} className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold rounded bg-white/5 text-muted-foreground border border-white/10 hover:bg-white/10 hover:text-foreground transition-colors" title={fetchedAt ? `${t("dmrd_updated")} ${hhmmss(fetchedAt)}${latencyMs != null ? ` · ${latencyMs} ms` : ""}` : t("dmrd_refresh")} data-testid="button-dmr-refresh">
              <RefreshCw className="w-3 h-3" />
              <span className="hidden sm:inline">{t("dmrd_refresh")}</span>
            </button>
            <span className="inline-flex items-center gap-1.5" data-testid="status-dmr-connection" title={connReason || undefined}>
              {connBadge.icon}
              <span className={`text-xs font-medium ${connBadge.cls}`} data-testid="text-dmr-connection">{connBadge.text}</span>
            </span>
          </div>
        </div>
      </header>

      <main className="flex-1 p-2 sm:p-3 flex flex-col gap-2 sm:gap-3 overflow-auto">
        {conn === "reconnecting" && state && (
          <div className="flex items-center gap-2 p-2 rounded bg-red-500/10 border border-red-500/30 text-red-300 text-xs" data-testid="banner-dmr-reconnecting">
            <WifiOff className="w-4 h-4 shrink-0 animate-pulse" />
            <span>{t("dmrd_reconnecting_banner")} {hhmmss(fetchedAt)}{connReason && connReason !== "sse" ? ` (${connReason})` : ""}</span>
          </div>
        )}

        {showStack ? (
          <StackCard conn={conn} stack={stack} reason={connReason} onRetry={refresh} t={t} />
        ) : !state ? (
          <div className="glass-panel rounded-md p-8 text-center text-xs text-muted-foreground animate-pulse" data-testid="text-dmr-loading">{t("dmrd_loading")}</div>
        ) : (
          <div className={conn === "reconnecting" ? "opacity-70 flex flex-col gap-2 sm:gap-3" : "flex flex-col gap-2 sm:gap-3"}>
            <Tiles s={state} t={t} />
            <ChannelsCard s={state} nameOf={nameOf} onToggle={toggleSlot} t={t} />
            <RadiosCard s={state} nameOf={nameOf} onAction={setAction} t={t} />
            <CallsCard s={state} nameOf={nameOf} t={t} />
            <div className="flex flex-col lg:flex-row gap-2 sm:gap-3 items-stretch">
              <div className="flex-1 min-w-0 flex flex-col"><HistoryCard history={history} nameOf={nameOf} t={t} /></div>
              <div className="lg:w-[22rem] flex flex-col"><ActionsCard s={state} onAction={setAction} t={t} /></div>
            </div>
          </div>
        )}

        {showStack && history.length > 0 && <HistoryCard history={history} nameOf={nameOf} t={t} />}
      </main>

      {action && (
        <ActionModal
          spec={action}
          onClose={() => setAction(null)}
          sendCmd={sendCmd}
          history={history}
          nameOf={nameOf}
          initialPassword={pwRef.current}
          onPassword={(pw) => { pwRef.current = pw; }}
          t={t}
        />
      )}
    </div>
  );
}
