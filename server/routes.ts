import type { Express } from "express";
import type { Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { api } from "@shared/routes";
import { spawn, exec, execSync, type ChildProcess } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

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

  app.get(api.system.stats.path, (_req, res) => {
    let cpuTemp: number | null = null;
    let cpuLoad: number | null = null;

    try {
      const tempPath = "/sys/class/thermal/thermal_zone0/temp";
      if (fs.existsSync(tempPath)) {
        const raw = fs.readFileSync(tempPath, "utf-8").trim();
        cpuTemp = Math.round(parseInt(raw) / 1000 * 10) / 10;
      }
    } catch {}

    try {
      const cpus = os.cpus();
      const loadAvg = os.loadavg();
      cpuLoad = Math.round((loadAvg[0] / cpus.length) * 100);
      if (cpuLoad > 100) cpuLoad = 100;
    } catch {}

    let memTotal = 0;
    let memAvailable = 0;
    try {
      const memInfo = fs.readFileSync("/proc/meminfo", "utf-8");
      const totalMatch = memInfo.match(/MemTotal:\s+(\d+)/);
      const availMatch = memInfo.match(/MemAvailable:\s+(\d+)/);
      if (totalMatch) memTotal = parseInt(totalMatch[1]);
      if (availMatch) memAvailable = parseInt(availMatch[1]);
    } catch {}

    const memUsed = memTotal > 0 ? Math.round(((memTotal - memAvailable) / memTotal) * 100) : null;

    res.json({
      cpuTemp,
      cpuLoad,
      memUsed,
    });
  });

  function getSystemPassword(): string {
    try {
      const configPath = path.join(process.cwd(), "config.json");
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      return config.systemPassword || "";
    } catch {
      return "";
    }
  }

  app.post(api.system.shutdown.path, (req, res) => {
    const { password } = req.body || {};
    if (!password || password !== getSystemPassword()) {
      return res.status(401).json({ message: "Contraseña incorrecta" });
    }
    res.json({ message: "Apagando sistema..." });
    setTimeout(() => {
      exec("sudo shutdown -h now", (err) => {
        if (err) console.error("Error al apagar:", err.message);
      });
    }, 1000);
  });

  app.post(api.system.reboot.path, (req, res) => {
    const { password } = req.body || {};
    if (!password || password !== getSystemPassword()) {
      return res.status(401).json({ message: "Contraseña incorrecta" });
    }
    res.json({ message: "Reiniciando sistema..." });
    setTimeout(() => {
      exec("sudo reboot", (err) => {
        if (err) console.error("Error al reiniciar:", err.message);
      });
    }, 1000);
  });

  app.post(api.system.restartService.path, (req, res) => {
    const { password, serviceName } = req.body || {};
    if (!password || password !== getSystemPassword()) {
      return res.status(401).json({ message: "Contraseña incorrecta" });
    }
    if (!serviceName || typeof serviceName !== "string") {
      return res.status(400).json({ message: "Nombre del servicio no especificado" });
    }
    const safeServiceName = serviceName.replace(/[^a-zA-Z0-9._@-]/g, '');
    if (!safeServiceName) {
      return res.status(400).json({ message: "Nombre del servicio no válido" });
    }
    res.json({ message: `Reiniciando ${safeServiceName}...` });
    setTimeout(() => {
      exec(`sudo systemctl restart ${safeServiceName}`, (err) => {
        if (err) console.error(`Error al reiniciar ${safeServiceName}:`, err.message);
      });
    }, 500);
  });

  app.post(api.system.applyConfig.path, (req, res) => {
    const { password, configPath, serviceName, values, timezoneConfig, brewConfig } = req.body || {};
    if (!password || password !== getSystemPassword()) {
      return res.status(401).json({ message: "Contraseña incorrecta" });
    }

    if (!configPath || typeof configPath !== "string") {
      return res.status(400).json({ message: "Ruta del archivo no especificada" });
    }

    if (!serviceName || typeof serviceName !== "string") {
      return res.status(400).json({ message: "Nombre del servicio no especificado" });
    }

    if (!values || typeof values !== "object") {
      return res.status(400).json({ message: "Valores no proporcionados" });
    }

    try {
      if (!fs.existsSync(configPath)) {
        return res.status(404).json({ message: `Archivo no encontrado: ${configPath}` });
      }

      let content = fs.readFileSync(configPath, "utf-8");

      const sectionUpdates: Record<string, Record<string, string>> = {
        "phy_io.soapysdr": {
          "tx_freq": String(values.tx_freq),
          "rx_freq": String(values.rx_freq),
        },
        "cell_info": {
          "freq_band": String(values.freq_band),
          "main_carrier": String(values.main_carrier),
          "duplex_spacing": String(values.duplex_spacing),
          "freq_offset": String(values.freq_offset),
          "reverse_operation": String(values.reverse_operation),
        },
      };

      if (values.custom_duplex_spacing !== null && values.custom_duplex_spacing !== undefined && values.duplex_spacing === 7) {
        sectionUpdates["cell_info"]["custom_duplex_spacing"] = String(values.custom_duplex_spacing);
      }

      // Timezone broadcast (goes under [cell_info])
      const tzEnabled = timezoneConfig?.enabled === true;
      if (tzEnabled && timezoneConfig?.timezone) {
        sectionUpdates["cell_info"]["timezone_broadcast"] = "true";
        sectionUpdates["cell_info"]["timezone"] = `"${timezoneConfig.timezone}"`;
      } else {
        // Will remove these keys if present
        sectionUpdates["cell_info"]["timezone_broadcast"] = "__REMOVE__";
        sectionUpdates["cell_info"]["timezone"] = "__REMOVE__";
      }

      const hasCustomDuplex = !!(sectionUpdates["cell_info"]["custom_duplex_spacing"]);

      // Build brew section update map
      const brewEnabled = brewConfig?.enabled === true;
      const brewUpdates: Record<string, string> = {};
      if (brewEnabled) {
        brewUpdates["host"] = `"${brewConfig.host || ""}"`;
        brewUpdates["port"] = String(brewConfig.port || 62031);
        brewUpdates["username"] = `"${brewConfig.username || ""}"`;
        brewUpdates["password"] = `"${brewConfig.password || ""}"`;
        brewUpdates["tls"] = brewConfig.tls ? "true" : "false";
        brewUpdates["reconnect_delay_secs"] = String(brewConfig.reconnect_delay_secs || 15);
        if (brewConfig.whitelisted_ssis && Array.isArray(brewConfig.whitelisted_ssis) && brewConfig.whitelisted_ssis.length > 0) {
          brewUpdates["whitelisted_ssis"] = `[${brewConfig.whitelisted_ssis.join(", ")}]`;
        }
      }

      const lines = content.split("\n");
      let currentSection = "";
      let customDuplexFound = false;
      let tzBroadcastFound = false;
      let tzFound = false;
      const brewKeyFound: Record<string, boolean> = {};
      let brewSectionExists = false;

      for (let i = 0; i < lines.length; i++) {
        const sectionMatch = lines[i].match(/^\s*\[([^\]]+)\]/);
        if (sectionMatch) {
          currentSection = sectionMatch[1].trim();
          if (currentSection === "brew") brewSectionExists = true;
          continue;
        }

        if (currentSection === "cell_info") {
          const keyMatch = lines[i].match(/^(\s*)([\w]+)(\s*=\s*)(.*)/);
          if (keyMatch) {
            const k = keyMatch[2];
            if (k === "custom_duplex_spacing") {
              if (hasCustomDuplex) {
                lines[i] = `${keyMatch[1]}custom_duplex_spacing${keyMatch[3]}${sectionUpdates["cell_info"]["custom_duplex_spacing"]}`;
                customDuplexFound = true;
              } else {
                lines.splice(i, 1); i--;
              }
              continue;
            }
            if (k === "timezone_broadcast") {
              if (tzEnabled) {
                lines[i] = `${keyMatch[1]}timezone_broadcast${keyMatch[3]}true`;
                tzBroadcastFound = true;
              } else {
                lines.splice(i, 1); i--;
              }
              continue;
            }
            if (k === "timezone") {
              if (tzEnabled) {
                lines[i] = `${keyMatch[1]}timezone${keyMatch[3]}"${timezoneConfig.timezone}"`;
                tzFound = true;
              } else {
                lines.splice(i, 1); i--;
              }
              continue;
            }
          }
        }

        if (currentSection === "brew" && brewEnabled) {
          const keyMatch = lines[i].match(/^(\s*)([\w]+)(\s*=\s*)(.*)/);
          if (keyMatch) {
            const k = keyMatch[2];
            if (brewUpdates[k] !== undefined) {
              lines[i] = `${keyMatch[1]}${k}${keyMatch[3]}${brewUpdates[k]}`;
              brewKeyFound[k] = true;
            }
          }
        }

        if (sectionUpdates[currentSection]) {
          const keyMatch = lines[i].match(/^(\s*)([\w]+)(\s*=\s*)(.*)/);
          if (keyMatch) {
            const keyName = keyMatch[2];
            const val = sectionUpdates[currentSection][keyName];
            if (val !== undefined && val !== "__REMOVE__") {
              if (!["custom_duplex_spacing","timezone_broadcast","timezone"].includes(keyName)) {
                lines[i] = `${keyMatch[1]}${keyName}${keyMatch[3]}${val}`;
              }
            }
          }
        }
      }

      // Insert custom_duplex_spacing under cell_info if needed
      if (hasCustomDuplex && !customDuplexFound) {
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].match(/^\s*\[cell_info\]/)) {
            let insertAt = i + 1;
            while (insertAt < lines.length && !lines[insertAt].match(/^\s*\[/) && lines[insertAt].trim() !== "") {
              insertAt++;
            }
            lines.splice(insertAt, 0, `custom_duplex_spacing = ${sectionUpdates["cell_info"]["custom_duplex_spacing"]}`);
            break;
          }
        }
      }

      // Insert timezone keys under cell_info if not found
      if (tzEnabled) {
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].match(/^\s*\[cell_info\]/)) {
            let insertAt = i + 1;
            while (insertAt < lines.length && !lines[insertAt].match(/^\s*\[/) && lines[insertAt].trim() !== "") {
              insertAt++;
            }
            if (!tzFound) lines.splice(insertAt, 0, `timezone = "${timezoneConfig.timezone}"`);
            if (!tzBroadcastFound) lines.splice(insertAt, 0, `timezone_broadcast = true`);
            break;
          }
        }
      }

      // Append or update [brew] section
      if (brewEnabled) {
        if (!brewSectionExists) {
          lines.push("");
          lines.push("[brew]");
          for (const [k, v] of Object.entries(brewUpdates)) {
            lines.push(`${k} = ${v}`);
          }
        } else {
          // Insert missing keys into existing [brew] section
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].match(/^\s*\[brew\]/)) {
              let insertAt = i + 1;
              while (insertAt < lines.length && !lines[insertAt].match(/^\s*\[/) && lines[insertAt].trim() !== "") {
                insertAt++;
              }
              for (const [k, v] of Object.entries(brewUpdates)) {
                if (!brewKeyFound[k]) {
                  lines.splice(insertAt, 0, `${k} = ${v}`);
                  insertAt++;
                }
              }
              break;
            }
          }
        }
      } else if (brewSectionExists) {
        // Remove entire [brew] section if brew is disabled
        let inBrew = false;
        for (let i = lines.length - 1; i >= 0; i--) {
          if (lines[i].match(/^\s*\[brew\]/)) {
            lines.splice(i, 1);
            inBrew = false;
            break;
          }
        }
        // Remove lines between [brew] header and next section
        inBrew = false;
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].match(/^\s*\[brew\]/)) { inBrew = true; lines.splice(i, 1); i--; continue; }
          if (inBrew) {
            if (lines[i].match(/^\s*\[/)) { inBrew = false; continue; }
            lines.splice(i, 1); i--;
          }
        }
      }

      content = lines.join("\n");

      fs.writeFileSync(configPath, content, "utf-8");

      const safeServiceName = serviceName.replace(/[^a-zA-Z0-9._-]/g, '');
      exec(`sudo systemctl restart ${safeServiceName}`, (err) => {
        if (err) console.error(`Error al reiniciar ${safeServiceName}:`, err.message);
      });

      res.json({ message: "Config aplicada. Reiniciando TMO..." });
    } catch (err: any) {
      console.error("Error al aplicar config:", err);
      res.status(500).json({ message: `Error: ${err.message}` });
    }
  });

  app.get('/api/log-stream', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    let journalProcess: ChildProcess | null = null;
    let hasJournalctl = false;

    try {
      execSync('which journalctl', { stdio: 'ignore' });
      hasJournalctl = true;
    } catch {}

    if (hasJournalctl) {
      const serviceName = typeof req.query.service === 'string' && /^[a-zA-Z0-9._@-]+$/.test(req.query.service)
        ? req.query.service
        : '';
      const args = serviceName
        ? ['-u', serviceName, '-f', '-n', '50', '--no-pager']
        : ['-f', '-n', '50', '--no-pager'];
      journalProcess = spawn('journalctl', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let buf = '';
      journalProcess.stdout?.on('data', (chunk: Buffer) => {
        buf += chunk.toString();
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (line.trim()) {
            res.write(`data: ${JSON.stringify({ line })}\n\n`);
          }
        }
      });

      journalProcess.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString().trim();
        if (text) {
          res.write(`data: ${JSON.stringify({ line: `[stderr] ${text}` })}\n\n`);
        }
      });

      journalProcess.on('close', () => {
        res.write(`data: ${JSON.stringify({ line: "[journalctl process ended]" })}\n\n`);
        res.end();
      });

      journalProcess.on('error', (err) => {
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        res.end();
      });
    } else {
      res.write(`data: ${JSON.stringify({ demo: true })}\n\n`);
    }

    req.on('close', () => {
      if (journalProcess) {
        journalProcess.kill();
        journalProcess = null;
      }
    });
  });

  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  function broadcast(data: string) {
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  }

  const currentState: {
    terminals: Record<string, any>;
    localHistory: any[];
    externalHistory: any[];
    sdsMessages: any[];
  } = { terminals: {}, localHistory: [], externalHistory: [], sdsMessages: [] };
  const MAX_HISTORY = 50;

  function updateStateFromEvent(event: any) {
    switch (event.type) {
      case 'full_state':
        currentState.terminals = event.payload.terminals || {};
        currentState.localHistory = event.payload.localHistory || [];
        currentState.externalHistory = event.payload.externalHistory || [];
        currentState.sdsMessages = event.payload.sdsMessages || [];
        break;
      case 'update_terminal':
        if (event.payload && event.payload.id) {
          currentState.terminals[event.payload.id] = event.payload;
        }
        break;
      case 'new_call': {
        const entry = event.payload;
        if (entry) {
          if (entry.isLocal) {
            currentState.localHistory.unshift(entry);
            if (currentState.localHistory.length > MAX_HISTORY)
              currentState.localHistory = currentState.localHistory.slice(0, MAX_HISTORY);
          } else {
            currentState.externalHistory.unshift(entry);
            if (currentState.externalHistory.length > MAX_HISTORY)
              currentState.externalHistory = currentState.externalHistory.slice(0, MAX_HISTORY);
          }
        }
        break;
      }
      case 'update_call': {
        const updated = event.payload;
        if (updated) {
          if (updated.isLocal) {
            currentState.localHistory = currentState.localHistory.map(
              (e: any) => e.id === updated.id ? updated : e
            );
          } else {
            currentState.externalHistory = currentState.externalHistory.map(
              (e: any) => e.id === updated.id ? updated : e
            );
          }
        }
        break;
      }
      case 'sds_message': {
        const sds = event.payload;
        if (sds) {
          currentState.sdsMessages.unshift(sds);
          if (currentState.sdsMessages.length > MAX_HISTORY)
            currentState.sdsMessages = currentState.sdsMessages.slice(0, MAX_HISTORY);
        }
        break;
      }
    }
  }

  wss.on('connection', (ws) => {
    const snapshot = JSON.stringify({
      type: 'full_state',
      payload: {
        terminals: currentState.terminals,
        localHistory: currentState.localHistory,
        externalHistory: currentState.externalHistory,
        sdsMessages: currentState.sdsMessages,
      }
    });
    ws.send(snapshot);
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

          updateStateFromEvent(event);

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
