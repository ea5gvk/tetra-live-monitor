import { CallLog } from '@shared/schema';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowRight, Clock } from 'lucide-react';
import { format } from 'date-fns';

interface CallLogTableProps {
  logs: CallLog[];
  emptyMessage?: string;
}

export function CallLogTable({ logs, emptyMessage = "No traffic detected." }: CallLogTableProps) {
  if (logs.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-muted-foreground/50 space-y-2 border border-dashed border-white/10 rounded-lg m-4 p-12">
        <Clock className="w-8 h-8 opacity-20" />
        <span className="text-sm font-mono uppercase tracking-widest">{emptyMessage}</span>
      </div>
    );
  }

  return (
    <ScrollArea className="h-[400px] w-full pr-4">
      <Table>
        <TableHeader className="bg-card sticky top-0 z-10">
          <TableRow className="border-white/10 hover:bg-transparent">
            <TableHead className="w-[100px] font-mono text-xs uppercase tracking-wider text-muted-foreground">Time</TableHead>
            <TableHead className="w-[140px] font-mono text-xs uppercase tracking-wider text-muted-foreground">Source</TableHead>
            <TableHead className="w-[40px]"></TableHead>
            <TableHead className="font-mono text-xs uppercase tracking-wider text-muted-foreground">Target</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {logs.map((log) => (
            <TableRow key={log.id} className="border-white/5 hover:bg-white/5 transition-colors group">
              <TableCell className="font-mono text-xs text-muted-foreground">
                {format(new Date(log.timestamp), 'HH:mm:ss')}
              </TableCell>
              <TableCell className="font-mono text-sm font-medium text-foreground">
                <span className="text-primary/90">{log.sourceCallsign || log.sourceId}</span>
                {log.sourceCallsign && (
                   <span className="block text-[10px] text-muted-foreground/60">{log.sourceId}</span>
                )}
              </TableCell>
              <TableCell>
                <ArrowRight className="w-3 h-3 text-muted-foreground/40 group-hover:text-primary/60 transition-colors" />
              </TableCell>
              <TableCell className="font-mono text-sm">
                <span className="px-1.5 py-0.5 rounded bg-secondary/50 border border-white/5 text-secondary-foreground text-xs">
                  TG {log.targetTg}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ScrollArea>
  );
}
