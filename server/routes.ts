import type { Express } from "express";
import type { Server } from "http";
import * as http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { api } from "@shared/routes";
import { spawn, exec, execSync, type ChildProcess } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

let pythonProcess: ChildProcess | null = null;
const startTime = Date.now();

let cachedPublicIp: string | null = null;
let publicIpLastFetch = 0;

async function fetchPublicIp(): Promise<string | null> {
  const now = Date.now();
  if (cachedPublicIp && now - publicIpLastFetch < 5 * 60 * 1000) return cachedPublicIp;
  const services = [
    { url: "https://api.ipify.org?format=json", parse: (d: any) => d.ip },
    { url: "https://api4.my-ip.io/v2/ip.json",  parse: (d: any) => d.ip },
    { url: "https://ifconfig.co/json",            parse: (d: any) => d.ip },
  ];
  for (const svc of services) {
    try {
      const res = await fetch(svc.url, { signal: AbortSignal.timeout(4000) });
      const data = await res.json();
      const ip = svc.parse(data);
      if (ip && typeof ip === "string") {
        cachedPublicIp = ip;
        publicIpLastFetch = now;
        return cachedPublicIp;
      }
    } catch { /* try next */ }
  }
  return cachedPublicIp;
}

function getLocalIp(): string | null {
  try {
    const nets = os.networkInterfaces();
    for (const addrs of Object.values(nets)) {
      if (!addrs) continue;
      for (const addr of addrs) {
        if (addr.family === "IPv4" && !addr.internal) return addr.address;
      }
    }
  } catch {}
  return null;
}

