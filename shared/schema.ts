
import { pgTable, text, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const settings = pgTable("settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
});

export type TerminalStatus = "Online" | "Offline" | "External";

export interface Terminal {
  id: string;
  callsign?: string;
  status: TerminalStatus;
  selectedTg: string;
  groups: string[];
  lastSeen: string;
  isLocal: boolean;
  isActive?: boolean;
}

export interface CallLog {
  id: string;
  timestamp: string;
  sourceId: string;
  sourceCallsign?: string;
  targetTg: string;
  display: string;
  isLocal: boolean;
}

export interface MonitorState {
  terminals: Record<string, Terminal>;
  localHistory: CallLog[];
  externalHistory: CallLog[];
}

// WebSocket event types (matching Python output)
export type WsEventType = "full_state" | "update_terminal" | "new_call" | "status";

export interface WsMessage<T = unknown> {
  type: WsEventType;
  payload: T;
}
