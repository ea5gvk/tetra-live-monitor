import { Switch, Route, useLocation, Link } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Dashboard from "@/pages/Dashboard";
import Calculator from "@/pages/Calculator";
import LogLive from "@/pages/LogLive";
import GpsMap from "@/pages/GpsMap";
import VpnManager from "@/pages/VpnManager";
import WifiManager from "@/pages/WifiManager";
import FlowstationDash from "@/pages/FlowstationDash";
import NotFound from "@/pages/not-found";
import { Radio, Calculator as CalcIcon, Globe, ScrollText, Sun, Moon, Droplet, Trees, ShieldCheck, Wifi, MapPin, Gauge, Heart, Copy, Check, X, Tag } from "lucide-react";
import { I18nContext, useI18nState, useI18n, LANGUAGES, LANGUAGE_LABELS } from "@/lib/i18n";
import { UpdateChecker } from "@/components/UpdateChecker";
import { BluestationUpdater } from "@/components/BluestationUpdater";
import { FlowstationUpdater } from "@/components/FlowstationUpdater";
import { StationSwitcher } from "@/components/StationSwitcher";
import { SdsSender } from "@/components/SdsSender";
import { KickSender } from "@/components/KickSender";
import { TouchKeyboard, TouchModeToggle } from "@/components/TouchKeyboard";
import { useState, useEffect, useCallback } from "react";

const DONATE_EMAIL = "quini7620@gmail.com";

function DonateModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  function copyEmail() {
    navigator.clipboard.writeText(DONATE_EMAIL).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      const ta = document.createElement("textarea");
      ta.value = DONATE_EMAIL;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.72)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      data-testid="modal-donate"
    >
      <div className="relative w-full max-w-sm rounded-xl border border-white/10 bg-card shadow-2xl overflow-hidden">
        {/* close */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors"
          data-testid="button-donate-close-x"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex flex-col items-center px-6 pt-8 pb-6 gap-4 text-center">
          {/* heart icon */}
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
            style={{ background: "rgba(217,70,219,0.15)", border: "1px solid rgba(217,70,219,0.35)" }}>
            <Heart className="w-7 h-7 text-pink-400" />
          </div>

          {/* title */}
          <h2 className="text-base font-black tracking-widest text-primary uppercase">
            {t("donate_title")}
          </h2>

          {/* amount pill */}
          <div className="flex items-center gap-2 px-5 py-2 rounded-lg font-black text-base"
            style={{ background: "rgba(255,160,0,0.12)", border: "1px solid rgba(255,160,0,0.35)", color: "#ffb300" }}>
            <Heart className="w-4 h-4" />
            {t("donate_amount")}
          </div>

          {/* description */}
          <p className="text-sm text-muted-foreground leading-relaxed">
            {t("donate_desc")}
          </p>

          {/* email row */}
          <div className="w-full">
            <div className="text-[10px] font-semibold tracking-widest text-muted-foreground/60 mb-1">
              {t("donate_account_label")}
            </div>
            <div className="flex items-center gap-2 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2">
              <span className="flex-1 text-left font-mono text-sm text-foreground select-all" data-testid="text-donate-email">
                {DONATE_EMAIL}
              </span>
              <button
                onClick={copyEmail}
                className="flex items-center gap-1.5 px-3 py-1 rounded text-[11px] font-bold transition-all border"
                style={copied
                  ? { background: "rgba(34,197,94,0.15)", borderColor: "rgba(34,197,94,0.4)", color: "#4ade80" }
                  : { background: "rgba(255,255,255,0.07)", borderColor: "rgba(255,255,255,0.15)", color: "var(--muted-foreground)" }}
                data-testid="button-donate-copy"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? t("donate_copied") : t("donate_copy")}
              </button>
            </div>
          </div>

          {/* fine print */}
          <div className="flex items-center gap-1.5 text-[11px] text-emerald-400/80">
            <Check className="w-3.5 h-3.5 flex-shrink-0" />
            {t("donate_fine_print")}
          </div>

          {/* close button */}
          <button
            onClick={onClose}
            className="w-full py-2 rounded-lg border border-white/10 bg-white/5 text-sm font-semibold text-muted-foreground hover:bg-white/10 hover:text-foreground transition-colors"
            data-testid="button-donate-close"
          >
            {t("donate_close")}
          </button>

          {/* footer */}
          <p className="text-[11px] text-muted-foreground/50 italic">
            {t("donate_thanks")}
          </p>
        </div>
      </div>
    </div>
  );
}

