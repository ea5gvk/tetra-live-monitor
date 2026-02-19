import { Terminal } from '@shared/schema';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from './StatusBadge';
import { Signal, Radio, Users, Activity } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';

interface TerminalCardProps {
  terminal: Terminal;
}

export function TerminalCard({ terminal }: TerminalCardProps) {
  const isOnline = terminal.status === 'Online';
  const lastSeen = new Date(terminal.lastSeen);

  return (
    <Card className={cn(
      "relative overflow-hidden transition-all duration-300 group scifi-border",
      "hover:shadow-[0_0_20px_rgba(26,221,187,0.15)] hover:bg-card/80",
      "bg-card/50 backdrop-blur-sm border-white/10"
    )}>
      {/* Background Pulse Animation for Online Terminals */}
      {isOnline && (
        <div className="absolute top-0 right-0 w-24 h-24 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />
      )}

      <div className="p-4 space-y-4">
        {/* Header: ID & Status */}
        <div className="flex justify-between items-start">
          <div className="space-y-1">
            <h3 className="font-mono text-lg font-bold text-foreground tracking-tight flex items-center gap-2">
              <Radio className="w-4 h-4 text-muted-foreground" />
              {terminal.callsign || terminal.id}
            </h3>
            <p className="text-xs text-muted-foreground font-mono flex items-center gap-1">
              ID: {terminal.id}
            </p>
          </div>
          <StatusBadge status={terminal.status} />
        </div>

        {/* Selected Talkgroup */}
        <div className="bg-secondary/30 rounded p-2 border border-white/5">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span className="flex items-center gap-1 uppercase tracking-wider font-bold">
              <Signal className="w-3 h-3" /> Selected TG
            </span>
            <Activity className={cn("w-3 h-3", isOnline ? "text-primary animate-pulse" : "text-muted-foreground/30")} />
          </div>
          <div className="font-mono text-xl font-bold text-primary text-glow">
            {terminal.selectedTg}
          </div>
        </div>

        {/* Scan Groups */}
        <div>
          <div className="flex items-center gap-1 text-[10px] uppercase text-muted-foreground font-bold tracking-wider mb-2">
            <Users className="w-3 h-3" /> Scan List
          </div>
          <div className="flex flex-wrap gap-1.5">
            {terminal.groups.length > 0 ? (
              terminal.groups.map(group => (
                <Badge 
                  key={group} 
                  variant="outline" 
                  className="bg-primary/5 border-primary/20 text-primary/80 text-[10px] font-mono h-5 px-1.5 hover:bg-primary/10 transition-colors"
                >
                  {group}
                </Badge>
              ))
            ) : (
              <span className="text-xs text-muted-foreground/50 italic px-1">None configured</span>
            )}
          </div>
        </div>

        {/* Footer: Last Seen */}
        <div className="pt-2 border-t border-white/5 flex justify-between items-center text-[10px] text-muted-foreground">
          <span>SIGNAL_LOCK</span>
          <span className="font-mono">
            {isOnline ? 'LIVE FEED' : `LAST SEEN ${formatDistanceToNow(lastSeen, { addSuffix: true }).toUpperCase()}`}
          </span>
        </div>
      </div>
    </Card>
  );
}
