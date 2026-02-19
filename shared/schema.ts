
import { pgTable, text, serial, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// We don't strictly need a database for a transient log monitor, 
// but we'll set up a simple schema for settings or persistent history if needed later.
// For now, most state will be in-memory on the server and streamed to client.

export const settings = pgTable("settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
});

// Explicit API Types for the Monitor

// Terminal Status
export type TerminalStatus = "Online" | "Offline" | "External";

// A single Terminal (Radio)
export interface Terminal {
  id: string;
  callsign?: string;
  status: TerminalStatus;
  selectedTg: string; // e.g. "TG 91"
  groups: string[];   // e.g. ["91", "262"]
  lastSeen: string;   // Timestamp string
  isLocal: boolean;
}

// A Call Log Entry
export interface CallLog {
  id: string; // Unique ID for React keys
  timestamp: string;
  sourceId: string;
  sourceCallsign?: string;
  targetTg: string;
  isLocal: boolean;
}

// WebSocket Message Types
export const WS_EVENTS = {
  // Server -> Client
  INIT_STATE: 'init_state',       // Sends full current state on connection
  UPDATE_TERMINAL: 'update_term', // A terminal changed (selected TG, online, etc)
  NEW_CALL: 'new_call',           // A new call occurred
  // Client -> Server
  REQUEST_STATE: 'req_state',
} as const;

export interface WsMessage<T = unknown> {
  type: keyof typeof WS_EVENTS;
  payload: T;
}

export interface MonitorState {
  terminals: Record<string, Terminal>;
  localHistory: CallLog[];
  externalHistory: CallLog[];
}