function DonateButton() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Donate"
        data-testid="button-paypal-donate"
        className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold select-none transition-all
          bg-[#003087] hover:bg-[#002060] text-white border border-[#0070ba]/60 hover:border-[#ffc439]
          hover:shadow-[0_0_8px_2px_rgba(255,196,57,0.35)] active:scale-95"
      >
        <Heart className="w-3 h-3 text-[#ffc439]" />
        <span className="hidden lg:inline">Donate</span>
      </button>
      {open && <DonateModal onClose={close} />}
    </>
  );
}

const THEME_STORAGE_KEY = "tetra_dashboard_theme";
type Theme = "dark" | "light" | "blue" | "military";
const THEMES: Theme[] = ["dark", "light", "blue", "military"];
const THEME_LABELS: Record<Theme, string> = {
  dark: "DARK", light: "LIGHT", blue: "NAVY", military: "MIL",
};

function getStoredTheme(): Theme {
  try {
    const s = localStorage.getItem(THEME_STORAGE_KEY) as Theme | null;
    if (s && THEMES.includes(s)) return s;
  } catch {}
  return "dark";
}

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(getStoredTheme);

  useEffect(() => {
    const html = document.documentElement;
    html.classList.remove("light", "theme-blue", "theme-military");
    if (theme === "light") html.classList.add("light");
    else if (theme === "blue") html.classList.add("theme-blue");
    else if (theme === "military") html.classList.add("theme-military");
    try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch {}
  }, [theme]);

  function next() {
    const i = THEMES.indexOf(theme);
    setTheme(THEMES[(i + 1) % THEMES.length]);
  }

  const Icon =
    theme === "dark"     ? Sun :
    theme === "light"    ? Moon :
    theme === "blue"     ? Droplet :
                           Trees;

  return (
    <button
      onClick={next}
      className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold rounded bg-white/5 text-muted-foreground border border-white/10 hover:bg-white/10 hover:text-foreground transition-colors"
      title={`Theme: ${THEME_LABELS[theme]} (click to cycle)`}
      data-testid="button-theme-toggle"
    >
      <Icon className="w-3 h-3" />
      <span className="hidden sm:inline">{THEME_LABELS[theme]}</span>
    </button>
  );
}

function LangSelector() {
  const { lang, setLang } = useI18n();
  const idx = LANGUAGES.indexOf(lang);
  const next = LANGUAGES[(idx + 1) % LANGUAGES.length];

  return (
    <button
      onClick={() => setLang(next)}
      className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold rounded bg-white/5 text-muted-foreground border border-white/10 hover:bg-white/10 hover:text-foreground transition-colors"
      title="Change language"
      data-testid="button-lang-selector"
    >
      <Globe className="w-3 h-3" />
      {LANGUAGE_LABELS[lang]}
    </button>
  );
}

