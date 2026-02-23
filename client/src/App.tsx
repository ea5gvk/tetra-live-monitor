import { Switch, Route, useLocation, Link } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Dashboard from "@/pages/Dashboard";
import Calculator from "@/pages/Calculator";
import NotFound from "@/pages/not-found";
import { Radio, Calculator as CalcIcon } from "lucide-react";

function NavBar() {
  const [location] = useLocation();

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
        CALCULADORA
      </Link>
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
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Router />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
