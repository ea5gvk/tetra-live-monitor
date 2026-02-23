import { Switch, Route, useLocation, Link } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Dashboard from "@/pages/Dashboard";
import Calculator from "@/pages/Calculator";
import NotFound from "@/pages/not-found";
import { Radio, Calculator as CalcIcon, Globe } from "lucide-react";
import { I18nContext, useI18nState, useI18n, LANGUAGES, LANGUAGE_LABELS } from "@/lib/i18n";

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
      <div className="ml-auto">
        <LangSelector />
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