function getVoltage(): number | null {
  // 1) Pi 5 PMIC: vcgencmd pmic_read_adc EXT5V_V → "EXT5V_V 5.0670V"
  try {
    const out = execSync("vcgencmd pmic_read_adc EXT5V_V 2>/dev/null", { timeout: 2000 }).toString().trim();
    const m = out.match(/([\d.]+)V/);
    if (m) {
      const v = parseFloat(m[1]);
      if (v > 1) return Math.round(v * 100) / 100;
    }
  } catch {}

  // 2) Kernel power supply subsystem (values in µV, only accept > 1V supply rails)
  const preferredSources = ["rpi_supply", "ac", "usb", "BAT0", "BAT1"];
  try {
    for (const src of preferredSources) {
      const vPath = `/sys/class/power_supply/${src}/voltage_now`;
      if (fs.existsSync(vPath)) {
        const volts = parseInt(fs.readFileSync(vPath, "utf-8").trim()) / 1_000_000;
        if (volts > 1) return Math.round(volts * 100) / 100;
      }
    }
    const dirs = fs.readdirSync("/sys/class/power_supply");
    for (const d of dirs) {
      const vPath = `/sys/class/power_supply/${d}/voltage_now`;
      if (fs.existsSync(vPath)) {
        const volts = parseInt(fs.readFileSync(vPath, "utf-8").trim()) / 1_000_000;
        if (volts > 1) return Math.round(volts * 100) / 100;
      }
    }
  } catch {}

  return null;
}

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

  app.get(api.system.stats.path, async (_req, res) => {
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
    const localIp = getLocalIp();
    const publicIp = await fetchPublicIp();
    const voltage = getVoltage();

    res.json({
      cpuTemp,
      cpuLoad,
      memUsed,
      localIp,
      publicIp,
      voltage,
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

  app.post(api.system.verifyPassword.path, (req, res) => {
    const { password } = req.body || {};
    if (!password || password !== getSystemPassword()) {
      return res.status(401).json({ ok: false, message: "Contraseña incorrecta" });
    }
    res.json({ ok: true });
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

  // ─── VPN / WireGuard ────────────────────────────────────────────────────
  const VPN_DATA_PATH = path.join(process.cwd(), "vpn-data.json");

  interface VpnClient { name: string; privateKey: string; publicKey: string; address: string; createdAt: string; }
  interface VpnData { serverPrivateKey: string; serverPublicKey: string; serverAddress: string; serverPort: number; clientDns: string; clients: VpnClient[]; }

  function readVpnData(): VpnData | null { try { return JSON.parse(fs.readFileSync(VPN_DATA_PATH, "utf-8")); } catch { return null; } }
  function writeVpnData(data: VpnData): void { fs.writeFileSync(VPN_DATA_PATH, JSON.stringify(data, null, 2)); }

  function buildServerConf(data: VpnData): string {
    let out = `[Interface]\nPrivateKey = ${data.serverPrivateKey}\nAddress = ${data.serverAddress}\nListenPort = ${data.serverPort}\nPostUp = iptables -A FORWARD -i %i -j ACCEPT; iptables -A FORWARD -o %i -j ACCEPT; iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE\nPostDown = iptables -D FORWARD -i %i -j ACCEPT; iptables -D FORWARD -o %i -j ACCEPT; iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE\n`;
    for (const c of data.clients) { out += `\n# ${c.name}\n[Peer]\nPublicKey = ${c.publicKey}\nAllowedIPs = ${c.address}\n`; }
    return out;
  }

  function buildClientConf(data: VpnData, client: VpnClient, pubIp: string): string {
    return `[Interface]\nPrivateKey = ${client.privateKey}\nAddress = ${client.address}\nDNS = ${data.clientDns}\n\n[Peer]\nPublicKey = ${data.serverPublicKey}\nEndpoint = ${pubIp}:${data.serverPort}\nAllowedIPs = 0.0.0.0/0\nPersistentKeepalive = 25\n`;
  }

  function genWgKeys(): { privateKey: string; publicKey: string } | null {
    try {
      const WG = "/usr/bin/wg";
      const privateKey = execSync(`${WG} genkey 2>/dev/null`, { timeout: 5000 }).toString().trim();
      const publicKey = execSync(`echo "${privateKey}" | ${WG} pubkey 2>/dev/null`, { timeout: 5000 }).toString().trim();
      return { privateKey, publicKey };
    } catch { return null; }
  }

  function parseWgShow(out: string): any {
    const result: any = { interface: "", listenPort: null, publicKey: "", peers: [] };
    let peer: any = null;
    for (const raw of out.split("\n")) {
      const t = raw.trim();
      const val = (prefix: string) => t.startsWith(prefix) ? t.slice(prefix.length).trim() : null;
      if (val("interface:") !== null) result.interface = val("interface:");
      else if (val("listening port:") !== null) result.listenPort = parseInt(val("listening port:") || "0");
      else if (val("public key:") !== null) result.publicKey = val("public key:");
      else if (val("peer:") !== null) { peer = { publicKey: val("peer:"), endpoint: null, allowedIps: "", latestHandshake: null, transfer: null }; result.peers.push(peer); }
      else if (peer) {
        if (val("endpoint:") !== null) peer.endpoint = val("endpoint:");
        else if (val("allowed ips:") !== null) peer.allowedIps = val("allowed ips:");
        else if (val("latest handshake:") !== null) peer.latestHandshake = val("latest handshake:");
        else if (val("transfer:") !== null) peer.transfer = val("transfer:");
      }
    }
    return result;
  }

  app.get("/api/vpn/status", (_req, res) => {
    let installed = false;
    try { execSync("which wg 2>/dev/null", { timeout: 2000 }); installed = true; } catch {}
    let active = false; let wgInfo: any = null;
    if (installed) {
      try {
        const out = execSync("sudo wg show wg0 2>/dev/null", { timeout: 4000 }).toString();
        if (out.trim()) { active = true; wgInfo = parseWgShow(out); }
      } catch {}
    }
    const data = readVpnData();
    res.json({ installed, active, wgInfo, configured: !!data, serverPublicKey: data?.serverPublicKey || null, serverAddress: data?.serverAddress || null, serverPort: data?.serverPort || null, clientDns: data?.clientDns || null });
  });

  app.post("/api/vpn/install", (req, res) => {
    const { password } = req.body || {};
    if (!password || password !== getSystemPassword()) return res.status(401).json({ message: "Contraseña incorrecta" });
    res.json({ message: "Instalando WireGuard..." });
    exec("sudo apt-get install -y wireguard wireguard-tools iptables 2>&1", () => {});
  });

  app.post("/api/vpn/setup", (req, res) => {
    const { password, serverAddress, serverPort, clientDns } = req.body || {};
    if (!password || password !== getSystemPassword()) return res.status(401).json({ message: "Contraseña incorrecta" });
    const keys = genWgKeys();
    if (!keys) return res.status(500).json({ message: "Error generando claves. ¿WireGuard instalado?" });
    const existing = readVpnData();
    const data: VpnData = { serverPrivateKey: keys.privateKey, serverPublicKey: keys.publicKey, serverAddress: serverAddress || "10.8.0.1/24", serverPort: parseInt(serverPort) || 51820, clientDns: clientDns || "8.8.8.8", clients: existing?.clients || [] };
    writeVpnData(data);
    const tmp = `/tmp/wg0_${Date.now()}.conf`;
    try {
      fs.writeFileSync(tmp, buildServerConf(data));
      execSync(`sudo mkdir -p /etc/wireguard && sudo cp ${tmp} /etc/wireguard/wg0.conf && sudo chmod 600 /etc/wireguard/wg0.conf`, { timeout: 10000 });
      try { fs.unlinkSync(tmp); } catch {}
    } catch (e: any) { return res.status(500).json({ message: e.message }); }
    res.json({ message: "Servidor configurado", publicKey: keys.publicKey });
  });

  app.post("/api/vpn/connect", (req, res) => {
    const { password } = req.body || {};
    if (!password || password !== getSystemPassword()) return res.status(401).json({ message: "Contraseña incorrecta" });
    try { execSync("sudo wg-quick up wg0 2>&1", { timeout: 15000 }); res.json({ message: "WireGuard activo" }); }
    catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/vpn/disconnect", (req, res) => {
    const { password } = req.body || {};
    if (!password || password !== getSystemPassword()) return res.status(401).json({ message: "Contraseña incorrecta" });
    try { execSync("sudo wg-quick down wg0 2>&1", { timeout: 10000 }); res.json({ message: "WireGuard detenido" }); }
    catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/vpn/uninstall", (req, res) => {
    const { password } = req.body || {};
    if (!password || password !== getSystemPassword()) return res.status(401).json({ message: "Contraseña incorrecta" });
    try { try { execSync("sudo wg-quick down wg0 2>&1", { timeout: 10000 }); } catch {} } catch {}
    try { execSync("sudo rm -f /etc/wireguard/wg0.conf", { timeout: 5000 }); } catch {}
    const vpnDataPath = path.join(process.cwd(), "vpn-data.json");
    try { if (fs.existsSync(vpnDataPath)) fs.unlinkSync(vpnDataPath); } catch {}
    res.json({ message: "WireGuard desinstalado. Eliminando paquetes en segundo plano..." });
    exec("sudo apt-get remove -y wireguard wireguard-tools wireguard-dkms 2>&1", () => {});
  });

  app.get("/api/vpn/clients", (_req, res) => {
    const data = readVpnData();
    res.json((data?.clients || []).map(({ name, address, publicKey, createdAt }) => ({ name, address, publicKey, createdAt })));
  });

  app.post("/api/vpn/clients", (req, res) => {
    const { password, name } = req.body || {};
    if (!password || password !== getSystemPassword()) return res.status(401).json({ message: "Contraseña incorrecta" });
    const data = readVpnData();
    if (!data) return res.status(400).json({ message: "Servidor no configurado aún" });
    if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) return res.status(400).json({ message: "Nombre inválido (solo letras, números, _ -)" });
    if (data.clients.find(c => c.name === name)) return res.status(400).json({ message: "Ya existe un cliente con ese nombre" });
    const keys = genWgKeys();
    if (!keys) return res.status(500).json({ message: "Error generando claves" });
    const parts = data.serverAddress.split("/")[0].split(".");
    const clientAddr = `${parts[0]}.${parts[1]}.${parts[2]}.${data.clients.length + 2}/32`;
    const client: VpnClient = { name, privateKey: keys.privateKey, publicKey: keys.publicKey, address: clientAddr, createdAt: new Date().toISOString() };
    data.clients.push(client);
    writeVpnData(data);
    const tmp = `/tmp/wg0_${Date.now()}.conf`;
    try {
      fs.writeFileSync(tmp, buildServerConf(data));
      execSync(`sudo cp ${tmp} /etc/wireguard/wg0.conf && sudo chmod 600 /etc/wireguard/wg0.conf`, { timeout: 10000 });
      try { fs.unlinkSync(tmp); } catch {}
      try { execSync(`sudo wg set wg0 peer ${keys.publicKey} allowed-ips ${clientAddr} 2>/dev/null`, { timeout: 5000 }); } catch {}
    } catch {}
    res.json({ name: client.name, address: client.address, publicKey: client.publicKey, createdAt: client.createdAt });
  });

  app.get("/api/vpn/clients/:name/config", (req, res) => {
    const data = readVpnData();
    if (!data) return res.status(404).json({ message: "No configurado" });
    const client = data.clients.find(c => c.name === req.params.name);
    if (!client) return res.status(404).json({ message: "Cliente no encontrado" });
    res.json({ config: buildClientConf(data, client, cachedPublicIp || "TU_IP_PUBLICA") });
  });

  app.delete("/api/vpn/clients/:name", (req, res) => {
    const { password } = req.body || {};
    if (!password || password !== getSystemPassword()) return res.status(401).json({ message: "Contraseña incorrecta" });
    const data = readVpnData();
    if (!data) return res.status(404).json({ message: "No configurado" });
    const client = data.clients.find(c => c.name === req.params.name);
    if (!client) return res.status(404).json({ message: "No encontrado" });
    try { execSync(`sudo wg set wg0 peer ${client.publicKey} remove 2>/dev/null || true`, { timeout: 5000 }); } catch {}
    data.clients = data.clients.filter(c => c.name !== req.params.name);
    writeVpnData(data);
    const tmp = `/tmp/wg0_${Date.now()}.conf`;
    try {
      fs.writeFileSync(tmp, buildServerConf(data));
      execSync(`sudo cp ${tmp} /etc/wireguard/wg0.conf && sudo chmod 600 /etc/wireguard/wg0.conf`, { timeout: 10000 });
      try { fs.unlinkSync(tmp); } catch {}
    } catch {}
    res.json({ message: "Cliente eliminado" });
  });
  // ─── WIFI MANAGER ──────────────────────────────────────────────────────────

  function nmcliAvailable(): boolean {
    try { execSync("which nmcli", { timeout: 2000 }); return true; } catch { return false; }
  }

  // ─── Talkgroup names proxy ─────────────────────────────────────────────────
  const tgCache: Record<string, { ts: number; data: Record<string, string> }> = {};
  const TG_CACHE_TTL = 60 * 60 * 1000;

  app.get("/api/talkgroups", (_req, res) => {
    const source = (_req.query.source as string) || "bm";
    if (!["bm", "adn"].includes(source)) return res.status(400).json({ message: "Invalid source" });
    if (tgCache[source] && Date.now() - tgCache[source].ts < TG_CACHE_TTL) {
      return res.json({ source, data: tgCache[source].data, cached: true, count: Object.keys(tgCache[source].data).length });
    }
    try {
      const url = source === "bm"
        ? "https://api.brandmeister.network/v2/talkgroup"
        : "https://servers.adn.systems/talkgroup_ids.json";
      const raw = execSync(`curl -sf --max-time 30 -H "Accept: application/json" "${url}"`, { timeout: 35000 }).toString();
      const json = JSON.parse(raw);
      const data: Record<string, string> = {};
      if (source === "bm") {
        // BM /v2/talkgroup returns either:
        //   { "1": "Local", "2": "Cluster", ... }  (flat id→name dict)
        //   [ { talkgroup_id, name, ... }, ... ]    (array of objects)
        if (Array.isArray(json)) {
          for (const item of json) {
            const id = String(item.talkgroup_id ?? item.id ?? item.ID ?? "").trim();
            const name = String(item.name ?? item.Name ?? item.description ?? item.Description ?? "").trim();
            if (id && name) data[id] = name;
          }
        } else {
          // Flat dict: keys are IDs, values are names (strings) or objects
          for (const [k, v] of Object.entries(json)) {
            if (typeof v === "string") {
              if (k && v) data[k] = v;
            } else if (typeof v === "object" && v !== null) {
              const id = String((v as any).talkgroup_id ?? (v as any).id ?? k).trim();
              const name = String((v as any).name ?? (v as any).Name ?? (v as any).description ?? "").trim();
              if (id && name) data[id] = name;
            }
          }
        }
      } else {
        // ADN /talkgroup_ids.json returns { "results": [ { tgid, callsign, id }, ... ] }
        const items: any[] = Array.isArray(json)
          ? json
          : Array.isArray(json.results)
            ? json.results
            : Object.values(json);
        for (const item of items) {
          if (typeof item === "string") continue;
          const id = String(item.tgid ?? item.id ?? item.ID ?? "").trim();
          const name = String(item.callsign ?? item.name ?? item.Name ?? item.description ?? "").trim();
          if (id && name) data[id] = name;
        }
      }
      tgCache[source] = { ts: Date.now(), data };
      res.json({ source, data, cached: false, count: Object.keys(data).length });
    } catch (err) {
      res.status(502).json({ message: `Failed to fetch from ${source}: ${String(err).substring(0, 120)}` });
    }
  });

  // ─── Update endpoints ──────────────────────────────────────────────────────

  // Detect git repo root: prefer /opt/tetra-live-monitor, fall back to cwd
  const UPDATE_DIR = (() => {
    const candidates = ["/opt/tetra-live-monitor", process.cwd()];
    for (const dir of candidates) {
      try {
        if (fs.existsSync(dir) && fs.existsSync(path.join(dir, ".git"))) return dir;
      } catch {}
    }
    return null;
  })();

  app.get("/api/update/check", (_req, res) => {
    if (!UPDATE_DIR) return res.json({ demo: true });
    try {
      execSync("which git", { timeout: 2000 });
    } catch {
      return res.json({ demo: true });
    }
    let localHash = "";
    try {
      localHash = execSync(`git -C "${UPDATE_DIR}" rev-parse HEAD`, { timeout: 5000 }).toString().trim();
    } catch {
      return res.json({ demo: true });
    }
    // Use git ls-remote to get remote hash (same protocol as git pull, no API rate limits)
    let remoteHash = "";
    try {
      const lsOut = execSync(
        `git ls-remote https://github.com/ea5gvk/tetra-live-monitor.git main`,
        { timeout: 15000 }
      ).toString();
      remoteHash = lsOut.split(/\s+/)[0].trim();
    } catch (err) {
      return res.json({
        demo: false,
        upToDate: false,
        localHash: localHash.substring(0, 8),
        remoteHash: "??????",
        remoteMessage: "No se pudo contactar GitHub",
        remoteDate: "",
        remoteAuthor: "",
        apiError: String(err).substring(0, 160),
        updateDir: UPDATE_DIR,
      });
    }

    // Optionally fetch commit details from GitHub API (nice-to-have, won't fail if unavailable)
    let remoteMessage = "", remoteDate = "", remoteAuthor = "";
    try {
      const ghToken = process.env.GITHUB_TOKEN ? `-H "Authorization: token ${process.env.GITHUB_TOKEN}"` : "";
      const raw = execSync(
        `curl -sf --max-time 8 -H "User-Agent: tetra-live-monitor" ${ghToken} "https://api.github.com/repos/ea5gvk/tetra-live-monitor/commits/main"`,
        { timeout: 10000 }
      ).toString();
      const data = JSON.parse(raw);
      remoteMessage = (data.commit?.message || "").split("\n")[0];
      remoteDate = data.commit?.author?.date || "";
      remoteAuthor = data.commit?.author?.name || "";
    } catch {
      // API unavailable — version check still works via git ls-remote
      remoteMessage = "(detalles no disponibles)";
    }

    res.json({
      upToDate: localHash === remoteHash,
      localHash: localHash.substring(0, 8),
      remoteHash: remoteHash.substring(0, 8),
      remoteMessage,
      remoteDate,
      remoteAuthor,
      demo: false,
      updateDir: UPDATE_DIR,
    });
  });

  app.post("/api/update/apply", (req, res) => {
    const { password } = req.body || {};
    if (!password || password !== getSystemPassword()) {
      return res.status(401).json({ message: "Contraseña incorrecta" });
    }
    if (!UPDATE_DIR) {
      return res.status(400).json({ message: "update_demo_mode" });
    }
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("Cache-Control", "no-cache");
    res.flushHeaders();

    const dashScript = `
set -e
cd "${UPDATE_DIR}"
echo "=== Updating npm ==="
npm install -g npm@latest 2>&1 || echo "(npm self-update skipped)"
echo ""
echo "=== git pull ==="
if PULL_OUT=$(git pull 2>&1); then
  echo "$PULL_OUT"
else
  PULL_EXIT=$?
  echo "$PULL_OUT"
  if echo "$PULL_OUT" | grep -q "would be overwritten by merge"; then
    FILES=$(echo "$PULL_OUT" | awk '/following files would be overwritten/{p=1;next}/Please commit/{p=0}p' | sed 's/^[[:space:]]*//' | sed '/^[[:space:]]*$/d')
    echo ""
    echo "=== Local conflicts detected — resetting automatically... ==="
    while IFS= read -r f; do
      if [ -n "$f" ]; then
        echo "  git checkout -- \$f"
        git checkout -- "\$f"
      fi
    done <<< "$FILES"
    echo "=== Retrying git pull... ==="
    git pull
  else
    exit $PULL_EXIT
  fi
fi
echo ""
if echo "$PULL_OUT" | grep -qE "package\\.json|package-lock\\.json"; then
  echo "=== npm install (package.json changed) ==="
  npm install
  echo ""
else
  echo "=== Skipping npm install (package.json unchanged) ==="
  echo ""
fi
echo "=== npm run build ==="
npm run build
echo ""
echo "=== pm2 restart tetra-monitor ==="
pm2 restart tetra-monitor
`;
    const child = spawn("bash", ["-c", dashScript], { cwd: UPDATE_DIR });
    child.stdout.on("data", (d: Buffer) => res.write(d.toString()));
    child.stderr.on("data", (d: Buffer) => res.write(d.toString()));
    child.on("close", (code: number) => {
      res.write(`\n[Exit: ${code}]\n`);
      res.end();
    });
    child.on("error", (err: Error) => {
      res.write(`\n[Error: ${err.message}]\n`);
      res.end();
    });
  });

  // ─── Bluestation update endpoints ───────────────────────────────────────────

  app.get("/api/bluestation/check", (req, res) => {
    const dir = (req.query.dir as string) || "/root/tetra-bluestation";
    const cleanDir = dir.replace(/[;&|`$]/g, "");
    if (!fs.existsSync(cleanDir)) return res.json({ demo: false, dirNotFound: true });
    try {
      execSync("which git", { timeout: 2000 });
    } catch {
      return res.json({ demo: true });
    }
    let localHash = "";
    try {
      localHash = execSync(`git -C "${cleanDir}" rev-parse HEAD 2>/dev/null`, { timeout: 5000 }).toString().trim();
    } catch {
      return res.json({ demo: true });
    }

    // Use git ls-remote to get remote hash (same protocol as git pull, no API rate limits)
    let remoteHash = "";
    try {
      const lsOut = execSync(
        `git ls-remote https://github.com/MidnightBlueLabs/tetra-bluestation.git main`,
        { timeout: 15000 }
      ).toString();
      remoteHash = lsOut.split(/\s+/)[0].trim();
    } catch (err) {
      return res.json({
        demo: false,
        dirNotFound: false,
        upToDate: false,
        localHash: localHash.substring(0, 8),
        remoteHash: "??????",
        remoteMessage: "No se pudo contactar GitHub",
        remoteDate: "",
        remoteAuthor: "",
        apiError: String(err).substring(0, 160),
      });
    }

    // Optionally fetch commit details from GitHub API (nice-to-have)
    let remoteMessage = "", remoteDate = "", remoteAuthor = "";
    try {
      const ghToken = process.env.GITHUB_TOKEN ? `-H "Authorization: token ${process.env.GITHUB_TOKEN}"` : "";
      const raw = execSync(
        `curl -sf --max-time 8 -H "User-Agent: tetra-live-monitor" ${ghToken} "https://api.github.com/repos/MidnightBlueLabs/tetra-bluestation/commits/main"`,
        { timeout: 10000 }
      ).toString();
      const data = JSON.parse(raw);
      remoteMessage = (data.commit?.message || "").split("\n")[0];
      remoteDate = data.commit?.author?.date || "";
      remoteAuthor = data.commit?.author?.name || "";
    } catch {
      remoteMessage = "(detalles no disponibles)";
    }

    res.json({
      upToDate: localHash === remoteHash,
      localHash: localHash.substring(0, 8),
      remoteHash: remoteHash.substring(0, 8),
      remoteMessage,
      remoteDate,
      remoteAuthor,
      demo: false,
      dirNotFound: false,
    });
  });

  app.post("/api/bluestation/apply", (req, res) => {
    const { password, dir = "/root/tetra-bluestation", serviceName = "tmo.service" } = req.body || {};
    if (!password || password !== getSystemPassword()) {
      return res.status(401).json({ message: "Contraseña incorrecta" });
    }
    const cleanDir = (dir as string).replace(/[;&|`$]/g, "");
    const cleanService = (serviceName as string).replace(/[;&|`$\s]/g, "");
    if (!fs.existsSync(cleanDir)) {
      return res.status(400).json({ message: "bluestation_dir_not_found" });
    }
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("Cache-Control", "no-cache");
    res.flushHeaders();

    const restartLine = cleanService
      ? `echo "=== Restarting ${cleanService}... ===" && sudo systemctl restart ${cleanService}`
      : `echo "No service configured to restart."`;

    // Script: try git pull; if conflict, auto-checkout the affected files and retry
    const script = `
set -e
cd "${cleanDir}"
echo "=== git pull ==="
if PULL_OUT=$(git pull 2>&1); then
  echo "$PULL_OUT"
else
  PULL_EXIT=$?
  echo "$PULL_OUT"
  if echo "$PULL_OUT" | grep -q "would be overwritten by merge"; then
    FILES=$(echo "$PULL_OUT" | awk '/following files would be overwritten/{p=1;next}/Please commit/{p=0}p' | sed 's/^[[:space:]]*//' | sed '/^[[:space:]]*$/d')
    echo ""
    echo "=== Local conflicts detected — resetting automatically... ==="
    while IFS= read -r f; do
      if [ -n "$f" ]; then
        echo "  git checkout -- \$f"
        git checkout -- "\$f"
      fi
    done <<< "$FILES"
    echo "=== Retrying git pull... ==="
    git pull
  else
    exit $PULL_EXIT
  fi
fi
echo ""
echo "=== cargo build --release ==="
cargo build --release
echo ""
${restartLine}
`;
    const child = spawn("bash", ["-c", script], { cwd: cleanDir });
    child.stdout.on("data", (d: Buffer) => res.write(d.toString()));
    child.stderr.on("data", (d: Buffer) => res.write(d.toString()));
    child.on("close", (code: number) => {
      res.write(`\n[Exit: ${code}]\n`);
      res.end();
    });
    child.on("error", (err: Error) => {
      res.write(`\n[Error: ${err.message}]\n`);
      res.end();
    });
  });

  // ─── Flowstation install / update / check ───────────────────────────────────
  const FLOW_DIR_DEFAULT = "/root/flowstation";
  const FLOW_SERVICE = "flowstation.service";
  const FLOW_REPO = "razvanzeces/flowstation";
  const FLOW_SERVICE_FILE = `[Unit]
Description=Tetra Flowstation
After=network.target

[Service]
Type=simple
CPUSchedulingPolicy=fifo
CPUSchedulingPriority=73
WorkingDirectory=/root/flowstation
ExecStart=/root/flowstation/target/release/bluestation-bs /root/flowstation/config.toml

StandardOutput=journal
StandardError=journal

Restart=always
RestartSec=2
KillSignal=SIGINT

[Install]
WantedBy=multi-user.target
`;

  app.get("/api/flowstation/check", (_req, res) => {
    // Hard-coded path — ignore any user-supplied input to avoid command injection
    const dir = FLOW_DIR_DEFAULT;
    const installed = fs.existsSync(dir);
    if (!installed) return res.json({ demo: false, dirNotFound: true });
    try { execSync("which git", { timeout: 2000 }); } catch { return res.json({ demo: true }); }

    let localHash = "";
    try {
      localHash = execSync(`git -C "${dir}" rev-parse HEAD 2>/dev/null`, { timeout: 5000 }).toString().trim();
    } catch { return res.json({ demo: true }); }

    let remoteHash = "";
    try {
      const lsOut = execSync(`git ls-remote https://github.com/${FLOW_REPO}.git main`, { timeout: 15000 }).toString();
      remoteHash = lsOut.split(/\s+/)[0].trim();
    } catch (err) {
      return res.json({
        demo: false, dirNotFound: false, upToDate: false,
        localHash: localHash.substring(0, 8), remoteHash: "??????",
        remoteMessage: "No se pudo contactar GitHub", remoteDate: "", remoteAuthor: "",
        apiError: String(err).substring(0, 160),
      });
    }

    let remoteMessage = "", remoteDate = "", remoteAuthor = "";
    try {
      const ghToken = process.env.GITHUB_TOKEN ? `-H "Authorization: token ${process.env.GITHUB_TOKEN}"` : "";
      const raw = execSync(
        `curl -sf --max-time 8 -H "User-Agent: tetra-live-monitor" ${ghToken} "https://api.github.com/repos/${FLOW_REPO}/commits/main"`,
        { timeout: 10000 }
      ).toString();
      const data = JSON.parse(raw);
      remoteMessage = (data.commit?.message || "").split("\n")[0];
      remoteDate = data.commit?.author?.date || "";
      remoteAuthor = data.commit?.author?.name || "";
    } catch { remoteMessage = "(detalles no disponibles)"; }

    res.json({
      upToDate: localHash === remoteHash,
      localHash: localHash.substring(0, 8),
      remoteHash: remoteHash.substring(0, 8),
      remoteMessage, remoteDate, remoteAuthor,
      demo: false, dirNotFound: false,
    });
  });

  app.post("/api/flowstation/install", (req, res) => {
    const { password } = req.body || {};
    if (!password || password !== getSystemPassword()) {
      return res.status(401).json({ message: "Contraseña incorrecta" });
    }
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("Cache-Control", "no-cache");
    res.flushHeaders();

    const serviceFileEscaped = FLOW_SERVICE_FILE.replace(/'/g, "'\\''");
    const script = `
set -e
cd /root
if [ -d /root/flowstation ]; then
  echo "=== Existing /root/flowstation found — removing for clean install ==="
  sudo rm -rf /root/flowstation
fi
echo "=== git clone https://github.com/${FLOW_REPO} ==="
sudo git clone https://github.com/${FLOW_REPO}
sudo chown -R root:root /root/flowstation
cd /root/flowstation
[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env" || true
[ -f /root/.cargo/env ] && . /root/.cargo/env || true
echo ""
echo "=== cargo build --release (esto tarda varios minutos) ==="
sudo bash -lc 'cd /root/flowstation && [ -f /root/.cargo/env ] && . /root/.cargo/env; cargo build --release'
echo ""
echo "=== Copiando example_config/config.toml -> config.toml ==="
sudo cp example_config/config.toml config.toml
echo ""
echo "=== Creando /etc/systemd/system/${FLOW_SERVICE} ==="
sudo bash -c 'cat > /etc/systemd/system/${FLOW_SERVICE} <<'\\''EOF'\\''
${serviceFileEscaped}EOF'
sudo systemctl daemon-reload
echo ""
echo "=== Instalación completada ==="
echo "Para activar Flowstation usa el selector de estación en la barra de navegación."
`;
    const child = spawn("bash", ["-c", script]);
    child.stdout.on("data", (d: Buffer) => res.write(d.toString()));
    child.stderr.on("data", (d: Buffer) => res.write(d.toString()));
    child.on("close", (code: number) => { res.write(`\n[Exit: ${code}]\n`); res.end(); });
    child.on("error", (err: Error) => { res.write(`\n[Error: ${err.message}]\n`); res.end(); });
  });

  app.post("/api/flowstation/apply", (req, res) => {
    const { password } = req.body || {};
    if (!password || password !== getSystemPassword()) {
      return res.status(401).json({ message: "Contraseña incorrecta" });
    }
    // Hard-coded path/service — ignore any user-supplied input to avoid command injection
    const cleanDir = FLOW_DIR_DEFAULT;
    const cleanService = FLOW_SERVICE;
    if (!fs.existsSync(cleanDir)) {
      return res.status(400).json({ message: "flowstation_dir_not_found" });
    }
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("Cache-Control", "no-cache");
    res.flushHeaders();

    const restartLine = cleanService
      ? `if systemctl is-active --quiet ${cleanService}; then echo "=== Reiniciando ${cleanService}... ===" && sudo systemctl restart ${cleanService}; else echo "(${cleanService} no activo — no se reinicia)"; fi`
      : `echo "No service configured."`;

    const script = `
set -e
cd "${cleanDir}"
echo "=== git fetch ==="
sudo git fetch --all --prune
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)
echo "=== Sincronizando con origin/$BRANCH (reset --hard, soporta force-push) ==="
sudo git reset --hard "origin/$BRANCH"
echo ""
echo "=== cargo build --release ==="
sudo bash -lc 'cd "${cleanDir}" && [ -f /root/.cargo/env ] && . /root/.cargo/env; cargo build --release'
echo ""
${restartLine}
`;
    const child = spawn("bash", ["-c", script], { cwd: cleanDir });
    child.stdout.on("data", (d: Buffer) => res.write(d.toString()));
    child.stderr.on("data", (d: Buffer) => res.write(d.toString()));
    child.on("close", (code: number) => { res.write(`\n[Exit: ${code}]\n`); res.end(); });
    child.on("error", (err: Error) => { res.write(`\n[Error: ${err.message}]\n`); res.end(); });
  });

  // ─── Active station selector (Bluestation / Flowstation) ────────────────────
  const ACTIVE_STATION_PATH = path.join(process.cwd(), "active-station.json");
  type StationName = "bluestation" | "flowstation";
  const STATION_SERVICE: Record<StationName, string> = {
    bluestation: "tmo.service",
    flowstation: "flowstation.service",
  };
  const STATION_DIR: Record<StationName, string> = {
    bluestation: "/root/tetra-bluestation",
    flowstation: "/root/flowstation",
  };
  const STATION_CONFIG_PATH: Record<StationName, string> = {
    bluestation: "/root/tetra-bluestation/config.toml",
    flowstation: "/root/flowstation/config.toml",
  };

  function readActiveStation(): StationName {
    try {
      const data = JSON.parse(fs.readFileSync(ACTIVE_STATION_PATH, "utf-8"));
      if (data.station === "bluestation" || data.station === "flowstation") return data.station;
    } catch {}
    return "bluestation";
  }

  function serviceState(name: string): { exists: boolean; active: boolean; enabled: boolean } {
    let exists = false, active = false, enabled = false;
    try {
      const out = execSync(`systemctl list-unit-files ${name} --no-pager --no-legend 2>/dev/null`, { timeout: 4000 }).toString().trim();
      if (out && out.includes(name)) exists = true;
    } catch {}
    if (!exists) {
      // Fallback: check if file exists directly
      exists = fs.existsSync(`/etc/systemd/system/${name}`) || fs.existsSync(`/lib/systemd/system/${name}`);
    }
    if (exists) {
      try {
        const a = execSync(`systemctl is-active ${name} 2>/dev/null`, { timeout: 4000 }).toString().trim();
        active = a === "active";
      } catch {}
      try {
        const e = execSync(`systemctl is-enabled ${name} 2>/dev/null`, { timeout: 4000 }).toString().trim();
        enabled = e === "enabled" || e === "alias" || e === "static";
      } catch {}
    }
    return { exists, active, enabled };
  }

  app.get("/api/station/active", (_req, res) => {
    const blue = serviceState(STATION_SERVICE.bluestation);
    const flow = serviceState(STATION_SERVICE.flowstation);
    const flowInstalled = fs.existsSync(STATION_DIR.flowstation);
    const blueInstalled = fs.existsSync(STATION_DIR.bluestation);
    const persisted = readActiveStation();
    // The "real" active station is the one whose service is active (overrides persisted)
    let detected: StationName = persisted;
    if (blue.active && !flow.active) detected = "bluestation";
    else if (flow.active && !blue.active) detected = "flowstation";
    res.json({
      station: detected,
      persisted,
      services: {
        bluestation: { ...blue, installed: blueInstalled, dir: STATION_DIR.bluestation, configPath: STATION_CONFIG_PATH.bluestation, service: STATION_SERVICE.bluestation },
        flowstation: { ...flow, installed: flowInstalled, dir: STATION_DIR.flowstation, configPath: STATION_CONFIG_PATH.flowstation, service: STATION_SERVICE.flowstation },
      },
    });
  });

  // ─── Flowstation native dashboard proxy ─────────────────────────────────────
  // Reads /root/flowstation/config.toml looking for an UNCOMMENTED [dashboard] section
  // with port = N. Returns enabled=true only when both are present.
  function getFlowstationDashboardConfig(): { enabled: boolean; port: number } {
    try {
      const cfg = fs.readFileSync(STATION_CONFIG_PATH.flowstation, "utf-8");
      const lines = cfg.split("\n");
      let inDash = false;
      let port = 0;
      for (const raw of lines) {
        const line = raw.trim();
        if (!line || line.startsWith("#")) continue;
        const sec = line.match(/^\[([^\]]+)\]/);
        if (sec) {
          inDash = sec[1] === "dashboard";
          continue;
        }
        if (inDash) {
          const m = line.match(/^port\s*=\s*(\d+)/);
          if (m) { port = parseInt(m[1], 10); break; }
        }
      }
      return { enabled: port > 0, port };
    } catch { return { enabled: false, port: 0 }; }
  }

  app.get("/api/flowstation/dashboard-status", (_req, res) => {
    const cfg = getFlowstationDashboardConfig();
    const flowSvc = serviceState(STATION_SERVICE.flowstation);
    res.json({ enabled: cfg.enabled, port: cfg.port, flowstationActive: flowSvc.active });
  });

  // HTTP proxy: /flow-iframe/* → http://127.0.0.1:<port>/*
  // express strips the /flow-iframe prefix from req.url for us.
  // (Path is intentionally distinct from the React SPA route /flow-dash.)
  app.use("/flow-iframe", (req, res) => {
    const cfg = getFlowstationDashboardConfig();
    if (!cfg.enabled) {
      return res.status(503).json({ message: "Flowstation [dashboard] no configurado en config.toml" });
    }
    const targetPath = req.url || "/";
    const headers: Record<string, string | string[] | undefined> = { ...req.headers };
    headers.host = `127.0.0.1:${cfg.port}`;
    delete headers["accept-encoding"]; // simplify HTML rewrite
    const proxyReq = http.request({
      hostname: "127.0.0.1",
      port: cfg.port,
      path: targetPath,
      method: req.method,
      headers: headers as any,
    }, (proxyRes) => {
      const ct = String(proxyRes.headers["content-type"] || "");
      if (ct.includes("text/html")) {
        const chunks: Buffer[] = [];
        proxyRes.on("data", (c) => chunks.push(c));
        proxyRes.on("end", () => {
          let body = Buffer.concat(chunks).toString("utf-8");
          if (!/<base\b/i.test(body)) {
            body = body.replace(/<head([^>]*)>/i, `<head$1><base href="/flow-iframe/">`);
          }
          // Rewrite root-absolute URLs so they go through the proxy
          body = body.replace(/((?:href|src|action)\s*=\s*["'])\/(?!\/|flow-iframe)/gi, `$1/flow-iframe/`);
          // Inject a runtime shim that rewrites root-absolute URLs in JS calls
          // (fetch, XMLHttpRequest, WebSocket) to go through /flow-iframe/.
          // Without this the dashboard's WS connects to our /ws (TETRA monitor)
          // and its fetches hit our routes instead of flowstation's.
          const shim = `<script>(function(){
  function rewrite(url){
    try{
      if(typeof url!=='string') return url;
      // ws://host/path or wss://host/path
      var m = url.match(/^(wss?:)\\/\\/([^\\/]+)(\\/.*)?$/i);
      if(m){
        var p = m[3]||'/';
        if(p.indexOf('/flow-iframe')!==0) p='/flow-iframe'+p;
        return m[1]+'//'+m[2]+p;
      }
      // root-absolute path
      if(url.charAt(0)==='/' && url.indexOf('/flow-iframe')!==0 && url.indexOf('//')!==0){
        return '/flow-iframe'+url;
      }
    }catch(e){}
    return url;
  }
  var OW = window.WebSocket;
  function PW(url, protocols){ return protocols===undefined ? new OW(rewrite(url)) : new OW(rewrite(url), protocols); }
  PW.prototype = OW.prototype;
  PW.CONNECTING=OW.CONNECTING; PW.OPEN=OW.OPEN; PW.CLOSING=OW.CLOSING; PW.CLOSED=OW.CLOSED;
  window.WebSocket = PW;
  var OF = window.fetch;
  if(OF){ window.fetch = function(input, init){
    if(typeof input==='string') input = rewrite(input);
    else if(input && input.url){ try{ input = new Request(rewrite(input.url), input); }catch(e){} }
    return OF.call(this, input, init);
  }; }
  var XO = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url){
    arguments[1] = rewrite(url);
    return XO.apply(this, arguments);
  };
})();</script>`;
          body = body.replace(/<head([^>]*)>/i, `<head$1>${shim}`);
          const outHeaders: Record<string, any> = { ...proxyRes.headers };
          delete outHeaders["content-length"];
          delete outHeaders["content-encoding"];
          res.writeHead(proxyRes.statusCode || 200, outHeaders);
          res.end(body);
        });
      } else {
        res.writeHead(proxyRes.statusCode || 200, proxyRes.headers as any);
        proxyRes.pipe(res);
      }
    });
    proxyReq.on("error", (err) => {
      if (!res.headersSent) {
        res.status(502).json({ message: "Flowstation dashboard inalcanzable: " + err.message });
      }
    });
    if (req.method !== "GET" && req.method !== "HEAD") (req as any).pipe(proxyReq);
    else proxyReq.end();
  });

  // WebSocket upgrade proxy for /flow-iframe/* (e.g. /flow-iframe/ws)
  httpServer.on("upgrade", (req, socket, head) => {
    if (!req.url || !req.url.startsWith("/flow-iframe")) return;
    const cfg = getFlowstationDashboardConfig();
    if (!cfg.enabled) { socket.destroy(); return; }
    const targetPath = req.url.substring("/flow-iframe".length) || "/";
    const proxyReq = http.request({
      hostname: "127.0.0.1",
      port: cfg.port,
      path: targetPath,
      method: req.method,
      headers: req.headers,
    });
    proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
      let resHeaders = `HTTP/1.1 ${proxyRes.statusCode} ${proxyRes.statusMessage}\r\n`;
      for (const [k, v] of Object.entries(proxyRes.headers)) {
        if (Array.isArray(v)) for (const vv of v) resHeaders += `${k}: ${vv}\r\n`;
        else if (v !== undefined) resHeaders += `${k}: ${v}\r\n`;
      }
      resHeaders += "\r\n";
      socket.write(resHeaders);
      if (proxyHead && proxyHead.length) socket.write(proxyHead);
      proxySocket.pipe(socket).pipe(proxySocket);
      proxySocket.on("error", () => socket.destroy());
    });
    proxyReq.on("error", () => socket.destroy());
    proxyReq.end();
  });

  // Send SDS through flowstation's dashboard WebSocket (port 8080).
  // Flowstation transmits the D-SDS-DATA PDU from hardcoded source ISSI 9999 (BS dispatcher).
  // Bluestation upstream has no equivalent control surface, so this only works when flowstation is active.
  app.post("/api/sds/send", (req, res) => {
    const { password, dest_issi, message } = req.body || {};
    if (!password || password !== getSystemPassword()) {
      return res.status(401).json({ ok: false, message: "Contraseña incorrecta" });
    }
    const dest = parseInt(String(dest_issi), 10);
    if (!dest || isNaN(dest) || dest <= 0 || dest > 16777215) {
      return res.status(400).json({ ok: false, message: "ISSI destino inválido" });
    }
    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ ok: false, message: "Mensaje vacío" });
    }
    const text = message.trim();
    if (text.length > 160) {
      return res.status(400).json({ ok: false, message: "Mensaje demasiado largo (máx 160 caracteres)" });
    }
    const flow = serviceState(STATION_SERVICE.flowstation);
    if (!flow.active) {
      return res.status(409).json({
        ok: false,
        message: "Flowstation no está activa. Cambia a FLOW para enviar SDS.",
      });
    }
    let done = false;
    const respond = (status: number, body: object) => {
      if (done) return;
      done = true;
      try { ws.close(); } catch {}
      clearTimeout(timer);
      res.status(status).json(body);
    };
    const timer = setTimeout(() => {
      respond(504, { ok: false, message: "Timeout conectando con flowstation:8080" });
    }, 5000);
    let ws: WebSocket;
    try {
      ws = new WebSocket("ws://127.0.0.1:8080/ws");
    } catch (e: any) {
      clearTimeout(timer);
      return res.status(502).json({ ok: false, message: `Error WS: ${e?.message || e}` });
    }
    ws.on("open", () => {
      try {
        ws.send(JSON.stringify({ type: "sds", dest_issi: dest, message: text }));
      } catch (e: any) {
        respond(502, { ok: false, message: `Error enviando: ${e?.message || e}` });
        return;
      }
      // Flowstation has no ack on the WS side; give the stack ~300ms to enqueue the PDU before closing.
      setTimeout(() => respond(200, { ok: true, message: `SDS enviado a ${dest}`, dest_issi: dest, source_ssi: 9999, length: text.length }), 300);
    });
    ws.on("error", (err: Error) => {
      respond(502, { ok: false, message: `Error WS flowstation: ${err.message}` });
    });
  });

  // Kick (deregister) an MS via flowstation's dashboard WebSocket. Same gating as SDS.
  app.post("/api/kick", (req, res) => {
    const { password, issi } = req.body || {};
    if (!password || password !== getSystemPassword()) {
      return res.status(401).json({ ok: false, message: "Contraseña incorrecta" });
    }
    const target = parseInt(String(issi), 10);
    if (!target || isNaN(target) || target <= 0 || target > 16777215) {
      return res.status(400).json({ ok: false, message: "ISSI inválido" });
    }
    const flow = serviceState(STATION_SERVICE.flowstation);
    if (!flow.active) {
      return res.status(409).json({
        ok: false,
        message: "Flowstation no está activa. Cambia a FLOW para expulsar terminales.",
      });
    }
    let done = false;
    const respond = (status: number, body: object) => {
      if (done) return;
      done = true;
      try { ws.close(); } catch {}
      clearTimeout(timer);
      res.status(status).json(body);
    };
    const timer = setTimeout(() => {
      respond(504, { ok: false, message: "Timeout conectando con flowstation:8080" });
    }, 5000);
    let ws: WebSocket;
    try {
      ws = new WebSocket("ws://127.0.0.1:8080/ws");
    } catch (e: any) {
      clearTimeout(timer);
      return res.status(502).json({ ok: false, message: `Error WS: ${e?.message || e}` });
    }
    ws.on("open", () => {
      try {
        ws.send(JSON.stringify({ type: "kick", issi: target }));
      } catch (e: any) {
        respond(502, { ok: false, message: `Error enviando: ${e?.message || e}` });
        return;
      }
      setTimeout(() => respond(200, { ok: true, message: `Kick enviado para ISSI ${target}`, issi: target }), 300);
    });
    ws.on("error", (err: Error) => {
      respond(502, { ok: false, message: `Error WS flowstation: ${err.message}` });
    });
  });

  app.post("/api/station/switch", (req, res) => {
    const { password, station } = req.body || {};
    if (!password || password !== getSystemPassword()) {
      return res.status(401).json({ message: "Contraseña incorrecta" });
    }
    if (station !== "bluestation" && station !== "flowstation") {
      return res.status(400).json({ message: "Estación no válida" });
    }
    const target = station as StationName;
    const other: StationName = target === "bluestation" ? "flowstation" : "bluestation";
    const targetService = STATION_SERVICE[target];
    const otherService = STATION_SERVICE[other];

    // Validate target service exists BEFORE touching the other one — prevents downtime
    // if target is missing/broken.
    const tgState = serviceState(targetService);
    if (!tgState.exists) {
      return res.status(400).json({
        ok: false,
        message: target === "flowstation"
          ? "Flowstation aún no está instalado. Pulsa 'Instalar Flowstation' primero."
          : `Servicio ${targetService} no encontrado.`,
      });
    }

    const log: string[] = [];
    function run(cmd: string) {
      try {
        const out = execSync(cmd + " 2>&1", { timeout: 15000 }).toString().trim();
        log.push(`$ ${cmd}\n${out}`);
        return true;
      } catch (e: any) {
        log.push(`$ ${cmd}\n[fail] ${e?.stderr?.toString() || e?.stdout?.toString() || e?.message || "error"}`);
        return false;
      }
    }

    // Order: enable+start target FIRST, then stop+disable the other.
    // If target fails to start, return error WITHOUT having stopped the other.
    const enabled = run(`sudo systemctl enable ${targetService}`);
    const started = run(`sudo systemctl start ${targetService}`);

    if (!started) {
      return res.status(500).json({
        ok: false,
        message: `No se pudo iniciar ${targetService}`,
        log: log.join("\n\n"),
      });
    }

    // Target is up — now stop+disable the other (ignore failures: service may not exist)
    run(`sudo systemctl disable ${otherService}`);
    run(`sudo systemctl stop ${otherService}`);

    try {
      fs.writeFileSync(ACTIVE_STATION_PATH, JSON.stringify({ station: target }, null, 2));
    } catch {}

    res.json({
      ok: true,
      station: target,
      service: targetService,
      configPath: STATION_CONFIG_PATH[target],
      log: log.join("\n\n"),
    });
  });

  // ─── WiFi endpoints ─────────────────────────────────────────────────────────

  app.post("/api/wifi/check-password", (req, res) => {
    const { password } = req.body || {};
    if (!password || password !== getSystemPassword()) return res.json({ ok: false, message: "Contraseña incorrecta" });
    res.json({ ok: true });
  });

  app.get("/api/wifi/status", (_req, res) => {
    if (!nmcliAvailable()) return res.json({ connected: false, demo: true });
    try {
      // Get active wifi connection
      const active = execSync("nmcli -t -f NAME,TYPE,DEVICE connection show --active 2>/dev/null", { timeout: 5000 }).toString().trim();
      let ssid = ""; let iface = "";
      for (const line of active.split("\n")) {
        const parts = line.split(":");
        if (parts[1] === "802-11-wireless") { ssid = parts[0]; iface = parts[2] || "wlan0"; break; }
      }
      if (!ssid) return res.json({ connected: false });
      // Get signal + security
      const devOut = execSync(`nmcli -t -f ACTIVE,SSID,SIGNAL,SECURITY device wifi list 2>/dev/null`, { timeout: 5000 }).toString().trim();
      let signal = 0; let security = "";
      for (const line of devOut.split("\n")) {
        const p = line.split(":");
        if (p[0] === "yes") { signal = parseInt(p[2]) || 0; security = p[3] || ""; break; }
      }
      // Get IP
      let ip = "";
      try {
        const ipOut = execSync(`ip -4 addr show ${iface} 2>/dev/null`, { timeout: 3000 }).toString();
        const m = ipOut.match(/inet (\d+\.\d+\.\d+\.\d+)/);
        if (m) ip = m[1];
      } catch {}
      res.json({ connected: true, ssid, signal, security: security || "WPA2", interface: iface, ip });
    } catch { res.json({ connected: false }); }
  });

  app.get("/api/wifi/scan", (_req, res) => {
    if (!nmcliAvailable()) return res.json({ networks: [] });
    try {
      const out = execSync("nmcli -t -f ACTIVE,SSID,SIGNAL,SECURITY,FREQ dev wifi list --rescan yes 2>/dev/null", { timeout: 20000 }).toString().trim();
      const seen = new Set<string>();
      const networks = out.split("\n").map(line => {
        const p = line.split(":");
        return { active: p[0] === "yes", ssid: p[1] || "", signal: parseInt(p[2]) || 0, security: p[3] || "--", freq: p[4] || "" };
      }).filter(n => {
        if (!n.ssid || seen.has(n.ssid)) return false;
        seen.add(n.ssid); return true;
      }).sort((a, b) => b.signal - a.signal);
      res.json({ networks });
    } catch { res.json({ networks: [] }); }
  });

  app.get("/api/wifi/saved", (_req, res) => {
    if (!nmcliAvailable()) return res.json({ networks: [] });
    try {
      const out = execSync("nmcli -t -f NAME,TYPE connection show 2>/dev/null", { timeout: 5000 }).toString().trim();
      const networks = out.split("\n")
        .map(line => { const p = line.split(":"); return { name: p[0], type: p[1] || "" }; })
        .filter(n => n.type === "802-11-wireless" && n.name);
      res.json({ networks });
    } catch { res.json({ networks: [] }); }
  });

  app.post("/api/wifi/connect", (req, res) => {
    const { ssid, wifiPassword, password } = req.body || {};
    if (!password || password !== getSystemPassword()) return res.status(401).json({ message: "Contraseña incorrecta" });
    if (!ssid) return res.status(400).json({ message: "SSID requerido" });
    if (!nmcliAvailable()) return res.status(503).json({ message: "nmcli no disponible (modo demo)" });
    try {
      const safeSsid = ssid.replace(/"/g, '\\"');
      const cmd = wifiPassword
        ? `sudo nmcli dev wifi connect "${safeSsid}" password "${wifiPassword.replace(/"/g, '\\"')}" ifname wlan0`
        : `sudo nmcli dev wifi connect "${safeSsid}" ifname wlan0`;
      execSync(cmd, { timeout: 30000 });
      res.json({ ok: true, message: `Conectado a ${ssid}` });
    } catch (e: any) {
      const msg = e?.stderr?.toString() || e?.stdout?.toString() || "Error al conectar";
      res.status(500).json({ ok: false, message: msg.split("\n")[0] });
    }
  });

  app.post("/api/wifi/disconnect", (req, res) => {
    const { password } = req.body || {};
    if (!password || password !== getSystemPassword()) return res.status(401).json({ message: "Contraseña incorrecta" });
    if (!nmcliAvailable()) return res.status(503).json({ message: "nmcli no disponible (modo demo)" });
    try {
      execSync("sudo nmcli device disconnect wlan0", { timeout: 10000 });
      res.json({ ok: true, message: "Desconectado del WiFi" });
    } catch (e: any) {
      res.status(500).json({ ok: false, message: "Error al desconectar" });
    }
  });

  app.post("/api/wifi/forget", (req, res) => {
    const { name, password } = req.body || {};
    if (!password || password !== getSystemPassword()) return res.status(401).json({ message: "Contraseña incorrecta" });
    if (!name) return res.status(400).json({ message: "Nombre requerido" });
    if (!nmcliAvailable()) return res.status(503).json({ message: "nmcli no disponible (modo demo)" });
    try {
      const safeName = name.replace(/"/g, '\\"');
      execSync(`sudo nmcli connection delete id "${safeName}"`, { timeout: 10000 });
      res.json({ ok: true, message: `Red '${name}' olvidada` });
    } catch (e: any) {
      res.status(500).json({ ok: false, message: "Error al olvidar red" });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────

  app.get('/api/system/read-config', (req, res) => {
    const configPath = typeof req.query.path === 'string' ? req.query.path : '';
    if (!configPath) return res.status(400).json({ message: 'Ruta no especificada' });
    if (!fs.existsSync(configPath)) return res.status(404).json({ message: `Archivo no encontrado: ${configPath}` });

    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const lines = content.split('\n');

      let currentSection = '';
      let inCommentedBrew = false;
      let inCommentedSecurity = false;
      let brewCommented = false; // true if [brew] header is commented out
      let brewActive = false;    // true if [brew] header is active
      let securityActive = false; // true if [security] header is active
      let ctActive = false;      // true if any CT key appears as active (not commented) under [cell_info]
      const sections: Record<string, Record<string, string>> = {};

      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;

        // Detect #[brew] (disabled brew section header)
        if (line.match(/^#\s*\[brew\]/)) {
          inCommentedBrew = true;
          inCommentedSecurity = false;
          brewCommented = true;
          sections['brew'] = sections['brew'] || {};
          continue;
        }
        // Detect #[security] (disabled security section header)
        if (line.match(/^#\s*\[security\]/)) {
          inCommentedSecurity = true;
          inCommentedBrew = false;
          sections['security'] = sections['security'] || {};
          continue;
        }

        if (line.startsWith('#')) {
          // Read commented key=value lines inside a commented [brew] section
          if (inCommentedBrew) {
            const ckv = line.match(/^#\s*([\w]+)\s*=\s*(.+)/);
            if (ckv) sections['brew'][ckv[1].trim()] = ckv[2].trim();
          }
          if (inCommentedSecurity) {
            const ckv = line.match(/^#\s*([\w]+)\s*=\s*(.+)/);
            if (ckv) sections['security'][ckv[1].trim()] = ckv[2].trim();
          }
          // Parse commented timezone in [cell_info] so it loads even when disabled
          if (currentSection === 'cell_info' && !sections['cell_info']?.['timezone']) {
            const tzM = line.match(/^#\s*timezone\s*=\s*"(.*)"/);
            if (tzM) {
              sections['cell_info'] = sections['cell_info'] || {};
              sections['cell_info']['timezone'] = `"${tzM[1]}"`;
            }
          }
          // Parse commented call timing fields in [cell_info] so they load even when disabled
          if (currentSection === 'cell_info') {
            const ctM = line.match(/^#\s*(hangtime_secs|call_timeout_secs|ul_inactivity_secs)\s*=\s*([0-9]+)/);
            if (ctM && !sections['cell_info']?.[ctM[1]]) {
              sections['cell_info'] = sections['cell_info'] || {};
              sections['cell_info'][ctM[1]] = ctM[2];
            }
          }
          continue;
        }

        // Active section header resets commented-section tracking.
        // Use STRICT regex so multi-line array continuations like `[0, 7],`
        // are NOT mistaken for section headers.
        const sectionMatch = line.match(/^\[([a-zA-Z_][\w.]*)\]\s*$/);
        if (sectionMatch) {
          inCommentedBrew = false;
          inCommentedSecurity = false;
          currentSection = sectionMatch[1];
          if (currentSection === 'brew') brewActive = true;
          if (currentSection === 'security') securityActive = true;
          sections[currentSection] = sections[currentSection] || {};
          continue;
        }
        // [[sub-table]] headers — stay in parent section context
        if (/^\[\[[\w.]+\]\]\s*$/.test(line)) {
          inCommentedBrew = false;
          inCommentedSecurity = false;
          continue;
        }
        const kvMatch = line.match(/^([a-zA-Z0-9_.]+)\s*=\s*(.+)/);
        if (kvMatch && currentSection) {
          const kk = kvMatch[1].trim();
          sections[currentSection][kk] = kvMatch[2].trim();
          // Track active (non-commented) call timing keys under [cell_info]
          if (currentSection === 'cell_info' && (kk === 'hangtime_secs' || kk === 'call_timeout_secs' || kk === 'ul_inactivity_secs')) {
            ctActive = true;
          }
        }
      }

      const get = (sec: string, key: string) => sections[sec]?.[key] ?? null;
      const num = (sec: string, key: string) => { const v = get(sec, key); return v !== null ? parseFloat(v) : null; };
      const bool = (sec: string, key: string) => { const v = get(sec, key); return v === 'true' ? true : v === 'false' ? false : null; };
      const str = (sec: string, key: string) => { const v = get(sec, key); return v !== null ? v.replace(/^"|"$/g, '') : null; };

      // Parse local_ssi_ranges: handles single-line, multi-line, and #commented formats
      let ssiRanges: Array<{start: number; end: number}> = [];
      let ssiRangesEnabled = false;
      {
        let inSsiBlock = false;
        let ssiBlockCommented = false;
        let ssiRawAccum = "";
        let ssiInCellInfo = false;
        let ssiDone = false;
        for (const rawLine of lines) {
          if (ssiDone) break;
          const t = rawLine.trim();
          // Only detect section headers when NOT inside a multi-line value block.
          // Without this guard, lines like "[0, 7]," inside local_ssi_ranges
          // would be mistakenly parsed as TOML section headers.
          if (!inSsiBlock) {
            if (/^\[\[[\w.]+\]\]\s*$/.test(t)) continue;
            const secM = t.match(/^\[([a-zA-Z_][\w.]*)\]\s*$/);
            if (secM) { ssiInCellInfo = secM[1] === "cell_info"; continue; }
            if (!ssiInCellInfo) continue;
            const activeM = t.match(/^local_ssi_ranges\s*=\s*(.*)/);
            const commentedM = t.match(/^#\s*local_ssi_ranges\s*=\s*(.*)/);
            if (activeM) {
              ssiRangesEnabled = true; ssiBlockCommented = false;
              const rest = activeM[1].trim();
              if (rest.endsWith("]")) { ssiRawAccum = rest; ssiDone = true; }
              else { ssiRawAccum = rest; inSsiBlock = true; }
            } else if (commentedM) {
              ssiRangesEnabled = false; ssiBlockCommented = true;
              ssiRawAccum = commentedM[1].trim();
              inSsiBlock = true;
            }
          } else {
            const stripped = ssiBlockCommented ? t.replace(/^#\s*/, "") : t;
            ssiRawAccum += stripped;
            if (stripped.trim() === "]") ssiDone = true;
          }
        }
        const ssiMatches = [...ssiRawAccum.matchAll(/\[\s*(\d+)\s*,\s*(\d+)\s*\]/g)];
        ssiRanges = ssiMatches.map(m => ({ start: parseInt(m[1]), end: parseInt(m[2]) }));
      }

      // Parse [[cell_info.neighbor_cells_ca]] blocks (active and commented)
      let neighborCells: Array<Record<string, any>> = [];
      let neighborCellsActive = false;
      {
        let inBlock = false;
        let blockCommented = false;
        let curCell: Record<string, any> = {};
        const flush = () => {
          if (Object.keys(curCell).length > 0) neighborCells.push(curCell);
          curCell = {};
        };
        for (const raw of lines) {
          const t = raw.trim();
          if (!t) continue;

          if (t.match(/^\[\[\s*cell_info\.neighbor_cells_ca\s*\]\]/)) {
            flush(); inBlock = true; blockCommented = false; neighborCellsActive = true; continue;
          }
          if (t.match(/^#\s*\[\[\s*cell_info\.neighbor_cells_ca\s*\]\]/)) {
            flush(); inBlock = true; blockCommented = true; continue;
          }
          // Any other section header ends the block
          if (t.match(/^\[/) || t.match(/^#\s*\[/)) {
            flush(); inBlock = false; continue;
          }
          if (!inBlock) continue;

          const stripped = blockCommented ? t.replace(/^#\s*/, "") : t;
          if (!stripped) continue;
          const kvM = stripped.match(/^([\w]+)\s*=\s*(.+)/);
          if (kvM) {
            const k = kvM[1];
            const v = kvM[2].trim();
            if (v === "true") curCell[k] = true;
            else if (v === "false") curCell[k] = false;
            else {
              const n = parseFloat(v);
              curCell[k] = isNaN(n) ? v.replace(/^"|"$/g, "") : n;
            }
          }
        }
        flush();
      }

      // Parse whitelisted_ssis: [id, id, ...]
      let whitelistedSsis: number[] = [];
      const rawWl = get('brew', 'whitelisted_ssis');
      if (rawWl) {
        const nums = rawWl.replace(/[\[\]]/g, '').split(',').map((s: string) => parseInt(s.trim())).filter((n: number) => !isNaN(n));
        whitelistedSsis = nums;
      }

      // Parse security issi_whitelist: [id, id, ...]
      let securityIssiWhitelist: number[] = [];
      const rawSec = get('security', 'issi_whitelist');
      if (rawSec) {
        const nums = rawSec.replace(/[\[\]]/g, '').split(',').map((s: string) => parseInt(s.trim())).filter((n: number) => !isNaN(n));
        securityIssiWhitelist = nums;
      }

      res.json({
        _raw: content,
        phy_io_soapysdr: {
          tx_freq: num('phy_io.soapysdr', 'tx_freq'),
          rx_freq: num('phy_io.soapysdr', 'rx_freq'),
        },
        cell_info: {
          freq_band: num('cell_info', 'freq_band'),
          main_carrier: num('cell_info', 'main_carrier'),
          duplex_spacing: num('cell_info', 'duplex_spacing'),
          custom_duplex_spacing: num('cell_info', 'custom_duplex_spacing'),
          freq_offset: num('cell_info', 'freq_offset'),
          reverse_operation: bool('cell_info', 'reverse_operation'),
          location_area: num('cell_info', 'location_area'),
          colour_code: num('cell_info', 'colour_code'),
          system_code: num('cell_info', 'system_code'),
          timezone_broadcast: bool('cell_info', 'timezone_broadcast'),
          timezone: str('cell_info', 'timezone'),
          local_ssi_ranges: ssiRanges,
          ssi_ranges_enabled: ssiRangesEnabled,
          neighbor_cells: neighborCells,
          neighbor_cells_enabled: neighborCellsActive,
          call_timing: {
            // Enabled = at least one of the 3 keys appears as an ACTIVE assignment under [cell_info].
            // Scan lines directly to distinguish active from commented (commented values are
            // also stored in `sections` so we can populate the form even when disabled).
            enabled: ctActive,
            hangtime_secs: num('cell_info', 'hangtime_secs'),
            call_timeout_secs: num('cell_info', 'call_timeout_secs'),
            ul_inactivity_secs: num('cell_info', 'ul_inactivity_secs'),
          },
        },
        net_info: {
          mcc: num('net_info', 'mcc'),
          mnc: num('net_info', 'mnc'),
        },
        brew: {
          enabled: brewActive,
          host: str('brew', 'host'),
          port: num('brew', 'port'),
          username: str('brew', 'username'),
          password: str('brew', 'password'),
          tls: bool('brew', 'tls'),
          reconnect_delay_secs: num('brew', 'reconnect_delay_secs'),
          whitelisted_ssis: whitelistedSsis,
        },
        security: {
          enabled: securityActive,
          issi_whitelist: securityIssiWhitelist,
        },
      });
    } catch (err: any) {
      res.status(500).json({ message: `Error leyendo config: ${err.message}` });
    }
  });

  app.post(api.system.applyConfig.path, (req, res) => {
    const { password, configPath, serviceName, values, netInfoConfig, cellInfoExtra, ssiRangesConfig, timezoneConfig, callTimingConfig, brewConfig, securityConfig, neighborCellsConfig } = req.body || {};
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

      // cell_info extra fields (optional — only update if provided)
      if (cellInfoExtra) {
        if (cellInfoExtra.location_area !== null && cellInfoExtra.location_area !== undefined) {
          sectionUpdates["cell_info"]["location_area"] = String(cellInfoExtra.location_area);
        }
        if (cellInfoExtra.colour_code !== null && cellInfoExtra.colour_code !== undefined) {
          sectionUpdates["cell_info"]["colour_code"] = String(cellInfoExtra.colour_code);
        }
        if (cellInfoExtra.system_code !== null && cellInfoExtra.system_code !== undefined) {
          sectionUpdates["cell_info"]["system_code"] = String(cellInfoExtra.system_code);
        }
      }

      // net_info section
      const netInfoUpdates: Record<string, string> = {};
      if (netInfoConfig) {
        if (netInfoConfig.mcc !== null && netInfoConfig.mcc !== undefined) netInfoUpdates["mcc"] = String(netInfoConfig.mcc);
        if (netInfoConfig.mnc !== null && netInfoConfig.mnc !== undefined) netInfoUpdates["mnc"] = String(netInfoConfig.mnc);
      }

      // SSI ranges (ranges always sent from form, even when disabled)
      const ssiEnabled = ssiRangesConfig?.enabled === true;
      const ssiRanges: Array<[number, number]> = Array.isArray(ssiRangesConfig?.ranges) ? ssiRangesConfig.ranges : [];

      if (values.custom_duplex_spacing !== null && values.custom_duplex_spacing !== undefined && values.duplex_spacing === 7) {
        sectionUpdates["cell_info"]["custom_duplex_spacing"] = String(values.custom_duplex_spacing);
      }

      // Timezone broadcast (goes under [cell_info])
      const tzEnabled = timezoneConfig?.enabled === true;
      const tzValue = timezoneConfig?.timezone || "";
      if (tzEnabled && tzValue) {
        sectionUpdates["cell_info"]["timezone_broadcast"] = "true";
      } else {
        sectionUpdates["cell_info"]["timezone_broadcast"] = "__REMOVE__";
      }
      // timezone key itself is handled by targeted pass below (active or commented)

      // Call Timing — 3 fields under [cell_info]. Active or commented depending on toggle.
      const ctEnabled = callTimingConfig?.enabled === true;
      const clampInt = (v: any, lo: number, hi: number, def: number): number => {
        const n = Number(v); if (!Number.isFinite(n)) return def;
        return Math.max(lo, Math.min(hi, Math.round(n)));
      };
      const ctVals: Record<string, number> = {
        hangtime_secs: clampInt(callTimingConfig?.hangtime_secs, 0, 300, 5),
        call_timeout_secs: clampInt(callTimingConfig?.call_timeout_secs, 0, 600, 120),
        ul_inactivity_secs: clampInt(callTimingConfig?.ul_inactivity_secs, 1, 30, 3),
      };
      const ctKeys = Object.keys(ctVals);
      const ctFound: Record<string, boolean> = { hangtime_secs: false, call_timeout_secs: false, ul_inactivity_secs: false };

      const hasCustomDuplex = !!(sectionUpdates["cell_info"]["custom_duplex_spacing"]);

      // Build brew section update map
      const brewEnabled = brewConfig?.enabled === true;
      const whitelistEnabled = brewEnabled && brewConfig.whitelistEnabled === true;
      const tlsValue = brewConfig?.tls === true ? "true" : "false"; // always available
      const brewUpdates: Record<string, string> = {};
      if (brewEnabled) {
        brewUpdates["host"] = `"${brewConfig.host || ""}"`;
        brewUpdates["port"] = String(brewConfig.port || 62031);
        brewUpdates["username"] = `${brewConfig.username || ""}`;
        brewUpdates["password"] = `"${brewConfig.password || ""}"`;
        brewUpdates["tls"] = tlsValue;
        brewUpdates["reconnect_delay_secs"] = String(brewConfig.reconnect_delay_secs || 15);
        if (whitelistEnabled && Array.isArray(brewConfig.whitelisted_ssis) && brewConfig.whitelisted_ssis.length > 0) {
          brewUpdates["whitelisted_ssis"] = `[${brewConfig.whitelisted_ssis.join(", ")}]`;
        }
      }

      const lines = content.split("\n");
      let currentSection = "";
      let customDuplexFound = false;
      let tzBroadcastFound = false;
      let tzFound = false;
      const netInfoKeyFound: Record<string, boolean> = {};
      let netInfoSectionExists = false;

      for (let i = 0; i < lines.length; i++) {
        // Match ONLY real section headers: [identifier] alone on its line.
        // This avoids matching multi-line array continuations like `[0, 7],`
        // inside `local_ssi_ranges = [ ... ]`.
        const sectionMatch = lines[i].match(/^\s*\[([a-zA-Z_][\w.]*)\]\s*$/);
        if (sectionMatch) {
          currentSection = sectionMatch[1].trim();
          if (currentSection === "net_info") netInfoSectionExists = true;
          continue;
        }
        // [[sub-table]] headers — skip without changing currentSection
        if (/^\s*\[\[[\w.]+\]\]\s*$/.test(lines[i])) continue;

        if (currentSection === "cell_info") {
          // Handle commented # <call_timing_key> = N lines (active or commented depending on toggle)
          const commentedCtMatch = lines[i].match(/^(\s*)#\s*(hangtime_secs|call_timeout_secs|ul_inactivity_secs)\s*=\s*([0-9]+)/);
          if (commentedCtMatch) {
            const k = commentedCtMatch[2];
            // Duplicate: a previous occurrence already handled this key → remove this line
            if (ctFound[k]) { lines.splice(i, 1); i--; continue; }
            const v = ctVals[k];
            lines[i] = ctEnabled
              ? `${commentedCtMatch[1]}${k} = ${v}`
              : `${commentedCtMatch[1]}# ${k} = ${v}`;
            ctFound[k] = true;
            continue;
          }
          // Handle commented # timezone = "..." line
          const commentedTzMatch = lines[i].match(/^(\s*)#\s*timezone\s*=\s*"(.*)"/);
          if (commentedTzMatch) {
            if (tzEnabled && tzValue) {
              lines[i] = `${commentedTzMatch[1]}timezone = "${tzValue}"`;
              tzFound = true;
            } else if (tzValue) {
              lines[i] = `${commentedTzMatch[1]}# timezone = "${tzValue}"`;
              tzFound = true;
            } else {
              lines.splice(i, 1); i--;
            }
            continue;
          }

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
              if (tzEnabled && tzValue) {
                lines[i] = `${keyMatch[1]}timezone${keyMatch[3]}"${tzValue}"`;
                tzFound = true;
              } else if (tzValue) {
                lines[i] = `# timezone = "${tzValue}"`;
                tzFound = true;
              } else {
                lines.splice(i, 1); i--;
              }
              continue;
            }
            if (ctKeys.includes(k)) {
              // Duplicate: a previous occurrence already handled this key → remove this line
              if (ctFound[k]) { lines.splice(i, 1); i--; continue; }
              const v = ctVals[k];
              lines[i] = ctEnabled
                ? `${keyMatch[1]}${k}${keyMatch[3]}${v}`
                : `${keyMatch[1]}# ${k} = ${v}`;
              ctFound[k] = true;
              continue;
            }
          }
        }

        if (currentSection === "net_info" && Object.keys(netInfoUpdates).length > 0) {
          const keyMatch = lines[i].match(/^(\s*)([\w]+)(\s*=\s*)(.*)/);
          if (keyMatch) {
            const k = keyMatch[2];
            if (netInfoUpdates[k] !== undefined) {
              lines[i] = `${keyMatch[1]}${k}${keyMatch[3]}${netInfoUpdates[k]}`;
              netInfoKeyFound[k] = true;
            }
          }
        }

        if (sectionUpdates[currentSection]) {
          const keyMatch = lines[i].match(/^(\s*)([\w]+)(\s*=\s*)(.*)/);
          if (keyMatch) {
            const keyName = keyMatch[2];
            const val = sectionUpdates[currentSection][keyName];
            if (val !== undefined && val !== "__REMOVE__") {
              if (!["custom_duplex_spacing","timezone_broadcast","timezone","hangtime_secs","call_timeout_secs","ul_inactivity_secs"].includes(keyName)) {
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
      if (tzValue || tzEnabled) {
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].match(/^\s*\[cell_info\]/)) {
            let insertAt = i + 1;
            while (insertAt < lines.length && !lines[insertAt].match(/^\s*\[/) && lines[insertAt].trim() !== "") insertAt++;
            if (!tzFound && tzValue) {
              lines.splice(insertAt, 0, tzEnabled ? `timezone = "${tzValue}"` : `# timezone = "${tzValue}"`);
            }
            if (!tzBroadcastFound && tzEnabled) lines.splice(insertAt, 0, `timezone_broadcast = true`);
            break;
          }
        }
      }

      // Insert any missing Call Timing keys at the END of [cell_info] direct fields
      // (after all existing keys/comments, before the next section header [..] or sub-table [[..]],
      // and before any local_ssi_ranges = [...] multi-line array). Walk back over trailing blank
      // lines so the new keys sit flush against the last meaningful line.
      {
        const missing = ctKeys.filter(k => !ctFound[k]);
        if (missing.length > 0) {
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].match(/^\s*\[cell_info\]\s*$/)) {
              let insertAt = i + 1;
              let inArray = 0; // bracket depth for multi-line values like local_ssi_ranges
              while (insertAt < lines.length) {
                const t = lines[insertAt];
                if (inArray === 0 && t.match(/^\s*\[/)) break; // next [section] or [[sub.table]]
                // Track bracket depth so multi-line arrays don't end the region prematurely
                for (const ch of t) { if (ch === '[') inArray++; else if (ch === ']') inArray--; }
                insertAt++;
              }
              // Trim trailing blank lines so insertion sits after last meaningful content
              while (insertAt > i + 1 && lines[insertAt - 1].trim() === "") insertAt--;
              for (const k of missing) {
                const v = ctVals[k];
                lines.splice(insertAt, 0, ctEnabled ? `${k} = ${v}` : `# ${k} = ${v}`);
                insertAt++;
              }
              break;
            }
          }
        }
      }

      // SSI ranges: find existing block (single-line, multi-line active, or commented), replace with correct format
      {
        let ssiBlockStart = -1;
        let ssiBlockEnd = -1;
        let ssiSec = "";
        for (let i = 0; i < lines.length; i++) {
          const t = lines[i].trim();
          if (/^\[\[[\w.]+\]\]\s*$/.test(t)) continue;
          const secM = t.match(/^\[([a-zA-Z_][\w.]*)\]\s*$/);
          if (secM) { ssiSec = secM[1]; continue; }
          if (ssiSec !== "cell_info") continue;
          const isActive = t.match(/^local_ssi_ranges\s*=/);
          const isCommented = t.match(/^#\s*local_ssi_ranges\s*=/);
          if (isActive || isCommented) {
            ssiBlockStart = i;
            const rest = t.replace(/^#?\s*local_ssi_ranges\s*=\s*/, "").trim();
            if (rest.endsWith("]")) { ssiBlockEnd = i; break; }
            for (let j = i + 1; j < lines.length; j++) {
              const tj = lines[j].trim();
              if (tj === "]" || tj === "#]" || tj.match(/^#\s*\]$/)) { ssiBlockEnd = j; break; }
              if (tj.match(/^\[[a-zA-Z0-9_.]+\]/) && !tj.startsWith("#")) break;
            }
            break;
          }
        }

        // Build new multi-line SSI block
        const newSsiLines: string[] = [];
        if (ssiRanges.length > 0) {
          if (ssiEnabled) {
            newSsiLines.push("local_ssi_ranges = [");
            for (const r of ssiRanges) newSsiLines.push(`[${r[0]}, ${r[1]}],`);
            newSsiLines.push("]");
          } else {
            newSsiLines.push("#local_ssi_ranges = [");
            for (const r of ssiRanges) newSsiLines.push(`#[${r[0]}, ${r[1]}],`);
            newSsiLines.push("#]");
          }
        }

        if (ssiBlockStart !== -1) {
          const deleteCount = ssiBlockEnd !== -1 ? ssiBlockEnd - ssiBlockStart + 1 : 1;
          lines.splice(ssiBlockStart, deleteCount, ...newSsiLines);
        } else if (newSsiLines.length > 0) {
          // Not found in file: insert at end of [cell_info] section
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].match(/^\s*\[cell_info\]/)) {
              let insertAt = i + 1;
              while (insertAt < lines.length && !lines[insertAt].match(/^\s*\[/) && lines[insertAt].trim() !== "") insertAt++;
              lines.splice(insertAt, 0, ...newSsiLines);
              break;
            }
          }
        }
      }

      // Handle [net_info] section
      if (Object.keys(netInfoUpdates).length > 0) {
        if (!netInfoSectionExists) {
          // Append new [net_info] section before [cell_info] if possible, else at end before [brew]
          let insertIdx = lines.length;
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].match(/^\s*\[cell_info\]/)) { insertIdx = i; break; }
          }
          lines.splice(insertIdx, 0, "");
          lines.splice(insertIdx + 1, 0, "[net_info]");
          let off = 2;
          for (const [k, v] of Object.entries(netInfoUpdates)) {
            lines.splice(insertIdx + off, 0, `${k} = ${v}`);
            off++;
          }
          lines.splice(insertIdx + off, 0, "");
        } else {
          // Insert missing keys into existing [net_info] section
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].match(/^\s*\[net_info\]/)) {
              let insertAt = i + 1;
              while (insertAt < lines.length && !lines[insertAt].match(/^\s*\[/) && lines[insertAt].trim() !== "") {
                insertAt++;
              }
              for (const [k, v] of Object.entries(netInfoUpdates)) {
                if (!netInfoKeyFound[k]) {
                  lines.splice(insertAt, 0, `${k} = ${v}`);
                  insertAt++;
                }
              }
              break;
            }
          }
        }
      }

      // ── NEIGHBOR CELLS: replace all [[cell_info.neighbor_cells_ca]] blocks ──
      {
        const ncEnabled = neighborCellsConfig?.enabled === true;
        const cells: any[] = Array.isArray(neighborCellsConfig?.cells) ? neighborCellsConfig.cells : [];

        // 1) Remove all existing neighbor_cells_ca blocks (active and commented).
        //    Block = header line + following key=value lines (active or commented)
        //    until the next section/sub-table header.
        for (let i = 0; i < lines.length; ) {
          const t = lines[i].trim();
          const isHdr = !!t.match(/^\[\[\s*cell_info\.neighbor_cells_ca\s*\]\]/) ||
                        !!t.match(/^#\s*\[\[\s*cell_info\.neighbor_cells_ca\s*\]\]/);
          if (!isHdr) { i++; continue; }
          let j = i + 1;
          while (j < lines.length) {
            const tj = lines[j].trim();
            if (tj === "") { j++; continue; }
            if (tj.match(/^\[/) || tj.match(/^#\s*\[/)) break;
            j++;
          }
          // Trim trailing blank lines we'd otherwise leave behind
          while (j > i + 1 && lines[j - 1].trim() === "") j--;
          // Also drop one leading blank line right before the block (if any)
          let start = i;
          if (start > 0 && lines[start - 1].trim() === "") start = start - 1;
          lines.splice(start, j - start);
          i = start;
        }

        // 2) Build new blocks (always emitted if cells provided — commented when disabled)
        if (cells.length > 0) {
          const newBlock: string[] = [];
          cells.forEach((c, idx) => {
            const prefix = ncEnabled ? "" : "# ";
            newBlock.push("");
            newBlock.push(`${prefix}[[cell_info.neighbor_cells_ca]]`);
            newBlock.push(`${prefix}cell_identifier_ca = ${Number(c.cell_identifier_ca ?? (idx + 1))}`);
            newBlock.push(`${prefix}cell_reselection_types_supported = ${Number(c.cell_reselection_types_supported ?? 0)}`);
            newBlock.push(`${prefix}neighbor_cell_synchronized = ${c.neighbor_cell_synchronized === true ? "true" : "false"}`);
            newBlock.push(`${prefix}cell_load_ca = ${Number(c.cell_load_ca ?? 0)}`);
            newBlock.push(`${prefix}main_carrier_number = ${Number(c.main_carrier_number ?? 0)}`);
            newBlock.push(`${prefix}mcc = ${Number(c.mcc ?? 0)}`);
            newBlock.push(`${prefix}mnc = ${Number(c.mnc ?? 0)}`);
            newBlock.push(`${prefix}location_area = ${Number(c.location_area ?? 0)}`);
          });

          // 3) Insert at end of [cell_info] direct fields (before any next section header,
          //    active or commented, including [[..]] sub-tables and [other])
          let cellInfoIdx = -1;
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].match(/^\s*\[cell_info\]/)) { cellInfoIdx = i; break; }
          }
          if (cellInfoIdx === -1) {
            if (lines.length > 0 && lines[lines.length - 1].trim() !== "") lines.push("");
            lines.push(...newBlock);
          } else {
            let insertAt = cellInfoIdx + 1;
            // Track multi-line arrays (e.g. `local_ssi_ranges = [` ... `]`) — both active and #commented —
            // so a continuation line like `[0, 7],` is NOT treated as a new section header.
            let inArray = 0;
            const stripComment = (s: string) => s.replace(/^#\s*/, "");
            while (insertAt < lines.length) {
              const raw = lines[insertAt];
              const tj = raw.trim();
              const body = stripComment(tj);
              if (inArray === 0) {
                if (tj.match(/^\[/) || tj.match(/^#\s*\[/)) break;
                // Detect opening of a multi-line array: `key = [...` with unbalanced brackets on this line
                const eq = body.match(/^[A-Za-z_][\w.]*\s*=\s*(.*)$/);
                if (eq) {
                  const opens = (eq[1].match(/\[/g) || []).length;
                  const closes = (eq[1].match(/\]/g) || []).length;
                  if (opens > closes) inArray += (opens - closes);
                }
              } else {
                const opens = (body.match(/\[/g) || []).length;
                const closes = (body.match(/\]/g) || []).length;
                inArray += opens - closes;
                if (inArray < 0) inArray = 0;
              }
              insertAt++;
            }
            // Step back over trailing blank lines so block sits right after content
            while (insertAt > cellInfoIdx + 1 && lines[insertAt - 1].trim() === "") insertAt--;
            lines.splice(insertAt, 0, ...newBlock);
          }
        }
      }

      // ── BREW SECTION: comment/uncomment instead of remove/insert ──
      // Locate brew section header (active [brew] or commented #[brew])
      let brewHeaderIdx = -1;
      let brewIsActive = false;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].match(/^\s*\[brew\]/)) { brewHeaderIdx = i; brewIsActive = true; break; }
        if (lines[i].match(/^\s*#\s*\[brew\]/)) { brewHeaderIdx = i; brewIsActive = false; break; }
      }
      // Find end of brew section (next section header — active OR commented)
      const getBrewEnd = (start: number): number => {
        for (let j = start + 1; j < lines.length; j++) {
          if (lines[j].match(/^\s*\[[^\]]+\]/)) return j;
          if (lines[j].match(/^\s*#\s*\[[^\]]+\]/)) return j;
        }
        return lines.length;
      };

      if (brewEnabled) {
        if (brewHeaderIdx === -1) {
          // No brew section at all → append fresh block
          lines.push("");
          lines.push("[brew]");
          for (const [k, v] of Object.entries(brewUpdates)) {
            lines.push(`${k} = ${v}`);
          }
        } else {
          // Uncomment header if needed
          if (!brewIsActive) lines[brewHeaderIdx] = "[brew]";
          const brewEnd = getBrewEnd(brewHeaderIdx);
          const found: Record<string, boolean> = {};
          for (let i = brewHeaderIdx + 1; i < brewEnd; i++) {
            const line = lines[i];
            // Match commented key=value: #key = value  (not pure comment lines like # text)
            const commentedKV = line.match(/^\s*#\s*([\w]+)\s*=\s*(.*)/);
            if (commentedKV) {
              const k = commentedKV[1];
              if (k === 'whitelisted_ssis' && !whitelistEnabled) {
                // Keep commented — whitelist disabled
              } else if (brewUpdates[k] !== undefined) {
                lines[i] = `${k} = ${brewUpdates[k]}`; // uncomment + update value
                found[k] = true;
              } else {
                lines[i] = line.replace(/^(\s*)#\s*/, '$1'); // just uncomment
              }
              continue;
            }
            // Match active key=value
            const activeKV = line.match(/^(\s*)([\w]+)(\s*=\s*)(.*)/);
            if (activeKV) {
              const k = activeKV[2];
              if (brewUpdates[k] !== undefined) {
                lines[i] = `${activeKV[1]}${k}${activeKV[3]}${brewUpdates[k]}`;
                found[k] = true;
              } else if (k === 'whitelisted_ssis' && !whitelistEnabled) {
                // Whitelist disabled → comment out this active line
                lines[i] = `#${line}`;
              }
            }
          }
          // Append any keys not present in the existing section
          let insertAt = getBrewEnd(brewHeaderIdx);
          for (const [k, v] of Object.entries(brewUpdates)) {
            if (!found[k]) { lines.splice(insertAt, 0, `${k} = ${v}`); insertAt++; }
          }
        }
      } else {
        // Brew disabled: comment out instead of removing
        if (brewHeaderIdx !== -1 && brewIsActive) {
          lines[brewHeaderIdx] = "#[brew]";
          const brewEnd = getBrewEnd(brewHeaderIdx);
          for (let i = brewHeaderIdx + 1; i < brewEnd; i++) {
            const line = lines[i];
            // Skip empty lines and already-commented lines
            if (!line.trim() || line.trim().startsWith('#')) continue;
            if (line.match(/^\s*[\w][\w]*\s*=/)) {
              lines[i] = `#${line}`;
            }
          }
        }
        // If already commented: keep tls value updated but commented
        if (brewHeaderIdx !== -1 && !brewIsActive) {
          const brewEnd = getBrewEnd(brewHeaderIdx);
          for (let i = brewHeaderIdx + 1; i < brewEnd; i++) {
            // Match both active (tls = ...) and already-commented (#tls = ...) forms
            if (lines[i].match(/^\s*#?\s*tls\s*=/)) {
              lines[i] = `#tls = ${tlsValue}`;
              break;
            }
          }
        }
      }

      // ── SECURITY SECTION: comment/uncomment block (header + issi_whitelist) ──
      {
        const secEnabled = securityConfig?.enabled === true;
        const rawList: string[] = Array.isArray(securityConfig?.issi_whitelist)
          ? securityConfig.issi_whitelist.map((x: any) => String(x).trim()).filter(Boolean)
          : [];
        const ssiList = rawList.length > 0 ? rawList : ["1030299", "1030036", "2145007"];
        const issiLine = `issi_whitelist = [${ssiList.join(", ")}]`;

        // Locate active [security] or commented #[security] header
        let secHeaderIdx = -1;
        let secIsActive = false;
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].match(/^\s*\[security\]/)) { secHeaderIdx = i; secIsActive = true; break; }
          if (lines[i].match(/^\s*#\s*\[security\]/)) { secHeaderIdx = i; secIsActive = false; break; }
        }
        // Section ends at the next section header — active OR commented (`#[xxx]` / `# [xxx]`)
        const getSecEnd = (start: number): number => {
          for (let j = start + 1; j < lines.length; j++) {
            if (lines[j].match(/^\s*\[[^\]]+\]/)) return j;
            if (lines[j].match(/^\s*#\s*\[[^\]]+\]/)) return j;
          }
          return lines.length;
        };

        const headerLine = secEnabled ? "[security]" : "# [security]";
        const valueLine = secEnabled ? issiLine : `# ${issiLine}`;

        if (secHeaderIdx === -1) {
          // No security section at all — insert just before [brew] (active or commented).
          // Falls back to end-of-file if no [brew] header is present.
          let brewIdx = -1;
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].match(/^\s*\[brew\]/) || lines[i].match(/^\s*#\s*\[brew\]/)) {
              brewIdx = i;
              break;
            }
          }
          if (brewIdx === -1) {
            if (lines.length > 0 && lines[lines.length - 1].trim() !== "") lines.push("");
            lines.push(headerLine);
            lines.push(valueLine);
          } else {
            const block = [headerLine, valueLine, ""];
            // Ensure a blank line separates the previous content from the new block
            if (brewIdx > 0 && lines[brewIdx - 1].trim() !== "") block.unshift("");
            lines.splice(brewIdx, 0, ...block);
          }
        } else {
          lines[secHeaderIdx] = headerLine;
          // Replace any existing issi_whitelist line (active or commented) within the section
          const secEnd = getSecEnd(secHeaderIdx);
          let foundWl = false;
          for (let i = secHeaderIdx + 1; i < secEnd; i++) {
            if (lines[i].match(/^\s*#?\s*issi_whitelist\s*=/)) {
              lines[i] = valueLine;
              foundWl = true;
              break;
            }
          }
          if (!foundWl) lines.splice(secHeaderIdx + 1, 0, valueLine);
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

  const wss = new WebSocketServer({ noServer: true });
  httpServer.on("upgrade", (req, socket, head) => {
    if (req.url === "/ws" || req.url?.startsWith("/ws?")) {
      wss.handleUpgrade(req, socket as any, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    }
  });

  function broadcast(data: string) {
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  }

  const MAX_GPS_HISTORY = 200; // max track points per ISSI

  const currentState: {
    terminals: Record<string, any>;
    localHistory: any[];
    externalHistory: any[];
    sdsMessages: any[];
    gpsPositions: Record<string, any>;
    gpsHistory: Record<string, any[]>;
  } = { terminals: {}, localHistory: [], externalHistory: [], sdsMessages: [], gpsPositions: {}, gpsHistory: {} };
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
          const existingIdx = currentState.sdsMessages.findIndex((m: any) => m.id === sds.id);
          if (existingIdx >= 0) {
            currentState.sdsMessages[existingIdx] = sds;
          } else {
            currentState.sdsMessages.unshift(sds);
            if (currentState.sdsMessages.length > MAX_HISTORY)
              currentState.sdsMessages = currentState.sdsMessages.slice(0, MAX_HISTORY);
          }
          // Update GPS position tracker + history when SDS carries LIP/GPS data
          if (sds.lipData && sds.srcIssi) {
            const prev = currentState.gpsPositions[sds.srcIssi];
            const pos = {
              issi: sds.srcIssi,
              callsign: sds.srcCallsign || prev?.callsign || null,
              lat: sds.lipData.lat,
              lon: sds.lipData.lon,
              speed: sds.lipData.speed ?? null,
              heading: sds.lipData.heading ?? null,
              timestamp: new Date().toISOString(),
              hasFix: true,
            };
            currentState.gpsPositions[sds.srcIssi] = pos;
            // Append to track history (keep last MAX_GPS_HISTORY points)
            if (!currentState.gpsHistory[sds.srcIssi]) {
              currentState.gpsHistory[sds.srcIssi] = [];
            }
            currentState.gpsHistory[sds.srcIssi].push(pos);
            if (currentState.gpsHistory[sds.srcIssi].length > MAX_GPS_HISTORY) {
              currentState.gpsHistory[sds.srcIssi] = currentState.gpsHistory[sds.srcIssi].slice(-MAX_GPS_HISTORY);
            }
          }
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
        gpsPositions: currentState.gpsPositions,
        gpsHistory: currentState.gpsHistory,
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
