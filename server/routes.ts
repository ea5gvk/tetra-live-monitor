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
echo "=== npm install ==="
npm install
echo ""
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
      let brewCommented = false; // true if [brew] header is commented out
      let brewActive = false;    // true if [brew] header is active
      const sections: Record<string, Record<string, string>> = {};

      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;

        // Detect #[brew] (disabled brew section header)
        if (line.match(/^#\s*\[brew\]/)) {
          inCommentedBrew = true;
          brewCommented = true;
          sections['brew'] = sections['brew'] || {};
          continue;
        }

        if (line.startsWith('#')) {
          // Read commented key=value lines inside a commented [brew] section
          if (inCommentedBrew) {
            const ckv = line.match(/^#\s*([\w]+)\s*=\s*(.+)/);
            if (ckv) sections['brew'][ckv[1].trim()] = ckv[2].trim();
          }
          // Parse commented timezone in [cell_info] so it loads even when disabled
          if (currentSection === 'cell_info' && !sections['cell_info']?.['timezone']) {
            const tzM = line.match(/^#\s*timezone\s*=\s*"(.*)"/);
            if (tzM) {
              sections['cell_info'] = sections['cell_info'] || {};
              sections['cell_info']['timezone'] = `"${tzM[1]}"`;
            }
          }
          continue;
        }

        // Active section header resets commented-brew tracking
        inCommentedBrew = false;
        const sectionMatch = line.match(/^\[([^\]]+)\]/);
        if (sectionMatch) {
          currentSection = sectionMatch[1];
          if (currentSection === 'brew') brewActive = true;
          sections[currentSection] = sections[currentSection] || {};
          continue;
        }
        const kvMatch = line.match(/^([a-zA-Z0-9_.]+)\s*=\s*(.+)/);
        if (kvMatch && currentSection) sections[currentSection][kvMatch[1].trim()] = kvMatch[2].trim();
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
            const secM = t.match(/^\[([^\]]+)\]/);
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

      // Parse whitelisted_ssis: [id, id, ...]
      let whitelistedSsis: number[] = [];
      const rawWl = get('brew', 'whitelisted_ssis');
      if (rawWl) {
        const nums = rawWl.replace(/[\[\]]/g, '').split(',').map((s: string) => parseInt(s.trim())).filter((n: number) => !isNaN(n));
        whitelistedSsis = nums;
      }

      res.json({
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
      });
    } catch (err: any) {
      res.status(500).json({ message: `Error leyendo config: ${err.message}` });
    }
  });

  app.post(api.system.applyConfig.path, (req, res) => {
    const { password, configPath, serviceName, values, netInfoConfig, cellInfoExtra, ssiRangesConfig, timezoneConfig, brewConfig } = req.body || {};
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
        const sectionMatch = lines[i].match(/^\s*\[([^\]]+)\]/);
        if (sectionMatch) {
          currentSection = sectionMatch[1].trim();
          if (currentSection === "net_info") netInfoSectionExists = true;
          continue;
        }

        if (currentSection === "cell_info") {
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

      // SSI ranges: find existing block (single-line, multi-line active, or commented), replace with correct format
      {
        let ssiBlockStart = -1;
        let ssiBlockEnd = -1;
        let ssiSec = "";
        for (let i = 0; i < lines.length; i++) {
          const t = lines[i].trim();
          const secM = t.match(/^\[([^\]]+)\]/);
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

      // ── BREW SECTION: comment/uncomment instead of remove/insert ──
      // Locate brew section header (active [brew] or commented #[brew])
      let brewHeaderIdx = -1;
      let brewIsActive = false;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].match(/^\s*\[brew\]/)) { brewHeaderIdx = i; brewIsActive = true; break; }
        if (lines[i].match(/^\s*#\s*\[brew\]/)) { brewHeaderIdx = i; brewIsActive = false; break; }
      }
      // Find end of brew section (index of next active section header, or end of file)
      const getBrewEnd = (start: number): number => {
        for (let j = start + 1; j < lines.length; j++) {
          if (lines[j].match(/^\s*\[[^\]]+\]/)) return j;
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
