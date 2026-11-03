import { useState, useEffect, useCallback, useMemo } from "react";
import { RadioTower, Save, RefreshCw, Wrench, AlertTriangle, CheckCircle2, Lock, X, Eye, EyeOff, Download, RotateCcw, Loader2, KeyRound } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { Switch } from "@/components/ui/switch";
import { OPEN_DMR_UPDATER_EVENT } from "@/components/DmrUpdater";

// The configuration form of the DMR Tier III station: /etc/dmr-tier3/dmr-tier3.conf (KEY=VALUE, not TOML), one
// row per key as GET /api/dmr/config lists them (order, help and section come from the package's example).
// Saving validates with gen-config.py --check on the server; applying stops and starts the whole stack.
interface ConfKey {
  key: string;
  value: string;
  help: string;
  section: string;
  default: string;
  secret: boolean;
  set?: boolean; // secret only: a value is stored in the conf (never sent to the browser)
}

interface ConfResp {
  exists: boolean;
  installed: boolean;
  active: boolean;
  degraded: boolean;
  missing: string[];
  shared?: boolean; // SDR_COMPARTIDO applied (the stack runs next to MiuraStation)
  path: string;
  examplePath: string;
  keys: ConfKey[];
}

interface OpResult {
  ok: boolean;
  errors: string[];
  log: string[];
  applied?: boolean;
}

type Op = "apply" | "save" | "regenerate";
type Kind = { kind: "secret" | "switch" | "number" | "text"; min?: number; max?: number };

// "(a..b)" at the end of a parenthesis in the help = the range gen-config checks; "1 = ..." = a 0/1 flag.
const RANGE_RE = /(\d+)\.\.(\d+|N_CHANNELS)\)/;
const BOOL_RE = /(^|\s)[01] = /;
const MAX_CHANNELS = 4;
// The keys that rewrite the [dmr_window] block of MiuraStation's config.toml (SDR_COMPARTIDO): the server then
// restarts MiuraStation, and with it the stack (Wants=).
const MIURA_KEYS = ["SDR_COMPARTIDO", "TX_FREQUENCY", "RX_FREQUENCY", "N_CHANNELS"];

function channels(values: Record<string, string>): number {
  const n = parseInt(values.N_CHANNELS ?? "", 10);
  return Number.isFinite(n) && n >= 1 && n <= MAX_CHANNELS ? n : MAX_CHANNELS;
}

function kindOf(k: ConfKey, values: Record<string, string>): Kind {
  if (k.secret) return { kind: "secret" };
  const value = values[k.key] ?? "";
  if (BOOL_RE.test(k.help) && /^[01]?$/.test(value)) return { kind: "switch" };
  if (k.key === "N_CHANNELS") return { kind: "number", min: 1, max: MAX_CHANNELS };
  if (k.key === "CONTROL_CHANNEL") return { kind: "number", min: 1, max: channels(values) };
  const m = RANGE_RE.exec(k.help);
  if (m) return { kind: "number", min: parseInt(m[1], 10), max: m[2] === "N_CHANNELS" ? channels(values) : parseInt(m[2], 10) };
  if (/^-?\d+$/.test(k.default) && /^-?\d*$/.test(value)) return { kind: "number" };
  return { kind: "text" };
}

function outOfRange(value: string, kind: Kind): boolean {
  if (kind.kind !== "number" || value === "") return false;
  if (!/^-?\d+$/.test(value)) return true;
  const n = parseInt(value, 10);
  return (kind.min !== undefined && n < kind.min) || (kind.max !== undefined && n > kind.max);
}

