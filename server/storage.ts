
import { type Terminal, type CallLog } from "@shared/schema";

export interface IStorage {
  // We keep everything in memory for this real-time monitor
  getTerminals(): Promise<Record<string, Terminal>>;
  updateTerminal(id: string, update: Partial<Terminal>): Promise<Terminal>;
  addCallLog(log: CallLog, isLocal: boolean): Promise<void>;
  getHistory(isLocal: boolean): Promise<CallLog[]>;
  clearTerminals(): Promise<void>;
}

export class MemStorage implements IStorage {
  private terminals: Map<string, Terminal>;
  private localHistory: CallLog[];
  private externalHistory: CallLog[];
  private readonly MAX_HISTORY = 50;

  constructor() {
    this.terminals = new Map();
    this.localHistory = [];
    this.externalHistory = [];
  }

  async getTerminals(): Promise<Record<string, Terminal>> {
    return Object.fromEntries(this.terminals);
  }

  async updateTerminal(id: string, update: Partial<Terminal>): Promise<Terminal> {
    const existing = this.terminals.get(id) || {
      id,
      status: 'External',
      selectedTg: '---',
      groups: [],
      lastSeen: new Date().toISOString(),
      isLocal: false
    };
    
    const updated = { ...existing, ...update };
    this.terminals.set(id, updated);
    return updated;
  }

  async addCallLog(log: CallLog, isLocal: boolean): Promise<void> {
    const target = isLocal ? this.localHistory : this.externalHistory;
    target.unshift(log);
    if (target.length > this.MAX_HISTORY) {
      target.pop();
    }
  }

  async getHistory(isLocal: boolean): Promise<CallLog[]> {
    return isLocal ? this.localHistory : this.externalHistory;
  }

  async clearTerminals(): Promise<void> {
    this.terminals.clear();
    this.localHistory = [];
    this.externalHistory = [];
  }
}

export const storage = new MemStorage();
