import type { Express } from "express";
import type { Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { api } from "@shared/routes";
import { spawn, exec, type ChildProcess } from "child_process";
import * as path from "path";

let pythonProcess: ChildProcess | null = null;
const startTime = Date.now();

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get(api.system.status.path, (_req, res) => {
    res.json({
      status: pythonProcess ? "running" : "starting",
      uptime: (Date.now() - startTime) / 1000,
      activeConnections: wss.clients.size
    });
  });

  app.post(api.system.shutdown.path, (_req, res) => {
    res.json({ message: "Apagando sistema..." });
    setTimeout(() => {
      exec("sudo shutdown -h now", (err) => {
        if (err) console.error("Error al apagar:", err.message);
      });
    }, 1000);
  });

  app.post(api.system.reboot.path, (_req, res) => {
    res.json({ message: "Reiniciando sistema..." });
    setTimeout(() => {
      exec("sudo reboot", (err) => {
        if (err) console.error("Error al reiniciar:", err.message);
      });
    }, 1000);
  });

  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  function broadcast(data: string) {
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  }

  let latestFullState: string | null = null;

  wss.on('connection', (ws) => {
    if (latestFullState) {
      ws.send(latestFullState);
    }
  });

  // Spawn Python monitor script
  const scriptPath = path.join(process.cwd(), 'tetra_monitor.py');

  function startPython() {
    console.log("Spawning Python TETRA monitor...");
    pythonProcess = spawn('python3', [scriptPath], {
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let buffer = '';

    pythonProcess.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          const msg = JSON.stringify(event);

          if (event.type === 'full_state') {
            latestFullState = msg;
          }

          broadcast(msg);
        } catch (e) {
          // Not valid JSON, skip
        }
      }
    });

    pythonProcess.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) {
        console.error(`[Python] ${text}`);
      }
    });

    pythonProcess.on('close', (code) => {
      console.log(`Python process exited with code ${code}. Restarting in 3s...`);
      pythonProcess = null;
      setTimeout(startPython, 3000);
    });

    pythonProcess.on('error', (err) => {
      console.error("Failed to start Python:", err);
      pythonProcess = null;
      setTimeout(startPython, 5000);
    });
  }

  startPython();

  return httpServer;
}