function PasswordModal({ title, hint, busy, error, onConfirm, onCancel, t }: {
  title: string; hint?: string; busy: boolean; error: string;
  onConfirm: (password: string) => void; onCancel: () => void; t: (k: string) => string;
}) {
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-card border border-border rounded-lg w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm font-bold text-foreground flex items-center gap-2">
            <Lock className="w-4 h-4 text-cyan-400" />
            {title}
          </span>
          <button onClick={() => !busy && onCancel()} disabled={busy} className="text-muted-foreground hover:text-foreground disabled:opacity-40" data-testid="button-dmr-password-close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          {hint && (
            <div className="flex items-start gap-2 p-2 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[11px]">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{hint}</span>
            </div>
          )}
          <label className="text-[10px] text-muted-foreground">{t("dmr_config_password_hint")}</label>
          <div className="relative">
            <input
              type={show ? "text" : "password"}
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !busy && password && onConfirm(password)}
              disabled={busy}
              autoFocus
              placeholder="••••••••"
              className="w-full bg-background border border-border rounded px-3 py-1.5 pr-8 text-xs text-foreground focus:outline-none focus:border-primary disabled:opacity-50"
              data-testid="input-dmr-config-password"
            />
            <button type="button" onClick={() => setShow(v => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
          {error && <p className="text-xs text-red-400" data-testid="text-dmr-password-error">{error}</p>}
          <div className="flex gap-2 justify-end">
            <button
              onClick={onCancel}
              disabled={busy}
              className="px-3 py-1.5 text-xs font-bold rounded bg-white/10 hover:bg-white/20 text-foreground disabled:opacity-40 transition-colors"
              data-testid="button-dmr-password-cancel"
            >
              {t("dmr_config_cancel")}
            </button>
            <button
              onClick={() => onConfirm(password)}
              disabled={busy || !password}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded bg-cyan-600 hover:bg-cyan-500 text-white disabled:opacity-50 transition-colors"
              data-testid="button-dmr-password-confirm"
            >
              {busy && <Loader2 className="w-3 h-3 animate-spin" />}
              {busy ? t("dmr_config_working") : t("dmr_config_confirm")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DmrConfig() {
  const { t } = useI18n();
  const [data, setData] = useState<ConfResp | null>(null);
  const [loadError, setLoadError] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [original, setOriginal] = useState<Record<string, string>>({});
  const [showSecret, setShowSecret] = useState<Record<string, boolean>>({});
  const [pendingOp, setPendingOp] = useState<Op | null>(null);
  const [busy, setBusy] = useState(false);
  const [opError, setOpError] = useState("");
  const [result, setResult] = useState<{ op: Op; res: OpResult } | null>(null);

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const r = await fetch("/api/dmr/config");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j: ConfResp = await r.json();
      const vals: Record<string, string> = {};
      for (const k of j.keys ?? []) vals[k.key] = k.secret ? "" : (k.value ?? "");
      setData(j);
      setValues(vals);
      setOriginal(vals);
    } catch (e: any) {
      setData(null);
      setLoadError(String(e?.message || e));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const keys = data?.keys ?? [];
  const sections = useMemo(() => {
    const out: { name: string; keys: ConfKey[] }[] = [];
    for (const k of keys) {
      const last = out[out.length - 1];
      if (last && last.name === k.section) last.keys.push(k);
      else out.push({ name: k.section, keys: [k] });
    }
    return out;
  }, [keys]);

  // a secret counts as changed only when something was typed (empty = keep the stored one)
  const changed = useMemo(() => keys.filter(k => (values[k.key] ?? "") !== (original[k.key] ?? "")).map(k => k.key), [keys, values, original]);
  const invalid = useMemo(() => keys.filter(k => outOfRange(values[k.key] ?? "", kindOf(k, values))).map(k => k.key), [keys, values]);
  const installed = !!data?.installed;
  const canSave = installed && !busy && invalid.length === 0 && (changed.length > 0 || data?.exists === false);

  function setValue(key: string, v: string) {
    setValues(prev => ({ ...prev, [key]: v }));
  }

  async function runOp(op: Op, password: string) {
    setBusy(true);
    setOpError("");
    try {
      const body = op === "regenerate"
        ? { password }
        : { password, values: Object.fromEntries(changed.map(k => [k, values[k] ?? ""])), restart: op === "apply" };
      const r = await fetch(op === "regenerate" ? "/api/dmr/regenerate" : "/api/dmr/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j: OpResult = await r.json().catch(() => ({ ok: false, errors: [`${t("dmr_config_error")} (HTTP ${r.status})`], log: [] }));
      if (r.status === 401) {
        setOpError(j.errors?.[0] || t("dmr_config_error"));
        setBusy(false);
        return;
      }
      setPendingOp(null);
      setResult({ op, res: { ok: !!j.ok, errors: j.errors ?? [], log: j.log ?? [], applied: j.applied } });
      setBusy(false);
      // the conf on disk changed (or the stack state did): re-read it, which also clears the pending edits
      if (j.ok || op === "regenerate") load();
    } catch {
      setOpError(t("dmr_config_error"));
      setBusy(false);
    }
  }

  const opTitle = (op: Op) => op === "apply" ? t("dmr_config_save_apply") : op === "save" ? t("dmr_config_save_only") : t("dmr_config_regenerate");
  const restarts = (op: Op) => op !== "save" && !!data?.active;
  const restartsMiura = (op: Op) => op === "regenerate"
    ? !!data?.shared || original.SDR_COMPARTIDO === "1"
    : (!!data?.shared || values.SDR_COMPARTIDO === "1") && changed.some(k => MIURA_KEYS.includes(k));
  const opHint = (op: Op) => [
    restarts(op) ? t("dmr_config_apply_warning") : op === "regenerate" ? t("dmr_config_regenerate_hint") : "",
    restartsMiura(op) ? t("dmr_config_miura_restart_warning") : "",
  ].filter(Boolean).join(" ") || undefined;

  const statusBadge = data && (
    <span
      className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
        data.active
          ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
          : data.degraded
            ? "border-amber-500/40 text-amber-400 bg-amber-500/10"
            : "border-white/10 text-muted-foreground bg-white/5"
      }`}
      title={data.degraded && data.missing?.length ? `${t("station_dmr_degraded")} ${data.missing.join(", ")}` : undefined}
      data-testid="badge-dmr-config-status"
    >
      {data.active ? t("dmr_config_running") : data.degraded ? `${t("dmr_config_degraded")}: ${(data.missing ?? []).join(", ")}` : t("dmr_config_stopped")}
    </span>
  );

  return (
    <div className="p-2 sm:p-4 w-full max-w-5xl mx-auto flex flex-col gap-3" data-testid="page-dmr-config">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <RadioTower className="w-5 h-5 text-cyan-400" />
          <h1 className="text-lg sm:text-xl font-bold tracking-wide" data-testid="text-dmr-config-title">{t("dmr_config_title")}</h1>
          {statusBadge}
        </div>
        <div className="flex items-center gap-2">
          {changed.length > 0 && (
            <>
              <span className="text-[10px] text-amber-300 font-mono" data-testid="text-dmr-config-pending">{changed.length} {t("dmr_config_pending")}</span>
              <button
                onClick={() => setValues(original)}
                disabled={busy}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-border hover:bg-white/5 transition-colors disabled:opacity-40"
                data-testid="button-dmr-config-discard"
              >
                <RotateCcw className="w-3 h-3" />
                <span className="hidden sm:inline">{t("dmr_config_discard")}</span>
              </button>
            </>
          )}
          <button
            onClick={load}
            disabled={busy}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-border hover:bg-white/5 transition-colors disabled:opacity-40"
            data-testid="button-dmr-config-reload"
          >
            <RefreshCw className="w-3 h-3" />
            <span className="hidden sm:inline">{t("dmr_config_reload")}</span>
          </button>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        <code className="font-mono text-cyan-300">{data?.path ?? "/etc/dmr-tier3/dmr-tier3.conf"}</code> — {t("dmr_config_intro")}
      </p>

      {loadError ? (
        <div className="flex items-center gap-2 p-3 rounded bg-red-500/10 border border-red-500/30 text-red-400 text-xs" data-testid="text-dmr-config-load-error">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span className="flex-1">{t("dmr_config_load_error")}: {loadError}</span>
          <button onClick={load} className="px-2 py-1 rounded border border-red-500/30 hover:bg-red-500/10 text-[10px] font-bold">{t("dmr_config_reload")}</button>
        </div>
      ) : data === null ? (
        <p className="text-xs text-muted-foreground animate-pulse" data-testid="text-dmr-config-loading">{t("dmr_config_loading")}</p>
      ) : !data.installed ? (
        <div className="flex items-center gap-2 p-3 rounded bg-orange-500/10 border border-orange-500/30 text-orange-400 text-xs flex-wrap" data-testid="text-dmr-config-not-installed">
          <Download className="w-4 h-4 shrink-0" />
          <span className="flex-1 min-w-[12rem]">{t("dmr_config_not_installed")}</span>
          <button
            onClick={() => window.dispatchEvent(new Event(OPEN_DMR_UPDATER_EVENT))}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded bg-orange-600 hover:bg-orange-500 text-white transition-colors"
            data-testid="button-dmr-config-open-installer"
          >
            <Download className="w-3 h-3" />
            {t("dmr_config_open_installer")}
          </button>
        </div>
      ) : (
        <>
          {!data.exists && (
            <div className="flex items-center gap-2 p-3 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs" data-testid="text-dmr-config-no-conf">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{t("dmr_config_no_conf")}</span>
            </div>
          )}

          {sections.map(sec => (
            <div key={sec.name || "_"} className="bg-card border border-border rounded-lg" data-testid={`section-dmr-config-${sec.name || "misc"}`}>
              {sec.name && (
                <div className="px-3 py-2 border-b border-border text-[10px] font-bold uppercase tracking-wider text-cyan-300">{sec.name}</div>
              )}
              <div className="px-3">
                {sec.keys.map(k => {
                  const kind = kindOf(k, values);
                  const value = values[k.key] ?? "";
                  const isChanged = changed.includes(k.key);
                  const bad = invalid.includes(k.key);
                  const inputCls = `bg-background border rounded px-2 py-1 text-xs font-mono text-foreground focus:outline-none focus:border-primary disabled:opacity-50 ${
                    bad ? "border-red-500/60" : isChanged ? "border-amber-500/60" : "border-border"
                  }`;
                  return (
                    <div key={k.key} className="py-2 border-b border-white/5 last:border-0" data-testid={`row-dmr-config-${k.key}`}>
                      <div className="flex flex-wrap items-center gap-2">
                        <label htmlFor={`dmr-${k.key}`} className={`font-mono text-xs font-bold min-w-[14rem] ${isChanged ? "text-amber-300" : "text-foreground"}`}>
                          {k.key}
                        </label>
                        <div className="flex-1 min-w-[12rem] flex items-center gap-2 flex-wrap">
                          {kind.kind === "switch" ? (
                            <>
                              <Switch
                                id={`dmr-${k.key}`}
                                checked={value === "1"}
                                onCheckedChange={c => setValue(k.key, c ? "1" : "0")}
                                disabled={busy}
                                className="data-[state=checked]:bg-cyan-600"
                                data-testid={`switch-dmr-config-${k.key}`}
                              />
                              <span className="text-[10px] font-mono text-muted-foreground">{value === "1" ? "1" : "0"}</span>
                            </>
                          ) : kind.kind === "secret" ? (
                            <>
                              <div className="relative flex-1 max-w-xs">
                                <input
                                  id={`dmr-${k.key}`}
                                  type={showSecret[k.key] ? "text" : "password"}
                                  value={value}
                                  onChange={e => setValue(k.key, e.target.value)}
                                  disabled={busy}
                                  placeholder={k.set ? "••••••••" : ""}
                                  autoComplete="new-password"
                                  className={`${inputCls} w-full pr-8`}
                                  data-testid={`input-dmr-config-${k.key}`}
                                />
                                <button type="button" onClick={() => setShowSecret(s => ({ ...s, [k.key]: !s[k.key] }))} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                                  {showSecret[k.key] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                </button>
                              </div>
                              <span
                                className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${k.set ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10" : "border-white/10 text-muted-foreground bg-white/5"}`}
                                data-testid={`badge-dmr-config-secret-${k.key}`}
                              >
                                <KeyRound className="w-3 h-3" />
                                {k.set ? t("dmr_config_secret_set") : t("dmr_config_secret_unset")}
                              </span>
                              {k.set && <span className="text-[10px] text-muted-foreground">{t("dmr_config_secret_hint")}</span>}
                            </>
                          ) : kind.kind === "number" ? (
                            <>
                              <input
                                id={`dmr-${k.key}`}
                                type="number"
                                inputMode="numeric"
                                value={value}
                                min={kind.min}
                                max={kind.max}
                                step={1}
                                onChange={e => setValue(k.key, e.target.value)}
                                disabled={busy}
                                className={`${inputCls} w-40`}
                                data-testid={`input-dmr-config-${k.key}`}
                              />
                              {kind.min !== undefined && kind.max !== undefined && (
                                <span className={`text-[10px] font-mono ${bad ? "text-red-400" : "text-muted-foreground"}`}>{t("dmr_config_range")} {kind.min}..{kind.max}</span>
                              )}
                            </>
                          ) : (
                            <input
                              id={`dmr-${k.key}`}
                              type="text"
                              value={value}
                              onChange={e => setValue(k.key, e.target.value)}
                              disabled={busy}
                              spellCheck={false}
                              className={`${inputCls} flex-1 max-w-md`}
                              data-testid={`input-dmr-config-${k.key}`}
                            />
                          )}
                        </div>
                      </div>
                      {k.help && <p className="text-[10px] text-muted-foreground whitespace-pre-line mt-1 leading-relaxed">{k.help}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {keys.length === 0 && (
            <p className="text-xs text-muted-foreground" data-testid="text-dmr-config-empty">{t("dmr_config_no_conf")}</p>
          )}

          <div className="bg-card border border-border rounded-lg p-3 space-y-3 sticky bottom-0" data-testid="bar-dmr-config-actions">
            <div className="flex items-start gap-2 text-[11px] text-amber-300" data-testid="text-dmr-config-apply-warning">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{t("dmr_config_apply_warning")}</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => { setOpError(""); setPendingOp("apply"); }}
                disabled={!canSave}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded bg-cyan-600 hover:bg-cyan-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                data-testid="button-dmr-config-apply"
              >
                <Save className="w-3 h-3" />
                {t("dmr_config_save_apply")}
              </button>
              <button
                onClick={() => { setOpError(""); setPendingOp("save"); }}
                disabled={!canSave}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded bg-white/10 hover:bg-white/20 text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                data-testid="button-dmr-config-save"
              >
                <Save className="w-3 h-3" />
                {t("dmr_config_save_only")}
              </button>
              <button
                onClick={() => { setOpError(""); setPendingOp("regenerate"); }}
                disabled={!installed || busy || !data.exists}
                title={t("dmr_config_regenerate_hint")}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded bg-white/10 hover:bg-white/20 text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                data-testid="button-dmr-config-regenerate"
              >
                <Wrench className="w-3 h-3" />
                {t("dmr_config_regenerate")}
              </button>
              {invalid.length > 0 && (
                <span className="text-[10px] text-red-400 font-mono" data-testid="text-dmr-config-invalid">{invalid.join(", ")}</span>
              )}
            </div>

            {result && (
              <div className="space-y-2" data-testid="text-dmr-config-result">
                {result.res.ok ? (
                  <div className="flex items-center gap-2 p-2 rounded bg-green-500/10 border border-green-500/30 text-green-400 text-xs font-bold">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    {result.op === "regenerate" ? t("dmr_config_regenerated") : result.res.applied ? t("dmr_config_saved_applied") : t("dmr_config_saved_only")}
                  </div>
                ) : (
                  <div className="p-2 rounded bg-red-500/10 border border-red-500/30 text-red-400 text-xs space-y-1">
                    <div className="flex items-center gap-2 font-bold"><AlertTriangle className="w-4 h-4 shrink-0" />{t("dmr_config_errors")}</div>
                    <ul className="list-disc pl-6 font-mono text-[11px]">
                      {result.res.errors.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  </div>
                )}
                {result.res.log.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{t("dmr_config_log")}</p>
                    <pre className="bg-black/60 border border-border rounded p-2 text-[10px] font-mono text-cyan-200 overflow-auto max-h-60 whitespace-pre-wrap break-all leading-relaxed" data-testid="text-dmr-config-log">
                      {result.res.log.join("\n")}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {pendingOp && (
        <PasswordModal
          title={opTitle(pendingOp)}
          hint={opHint(pendingOp)}
          busy={busy}
          error={opError}
          onConfirm={pw => runOp(pendingOp, pw)}
          onCancel={() => { if (!busy) { setPendingOp(null); setOpError(""); } }}
          t={t}
        />
      )}
    </div>
  );
}
