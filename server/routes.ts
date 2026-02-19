
import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { WS_EVENTS, type WsMessage, type Terminal, type CallLog } from "@shared/schema";
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import fetch from "node-fetch";

// Configuration similar to Python script
// We use a mock generator if not on a Linux system with journalctl
// OR if specifically requested to demo.
// For Replit environment, we likely don't have real TETRA logs in journalctl.
// I'll implement the reader but also a "Demo Mode" fallback if no logs are flowing.

const RADIOID_API = "https://database.radioid.net/api/dmr/user/?id=";
const JOURNAL_CMD = ["journalctl", "-f", "-o", "json"];

// Cache for callsigns
const callsignCache = new Map<string, string>();

async function getCallsign(issi: string): Promise<string> {
  if (!issi || parseInt(issi) < 1000) return "";
  if (callsignCache.has(issi)) return callsignCache.get(issi)!;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);
    const res = await fetch(`${RADIOID_API}${issi}`, { signal: controller.signal });
    clearTimeout(timeout);
    
    if (res.ok) {
      const data: any = await res.json();
      let call = "";
      if (data.callsign) call = data.callsign;
      else if (data.results && data.results.length > 0) {
        call = data.results[0].callsign;
      }
      
      if (call) {
        callsignCache.set(issi, call.toUpperCase());
        return call.toUpperCase();
      }
    }
  } catch (e) {
    // ignore
  }
  
  callsignCache.set(issi, "");
  return "";
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // API Status
  app.get(api.system.status.path, (req, res) => {
    res.json({
      status: "running",
      uptime: process.uptime(),
      activeConnections: wss.clients.size
    });
  });

  // WebSocket Server
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', async (ws) => {
    // Send initial state
    const terminals = await storage.getTerminals();
    const localHistory = await storage.getHistory(true);
    const externalHistory = await storage.getHistory(false);
    
    const msg: WsMessage = {
      type: 'init_state',
      payload: { terminals, localHistory, externalHistory }
    };
    ws.send(JSON.stringify(msg));
  });

  function broadcast(type: keyof typeof WS_EVENTS, payload: any) {
    const msg = JSON.stringify({ type, payload });
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    });
  }

  // --- LOG PROCESSING LOGIC ---
  // Ported from Python script
  
  let lastContextId: string | null = null;

  async function processLine(line: string) {
    try {
      const data = JSON.parse(line);
      let msg = "";
      
      // Handle MESSAGE as string or array of integers (journalctl JSON format)
      if (Array.isArray(data.MESSAGE)) {
        msg = String.fromCharCode(...data.MESSAGE);
      } else {
        msg = data.MESSAGE || "";
      }

      // Remove ANSI codes
      msg = msg.replace(/\x1b\[[0-9;]*m/g, '');

      const ts = data.__REALTIME_TIMESTAMP ? parseInt(data.__REALTIME_TIMESTAMP) / 1000 : Date.now();
      // Use ISO string for robust frontend parsing
      const timestamp = new Date(ts).toISOString();
      
      // Global ID Extraction for Context
      let globalId: string | null = null;
      const idMatch = msg.match(/\b(?:issi|ssi|subscriber)[:\s=]+(?:Some\()?(\d+)(?:[\),]*\s*,?\s*ssi_type[:\s=]+(\w+))?/i);
      
      if (idMatch) {
        const foundId = idMatch[1];
        const typeFound = idMatch[2];
        if (!typeFound || !typeFound.toLowerCase().includes('gssi')) {
          globalId = foundId;
          lastContextId = globalId;
        }
      }

      // 1. DEREGISTER
      if (msg.toLowerCase().includes('deregister')) {
        let targetId = globalId;
        if (!targetId) {
           const det = msg.match(/\b(?:issi|ssi|subscriber)[:\s=]+(?:Some\()?(\d+)/i);
           if (det) targetId = det[1];
        }

        if (targetId) {
          const updated = await storage.updateTerminal(targetId, { status: 'Offline', selectedTg: '---' });
          broadcast('update_term', updated);
        }
        return;
      }

      // 2. CALLS & TRANSMISSIONS
      const callMatch = msg.match(/(?:call from ISSI|src=)\s*(\d+).*?(?:to GSSI|dst=)\s*(\d+)/i);
      if (callMatch) {
        const sIssi = callMatch[1];
        const dGssi = callMatch[2];
        
        const terminals = await storage.getTerminals();
        const existing = terminals[sIssi];
        
        let groups = existing ? existing.groups : [dGssi];
        if (existing && !groups.includes(dGssi)) groups.push(dGssi);
        
        const isLocal = existing ? existing.isLocal : false;
        
        const updated = await storage.updateTerminal(sIssi, {
          selectedTg: `TG ${dGssi}`,
          groups,
          lastSeen: timestamp,
          status: existing ? existing.status : 'External',
          isLocal
        });
        
        broadcast('update_term', updated);

        const callsign = await getCallsign(sIssi);
        const log: CallLog = {
          id: randomUUID(),
          timestamp,
          sourceId: sIssi,
          sourceCallsign: callsign,
          targetTg: dGssi,
          isLocal
        };
        
        await storage.addCallLog(log, isLocal);
        broadcast('new_call', log);
        return;
      }

      // 3. REGISTER & DEEP GSSI RECOVERY
      if (idMatch) {
        const id = idMatch[1];
        const typeFound = idMatch[2];
        
        if (typeFound && typeFound.toLowerCase().includes('gssi')) return;

        const isReg = /register|affiliate|attach/i.test(msg);
        
        // Initial create or update
        const terminals = await storage.getTerminals();
        const existing = terminals[id];
        
        let status: 'Online' | 'Offline' | 'External' = existing ? existing.status : 'External';
        let isLocal = existing ? existing.isLocal : false;
        
        if (isReg) {
          status = 'Online';
          isLocal = true;
        } else if (!existing) {
          // If seeing for first time and not explicit register, keep as external until proven otherwise
          status = 'External';
        }

        let updated = await storage.updateTerminal(id, {
          status,
          isLocal,
          lastSeen: timestamp
        });
        
        // Find selected TG
        let foundGssi: string | null = null;
        const patterns = [
           /selected(?:[\s_]*tg)?[:\s=]+(\d+)/i,
           /target[:\s=]+(\d+)/i,
           /dest(?:ination)?[:\s=]+(\d+)/i,
           /group[:\s=]+(\d+)/i
        ];
        
        for (const p of patterns) {
          const m = msg.match(p);
          if (m) {
            foundGssi = m[1];
            break;
          }
        }

        if (foundGssi) {
          const currentGroups = updated.groups;
          if (!currentGroups.includes(foundGssi)) currentGroups.push(foundGssi);
          currentGroups.sort();
          
          updated = await storage.updateTerminal(id, {
            selectedTg: `TG ${foundGssi}`,
            groups: currentGroups
          });
        }

        // Scanlist Extraction
        const grpsMatch = msg.match(/groups=\[(.*?)\]/);
        if (grpsMatch) {
          const rawGrps = grpsMatch[1].split(',').map(g => g.trim()).filter(g => g);
          const isDeaffiliate = /deaffiliate|detach/i.test(msg);
          
          let currentGroups = updated.groups;
          
          if (isDeaffiliate) {
             currentGroups = currentGroups.filter(g => !rawGrps.includes(g));
          } else {
             const set = new Set([...currentGroups, ...rawGrps]);
             currentGroups = Array.from(set).sort();
          }
          
          updated = await storage.updateTerminal(id, { groups: currentGroups });
        }
        
        broadcast('update_term', updated);
        return;
      }

      // 4. ATTACH/DETACH GROUP IDENTITY
      if (msg.includes('AttachDetachGroupIdentity') || msg.includes('LocationUpdate')) {
         const idM = msg.match(/\b(?:issi|ssi|subscriber)[:\s=]+(?:Some\()?(\d+)(?:[\),]*\s*,?\s*ssi_type[:\s=]+(\w+))?/i);
         let currentId = idM ? idM[1] : lastContextId;
         
         if (currentId) {
            const terminals = await storage.getTerminals();
            if (terminals[currentId]) {
               // Simple regex for GSSI finding in structs - simplified vs Python
               // We just look for all GSSIs and decide based on context if we can
               const gssis = [...msg.matchAll(/\bgssi[:\s=]+(?:Some\()?(\d+)/gi)].map(m => m[1]);
               
               // Naive approach: if "detachment" found, assume all found GSSIs are detach
               const isDetachment = /detachment_(?:up|down)link[:\s]+Some/i.test(msg);
               
               let currentGroups = terminals[currentId].groups;
               let currentSelected = terminals[currentId].selectedTg;
               let selectedGssi = currentSelected.replace("TG ", "");

               if (isDetachment) {
                  currentGroups = currentGroups.filter(g => !gssis.includes(g));
               } else {
                  // Attachment
                  // Heuristic: If just one GSSI and list is small, replace (Selection change)
                  if (gssis.length === 1 && currentGroups.length <= 1) {
                     currentGroups = [gssis[0]];
                     currentSelected = `TG ${gssis[0]}`;
                  } else {
                     const set = new Set([...currentGroups, ...gssis]);
                     currentGroups = Array.from(set).sort();
                  }
               }
               
               const updated = await storage.updateTerminal(currentId, {
                  groups: currentGroups,
                  selectedTg: currentSelected
               });
               broadcast('update_term', updated);
            }
         }
      }

    } catch (e) {
      console.error("Error processing line:", e);
    }
  }

  // --- START LOG READER ---
  try {
    const journal = spawn(JOURNAL_CMD[0], JOURNAL_CMD.slice(1));
    
    journal.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      lines.forEach((line: string) => {
        if (line.trim()) processLine(line.trim());
      });
    });

    journal.stderr.on('data', (data) => {
      // console.error(`Journal Error: ${data}`);
    });

    journal.on('error', (err) => {
        console.error("Failed to start journalctl:", err);
        startDemoMode();
    });
    
  } catch (e) {
    console.error("Could not spawn journalctl, starting demo mode:", e);
    startDemoMode();
  }

  function startDemoMode() {
    console.log("Starting DEMO MODE (Simulation)");
    setInterval(async () => {
      const demoIssi = Math.floor(Math.random() * 50) + 1000;
      const demoGssi = [1, 10, 91, 262][Math.floor(Math.random() * 4)];
      
      const line = JSON.stringify({
        MESSAGE: `call from ISSI ${demoIssi} to GSSI ${demoGssi}`,
        __REALTIME_TIMESTAMP: (Date.now() * 1000).toString()
      });
      await processLine(line);
    }, 3000);
  }

  return httpServer;
}