function NavBar() {
  const [location] = useLocation();
  const { t } = useI18n();

  const navLinks = [
    { href: "/",           label: "MONITOR",       shortLabel: "MON",    icon: <Radio className="w-3.5 h-3.5 flex-shrink-0" />,    testId: "nav-link-monitor" },
    { href: "/calculator", label: t("calculator"),  shortLabel: "CALC",   icon: <CalcIcon className="w-3.5 h-3.5 flex-shrink-0" />, testId: "nav-link-calculator" },
    { href: "/log-live",   label: t("log_live"),    shortLabel: "LOG",    icon: <ScrollText className="w-3.5 h-3.5 flex-shrink-0" />, testId: "nav-link-log-live" },
    { href: "/gps-map",    label: t("gps_map"),     shortLabel: "GPS",    icon: <MapPin className="w-3.5 h-3.5 flex-shrink-0" />,   testId: "nav-link-gps-map" },
    { href: "/vpn",        label: "VPN",            shortLabel: "VPN",    icon: <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0" />, testId: "nav-link-vpn" },
    { href: "/wifi",       label: t("wifi_manager"),shortLabel: "WIFI",   icon: <Wifi className="w-3.5 h-3.5 flex-shrink-0" />,    testId: "nav-link-wifi" },
    { href: "/flow-dash",  label: t("flow_dash"),   shortLabel: "FLOW",   icon: <Gauge className="w-3.5 h-3.5 flex-shrink-0" />,   testId: "nav-link-flow-dash" },
  ];

  return (
    <nav className="bg-card border-b border-border" data-testid="nav-bar">
      {/* Main nav row */}
      <div className="flex items-center min-h-[40px]">
        {/* Scrollable tabs strip */}
        <div className="flex-1 flex items-center overflow-x-auto scrollbar-none min-w-0 px-1">
          {navLinks.map(link => {
            const active = location === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-2 text-[10px] sm:text-xs font-bold rounded-t whitespace-nowrap transition-colors flex-shrink-0 ${
                  active
                    ? "bg-primary/10 text-primary border border-primary/20 border-b-0"
                    : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                }`}
                data-testid={link.testId}
              >
                {link.icon}
                <span className="hidden sm:inline">{link.label}</span>
                <span className="sm:hidden">{link.shortLabel}</span>
              </Link>
            );
          })}
        </div>

        {/* Right side utilities — visible on md+, hidden on mobile (shown in second row) */}
        <div className="hidden md:flex items-center gap-1.5 px-2 flex-shrink-0">
          <StationSwitcher />
          <BluestationUpdater />
          <FlowstationUpdater />
          <SdsSender />
          <KickSender />
          <UpdateChecker />
          <DonateButton />
          <span
            className="text-[10px] font-black tracking-widest px-2 py-0.5 rounded bg-sky-500/15 text-sky-400 border border-sky-500/30 select-none"
            data-testid="text-callsign"
          >
            @EA5GVK
          </span>
          <LangSelector />
          <TouchModeToggle />
          <ThemeToggle />
        </div>

        {/* Mobile right side — compact */}
        <div className="flex md:hidden items-center gap-1 px-2 flex-shrink-0">
          <LangSelector />
          <TouchModeToggle />
          <ThemeToggle />
        </div>
      </div>

      {/* Mobile second row: actions */}
      <div className="flex md:hidden items-center gap-1.5 px-2 py-1 border-t border-border/40 flex-wrap">
        <StationSwitcher />
        <BluestationUpdater />
        <FlowstationUpdater />
        <SdsSender />
        <KickSender />
        <UpdateChecker />
        <DonateButton />
        <span
          className="text-[9px] font-black tracking-widest px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-400 border border-sky-500/30 select-none"
          data-testid="text-callsign-mobile"
        >
          @EA5GVK
        </span>
      </div>
    </nav>
  );
}

function Router() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <NavBar />
      <div className="flex-1 flex flex-col">
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/calculator" component={Calculator} />
          <Route path="/log-live" component={LogLive} />
          <Route path="/gps-map" component={GpsMap} />
          <Route path="/vpn" component={VpnManager} />
          <Route path="/wifi" component={WifiManager} />
          <Route path="/flow-dash" component={FlowstationDash} />
          <Route component={NotFound} />
        </Switch>
      </div>
    </div>
  );
}

function App() {
  const i18n = useI18nState();

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <I18nContext.Provider value={i18n}>
          <Router />
          <TouchKeyboard />
          <Toaster />
        </I18nContext.Provider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
