import { Switch, Route, useLocation, Link } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Dashboard from "@/pages/Dashboard";
import Calculator from "@/pages/Calculator";
import LogLive from "@/pages/LogLive";
import VpnManager from "@/pages/VpnManager";
import WifiManager from "@/pages/WifiManager";
import NotFound from "@/pages/not-found";
import { Radio, Calculator as CalcIcon, Globe, ScrollText, Sun, Moon, ShieldCheck, Wifi } from "lucide-react";
import { I18nContext, useI18nState, useI18n, LANGUAGES, LANGUAGE_LABELS } from "@/lib/i18n";
import { UpdateChecker } from "@/components/UpdateChecker";
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

  return (
    <nav className="bg-card border-b border-border px-3 py-1 flex items-center gap-1" data-testid="nav-bar">
      <Link
        href="/"
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-t transition-colors ${
          location === "/"
            ? "bg-primary/10 text-primary border border-primary/20 border-b-0"
            : "text-muted-foreground hover:text-foreground hover:bg-white/5"
        }`}
        data-testid="nav-link-monitor"
      >
        <Radio className="w-3.5 h-3.5" />
        MONITOR
      </Link>
      <Link
        href="/calculator"
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-t transition-colors ${
          location === "/calculator"
            ? "bg-primary/10 text-primary border border-primary/20 border-b-0"
            : "text-muted-foreground hover:text-foreground hover:bg-white/5"
        }`}
        data-testid="nav-link-calculator"
      >
        <CalcIcon className="w-3.5 h-3.5" />
        {t("calculator")}
      </Link>
      <Link
        href="/log-live"
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-t transition-colors ${
          location === "/log-live"
            ? "bg-primary/10 text-primary border border-primary/20 border-b-0"
            : "text-muted-foreground hover:text-foreground hover:bg-white/5"
        }`}
        data-testid="nav-link-log-live"
      >
        <ScrollText className="w-3.5 h-3.5" />
        {t("log_live")}
      </Link>
      <Link
        href="/vpn"
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-t transition-colors ${
          location === "/vpn"
            ? "bg-primary/10 text-primary border border-primary/20 border-b-0"
            : "text-muted-foreground hover:text-foreground hover:bg-white/5"
        }`}
        data-testid="nav-link-vpn"
      >
        <ShieldCheck className="w-3.5 h-3.5" />
        VPN
      </Link>
      <Link
        href="/wifi"
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-t transition-colors ${
          location === "/wifi"
            ? "bg-primary/10 text-primary border border-primary/20 border-b-0"
            : "text-muted-foreground hover:text-foreground hover:bg-white/5"
        }`}
        data-testid="nav-link-wifi"
      >
        <Wifi className="w-3.5 h-3.5" />
        {t("wifi_manager")}
      </Link>
      <div className="ml-auto flex items-center gap-2">
        <UpdateChecker />
        <span
          className="text-[11px] font-black tracking-widest px-2 py-0.5 rounded bg-sky-500/15 text-sky-400 border border-sky-500/30 select-none"
          data-testid="text-callsign"
        >
          @EA5GVK
        </span>
        <LangSelector />
        <ThemeToggle />
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
