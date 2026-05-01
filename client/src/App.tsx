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
import NotFound from "@/pages/not-found";
import { Radio, Calculator as CalcIcon, Globe, ScrollText, Sun, Moon, ShieldCheck, Wifi, MapPin } from "lucide-react";
import { SiPaypal } from "react-icons/si";
import { I18nContext, useI18nState, useI18n, LANGUAGES, LANGUAGE_LABELS } from "@/lib/i18n";
import { UpdateChecker } from "@/components/UpdateChecker";
import { BluestationUpdater } from "@/components/BluestationUpdater";
import { useState, useEffect } from "react";

const THEME_STORAGE_KEY = "tetra_dashboard_theme";

function getStoredTheme(): "dark" | "light" {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {}
  return "dark";
}

function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">(getStoredTheme);

  useEffect(() => {
    const html = document.documentElement;
    if (theme === "light") {
      html.classList.add("light");
    } else {
      html.classList.remove("light");
    }
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {}
  }, [theme]);

  return (
    <button
      onClick={() => setTheme(t => t === "dark" ? "light" : "dark")}
      className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold rounded bg-white/5 text-muted-foreground border border-white/10 hover:bg-white/10 hover:text-foreground transition-colors"
      title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      data-testid="button-theme-toggle"
    >
      {theme === "dark" ? <Sun className="w-3 h-3" /> : <Moon className="w-3 h-3" />}
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
          <BluestationUpdater />
          <UpdateChecker />
          <a
            href="https://www.paypal.com/donate?business=quini7620%40gmail.com&currency_code=EUR"
            target="_blank"
            rel="noopener noreferrer"
            title="Donar con PayPal"
            data-testid="link-paypal-donate"
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold select-none transition-all
              bg-[#003087] hover:bg-[#002060] text-white border border-[#0070ba]/60 hover:border-[#ffc439]
              hover:shadow-[0_0_8px_2px_rgba(255,196,57,0.35)] active:scale-95"
          >
            <SiPaypal className="w-3 h-3 text-[#ffc439]" />
            <span className="hidden lg:inline">Donate</span>
          </a>
          <span
            className="text-[10px] font-black tracking-widest px-2 py-0.5 rounded bg-sky-500/15 text-sky-400 border border-sky-500/30 select-none"
            data-testid="text-callsign"
          >
            @EA5GVK
          </span>
          <LangSelector />
          <ThemeToggle />
        </div>

        {/* Mobile right side — compact */}
        <div className="flex md:hidden items-center gap-1 px-2 flex-shrink-0">
          <LangSelector />
          <ThemeToggle />
        </div>
      </div>

      {/* Mobile second row: actions */}
      <div className="flex md:hidden items-center gap-1.5 px-2 py-1 border-t border-border/40 flex-wrap">
        <BluestationUpdater />
        <UpdateChecker />
        <a
          href="https://www.paypal.com/donate?business=quini7620%40gmail.com&currency_code=EUR"
          target="_blank"
          rel="noopener noreferrer"
          data-testid="link-paypal-donate-mobile"
          className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold select-none
            bg-[#003087] text-white border border-[#0070ba]/60"
        >
          <SiPaypal className="w-3 h-3 text-[#ffc439]" />
          Donate
        </a>
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
          <Toaster />
        </I18nContext.Provider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
