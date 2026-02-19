import { useMonitorSocket } from '@/hooks/use-socket';
import { TerminalCard } from '@/components/TerminalCard';
import { CallLogTable } from '@/components/CallLogTable';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { 
  Activity, 
  Server, 
  Database, 
  ShieldCheck, 
  Radio, 
  Wifi 
} from 'lucide-react';
import { cn } from '@/lib/utils';

export default function Dashboard() {
  const { status, terminals, localHistory, externalHistory } = useMonitorSocket();

  const terminalList = Object.values(terminals).sort((a, b) => {
    // Online first, then by ID
    if (a.status === 'Online' && b.status !== 'Online') return -1;
    if (a.status !== 'Online' && b.status === 'Online') return 1;
    return a.id.localeCompare(b.id);
  });

  const activeCount = terminalList.filter(t => t.status === 'Online').length;
  const totalCalls = localHistory.length + externalHistory.length;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans selection:bg-primary/20">
      
      {/* Top Bar / Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-md sticky top-0 z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Radio className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                TETRA <span className="text-primary">MONITOR</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-muted-foreground font-mono">
                  v2.4.0
                </span>
              </h1>
              <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider">
                Tactical Radio Surveillance System
              </p>
            </div>
          </div>

          <div className="flex items-center gap-6">
            {/* Stats Mini-bar */}
            <div className="hidden md:flex items-center gap-4 text-xs font-mono text-muted-foreground">
              <div className="flex items-center gap-2">
                <Activity className="w-3 h-3 text-primary" />
                <span>UPTIME: <span className="text-foreground">99.9%</span></span>
              </div>
              <div className="h-4 w-px bg-white/10" />
              <div className="flex items-center gap-2">
                <Database className="w-3 h-3 text-accent" />
                <span>LOGS: <span className="text-foreground">{totalCalls}</span></span>
              </div>
            </div>

            {/* Connection Status Indicator */}
            <div className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-bold uppercase tracking-wider transition-colors",
              status === 'connected' 
                ? "bg-green-500/10 border-green-500/20 text-green-500" 
                : status === 'connecting'
                  ? "bg-yellow-500/10 border-yellow-500/20 text-yellow-500"
                  : "bg-red-500/10 border-red-500/20 text-red-500"
            )}>
              <div className={cn(
                "w-2 h-2 rounded-full",
                status === 'connected' ? "bg-green-500 animate-pulse" : "bg-current"
              )} />
              {status === 'connected' ? 'SYSTEM ONLINE' : status.toUpperCase()}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 container mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Active Terminals */}
        <div className="lg:col-span-7 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Wifi className="w-5 h-5 text-primary" />
              Active Terminals
            </h2>
            <Badge variant="outline" className="font-mono bg-primary/5 border-primary/20 text-primary">
              {activeCount} / {terminalList.length} ONLINE
            </Badge>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {terminalList.map(terminal => (
              <TerminalCard key={terminal.id} terminal={terminal} />
            ))}
            
            {terminalList.length === 0 && (
              <div className="col-span-full py-12 text-center border-2 border-dashed border-white/5 rounded-xl bg-card/30">
                <p className="text-muted-foreground font-mono text-sm">NO TERMINALS DETECTED</p>
                <p className="text-xs text-muted-foreground/50 mt-1">Waiting for handshake...</p>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Call Logs & System Info */}
        <div className="lg:col-span-5 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Server className="w-5 h-5 text-accent" />
              Traffic Log
            </h2>
            <div className="flex gap-2">
              <div className="w-2 h-2 rounded-full bg-accent animate-[ping_3s_infinite]" />
            </div>
          </div>

          <Card className="border-white/10 bg-card/40 backdrop-blur-sm shadow-2xl">
            <CardHeader className="pb-2 border-b border-white/5">
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider flex justify-between items-center">
                <span>Communication Stream</span>
                <ShieldCheck className="w-4 h-4 text-green-500/50" />
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Tabs defaultValue="local" className="w-full">
                <div className="px-4 py-2 bg-black/20">
                  <TabsList className="grid w-full grid-cols-2 bg-secondary/50">
                    <TabsTrigger value="local" className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary font-mono text-xs">
                      LOCAL NET
                    </TabsTrigger>
                    <TabsTrigger value="external" className="data-[state=active]:bg-accent/20 data-[state=active]:text-accent font-mono text-xs">
                      EXTERNAL
                    </TabsTrigger>
                  </TabsList>
                </div>
                
                <TabsContent value="local" className="m-0">
                  <CallLogTable logs={localHistory} emptyMessage="No local traffic" />
                </TabsContent>
                
                <TabsContent value="external" className="m-0">
                  <CallLogTable logs={externalHistory} emptyMessage="No external traffic" />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          {/* System Environment Stats - Decorative for this demo */}
          <div className="grid grid-cols-2 gap-4">
            <Card className="bg-card/30 border-white/5 p-4">
              <div className="text-xs text-muted-foreground uppercase mb-1">Frequency</div>
              <div className="text-2xl font-mono text-foreground">380.0<span className="text-sm text-muted-foreground">MHz</span></div>
              <div className="h-1 w-full bg-secondary mt-2 rounded-full overflow-hidden">
                <div className="h-full bg-primary w-[75%]" />
              </div>
            </Card>
            <Card className="bg-card/30 border-white/5 p-4">
              <div className="text-xs text-muted-foreground uppercase mb-1">Signal Strength</div>
              <div className="text-2xl font-mono text-foreground">-65<span className="text-sm text-muted-foreground">dBm</span></div>
              <div className="h-1 w-full bg-secondary mt-2 rounded-full overflow-hidden">
                <div className="h-full bg-green-500 w-[90%]" />
              </div>
            </Card>
          </div>

        </div>
      </main>
    </div>
  );
}
