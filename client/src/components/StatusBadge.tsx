import { TerminalStatus } from '@shared/schema';
import { cn } from '@/lib/utils';
import { Radio, Wifi, WifiOff } from 'lucide-react';

interface StatusBadgeProps {
  status: TerminalStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = {
    Online: {
      color: 'text-primary border-primary/30 bg-primary/10',
      icon: Wifi,
      label: 'ONLINE'
    },
    Offline: {
      color: 'text-muted-foreground border-muted-foreground/30 bg-muted/10',
      icon: WifiOff,
      label: 'OFFLINE'
    },
    External: {
      color: 'text-accent border-accent/30 bg-accent/10',
      icon: Radio,
      label: 'EXTERNAL'
    }
  };

  const { color, icon: Icon, label } = config[status] || config.Offline;

  return (
    <div className={cn(
      "flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border",
      color,
      className
    )}>
      <Icon className="w-3 h-3" />
      {label}
    </div>
  );
}
