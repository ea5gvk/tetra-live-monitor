import { useState, useEffect, useCallback } from "react";
import { Shield, ShieldCheck, ShieldOff, Plus, QrCode, Trash2, RefreshCw, Lock, Copy, Check, Wifi, WifiOff, Settings, ChevronDown, ChevronUp, Download } from "lucide-react";
import QRCode from "react-qr-code";
import { useI18n } from "@/lib/i18n";

interface VpnStatus {
  installed: boolean;
  active: boolean;
  configured: boolean;
  serverPublicKey: string | null;
  serverAddress: string | null;
  serverPort: number | null;
  clientDns: string | null;
  wgInfo: {
    interface: string;
    listenPort: number | null;
    publicKey: string;
    peers: Array<{
      publicKey: string;
      endpoint: string | null;
      allowedIps: string;
      latestHandshake: string | null;
      transfer: string | null;
    }>;
  } | null;
}

interface VpnClient {
  name: string;
  address: string;
  publicKey: string;
  createdAt: string;
}

function PasswordModal({ title, onConfirm, onClose }: { title: string; onConfirm: (pw: string) => void; onClose: () => void }) {
  const [pw, setPw] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="glass-panel rounded-lg p-5 w-80 shadow-2xl border border-white/10">
        <div className="flex items-center gap-2 mb-4">
          <Lock className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-bold text-foreground">{title}</h3>
        </div>
        <input
          type="password"
          autoFocus
          placeholder="Contraseña del sistema"
          value={pw}
          onChange={e => setPw(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && pw) onConfirm(pw); if (e.key === "Escape") onClose(); }}
          className="w-full bg-black/30 border border-white/10 rounded px-3 py-2 text-sm font-mono text-foreground mb-4 outline-none focus:border-primary/50"
          data-testid="input-vpn-password"
        />
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-1.5 text-xs rounded bg-white/5 text-muted-foreground hover:bg-white/10 transition-colors">Cancelar</button>
          <button onClick={() => pw && onConfirm(pw)} disabled={!pw} className="px-3 py-1.5 text-xs rounded bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 transition-colors disabled:opacity-40">Confirmar</button>
        </div>
      </div>
    </div>
  );
}

function QrModal({ clientName, onClose }: { clientName: string; onClose: () => void }) {
  const [config, setConfig] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/vpn/clients/${encodeURIComponent(clientName)}/config`)
      .then(r => r.json())
      .then(d => { if (d.config) setConfig(d.config); else setError(d.message || "Error"); })
      .catch(() => setError("Error al obtener config"))
      .finally(() => setLoading(false));
  }, [clientName]);

  const copy = () => {
    if (!config) return;
    navigator.clipboard.writeText(config).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="glass-panel rounded-lg w-full max-w-md shadow-2xl border border-white/10">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
          <div className="flex items-center gap-2">
            <QrCode className="w-4 h-4 text-emerald-400" />
            <span className="text-sm font-bold text-foreground font-mono">{clientName}</span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg leading-none">×</button>
        </div>
        <div className="p-5">
          {loading && <div className="text-center text-muted-foreground text-sm py-8">Generando...</div>}
          {error && <div className="text-center text-red-400 text-sm py-8">{error}</div>}
          {config && (
            <>
              <div className="flex justify-center bg-white p-4 rounded-lg mb-4">
                <QRCode value={config} size={220} />
              </div>
              <p className="text-center text-[10px] text-muted-foreground mb-3">Escanea con la app WireGuard en tu móvil</p>
              <div className="bg-black/40 rounded p-3 font-mono text-[10px] text-emerald-300/80 max-h-36 overflow-y-auto whitespace-pre mb-3 border border-white/5">
                {config}
              </div>
              <button onClick={copy} className="w-full flex items-center justify-center gap-2 py-1.5 text-xs rounded bg-white/5 text-muted-foreground hover:bg-white/10 transition-colors border border-white/10">
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? "¡Copiado!" : "Copiar configuración"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function VpnManager() {
  const { t } = useI18n();
  const [status, setStatus] = useState<VpnStatus | null>(null);
  const [clients, setClients] = useState<VpnClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pendingAction, setPendingAction] = useState<((pw: string) => void) | null>(null);
  const [pendingTitle, setPendingTitle] = useState("");
  const [qrClient, setQrClient] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [newClientName, setNewClientName] = useState("");
  const [setupForm, setSetupForm] = useState({ serverAddress: "10.8.0.1/24", serverPort: "51820", clientDns: "8.8.8.8" });

  const showMsg = (text: string, ok = true) => { setMsg({ text, ok }); setTimeout(() => setMsg(null), 4000); };

  const fetchStatus = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([fetch("/api/vpn/status").then(r => r.json()), fetch("/api/vpn/clients").then(r => r.json())]);
      setStatus(s);
      setClients(Array.isArray(c) ? c : []);
      if (s.serverAddress) setSetupForm(f => ({ ...f, serverAddress: s.serverAddress, serverPort: String(s.serverPort || 51820), clientDns: s.clientDns || "8.8.8.8" }));
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const withPassword = (title: string, action: (pw: string) => Promise<void>) => {
    setPendingTitle(title);
    setPendingAction(() => async (pw: string) => {
      setPendingAction(null);
      try { await action(pw); } catch {}
    });
  };

  const apiCall = async (url: string, method: string, body: any): Promise<{ ok: boolean; message?: string }> => {
    try {
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      return { ok: r.ok, message: d.message };
    } catch { return { ok: false, message: "Error de red" }; }
  };

  const doInstall = async (pw: string) => {
    const r = await apiCall("/api/vpn/install", "POST", { password: pw });
    showMsg(r.message || "Instalando...", r.ok);
    if (r.ok) setTimeout(fetchStatus, 5000);
  };

  const doSetup = async (pw: string) => {
    const r = await apiCall("/api/vpn/setup", "POST", { password: pw, ...setupForm });
    showMsg(r.message || (r.ok ? "Configurado" : "Error"), r.ok);
    if (r.ok) { fetchStatus(); setShowSetup(false); }
  };

  const doConnect = async (pw: string) => {
    const r = await apiCall("/api/vpn/connect", "POST", { password: pw });
    showMsg(r.message || (r.ok ? "Activo" : "Error"), r.ok);
    if (r.ok) setTimeout(fetchStatus, 2000);
  };

  const doDisconnect = async (pw: string) => {
    const r = await apiCall("/api/vpn/disconnect", "POST", { password: pw });
    showMsg(r.message || (r.ok ? "Detenido" : "Error"), r.ok);
    if (r.ok) setTimeout(fetchStatus, 2000);
  };

  const doAddClient = async (pw: string) => {
    const r = await apiCall("/api/vpn/clients", "POST", { password: pw, name: newClientName });
    showMsg(r.message || (r.ok ? "Cliente creado" : "Error"), r.ok);
    if (r.ok) { setNewClientName(""); fetchStatus(); }
  };

  const doDeleteClient = async (name: string, pw: string) => {
    const r = await apiCall(`/api/vpn/clients/${encodeURIComponent(name)}`, "DELETE", { password: pw });
    showMsg(r.message || (r.ok ? "Eliminado" : "Error"), r.ok);
    if (r.ok) fetchStatus();
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-muted-foreground text-xs font-mono">Cargando...</div>
      </div>
    );
  }

  const isInstalled = status?.installed;
  const isActive = status?.active;
  const isConfigured = status?.configured;

  return (
    <div className="flex-1 overflow-auto p-3 sm:p-4 space-y-3">
      {pendingAction && (
        <PasswordModal
          title={pendingTitle}
          onConfirm={pendingAction}
          onClose={() => setPendingAction(null)}
        />
      )}
      {qrClient && <QrModal clientName={qrClient} onClose={() => setQrClient(null)} />}

      {msg && (
        <div className={`text-xs px-3 py-2 rounded border font-mono ${msg.ok ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-red-500/10 border-red-500/30 text-red-400"}`}>
          {msg.text}
        </div>
      )}

      {/* VPN STATUS */}
      <div className="glass-panel rounded-md overflow-hidden" data-testid="panel-vpn-status">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5 bg-emerald-500/5">
          <Shield className="w-4 h-4 text-emerald-400" />
          <h2 className="text-xs font-bold tracking-[0.15em] uppercase text-emerald-400">VPN STATUS</h2>
          <button onClick={fetchStatus} className="ml-auto text-muted-foreground hover:text-foreground transition-colors" title="Actualizar" data-testid="button-vpn-refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="p-4 space-y-2 font-mono text-xs">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-2 gap-x-4">
            <div className="text-muted-foreground">Installed</div>
            <div>
              {isInstalled
                ? <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">YES</span>
                : <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-400 border border-red-500/30">NO</span>}
            </div>
            <div />
            <div className="text-muted-foreground">Active</div>
            <div>
              {isActive
                ? <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">UP</span>
                : <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-500/20 text-red-400 border border-red-500/30">DOWN</span>}
            </div>
            <div />
            {isActive && status?.wgInfo && <>
              <div className="text-muted-foreground">Interface</div>
              <div className="text-primary col-span-2">{status.wgInfo.interface || "wg0"}</div>
              <div className="text-muted-foreground">Listen Port</div>
              <div className="text-foreground col-span-2">{status.wgInfo.listenPort || status.serverPort}</div>
              <div className="text-muted-foreground">Peers</div>
              <div className="text-foreground col-span-2">{status.wgInfo.peers.length} conectado{status.wgInfo.peers.length !== 1 ? "s" : ""}</div>
            </>}
            {!isActive && isConfigured && <>
              <div className="text-muted-foreground">Server IP</div>
              <div className="text-foreground col-span-2">{status?.serverAddress}</div>
              <div className="text-muted-foreground">Port</div>
              <div className="text-foreground col-span-2">{status?.serverPort}</div>
            </>}
          </div>

          {isActive && status?.wgInfo && status.wgInfo.peers.length > 0 && (
            <div className="mt-3 space-y-2 border-t border-white/5 pt-3">
              {status.wgInfo.peers.map((peer, i) => {
                const client = clients.find(c => c.publicKey === peer.publicKey);
                return (
                  <div key={i} className="bg-white/2 rounded p-2 text-[10px] space-y-0.5">
                    <div className="flex items-center gap-2">
                      <Wifi className="w-3 h-3 text-emerald-400 shrink-0" />
                      <span className="font-bold text-foreground">{client?.name || peer.allowedIps}</span>
                      {client && <span className="text-muted-foreground">({client.address})</span>}
                    </div>
                    {peer.endpoint && <div className="text-muted-foreground ml-5">Endpoint: <span className="text-sky-400">{peer.endpoint}</span></div>}
                    {peer.latestHandshake && <div className="text-muted-foreground ml-5">Handshake: <span className="text-foreground">{peer.latestHandshake}</span></div>}
                    {peer.transfer && <div className="text-muted-foreground ml-5">Transfer: <span className="text-foreground">{peer.transfer}</span></div>}
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-2 border-t border-white/5">
            {!isInstalled && (
              <button
                onClick={() => withPassword("Instalar WireGuard", doInstall)}
                className="px-3 py-1.5 text-xs font-bold rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30 transition-colors"
                data-testid="button-vpn-install"
              >
                Instalar WireGuard
              </button>
            )}
            {isInstalled && !isActive && isConfigured && (
              <button
                onClick={() => withPassword("Activar WireGuard VPN", doConnect)}
                className="px-3 py-1.5 text-xs font-bold rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 transition-colors"
                data-testid="button-vpn-connect"
              >
                Connect
              </button>
            )}
            {isActive && (
              <button
                onClick={() => withPassword("Detener WireGuard VPN", doDisconnect)}
                className="px-3 py-1.5 text-xs font-bold rounded bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors"
                data-testid="button-vpn-disconnect"
              >
                Disconnect
              </button>
            )}
            <button
              onClick={fetchStatus}
              className="px-3 py-1.5 text-xs font-bold rounded bg-sky-500/20 text-sky-400 border border-sky-500/30 hover:bg-sky-500/30 transition-colors"
              data-testid="button-vpn-refresh-status"
            >
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* SERVER SETUP */}
      <div className="glass-panel rounded-md overflow-hidden" data-testid="panel-vpn-setup">
        <button
          onClick={() => setShowSetup(v => !v)}
          className="w-full flex items-center gap-2 px-4 py-2 border-b border-white/5 bg-sky-500/5 hover:bg-sky-500/10 transition-colors"
        >
          <Settings className="w-4 h-4 text-sky-400" />
          <h2 className="text-xs font-bold tracking-[0.15em] uppercase text-sky-400">SERVER CONFIGURATION</h2>
          {isConfigured && <span className="ml-2 px-1.5 py-0.5 text-[9px] rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-bold">Configurado</span>}
          <span className="ml-auto text-muted-foreground">{showSetup ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}</span>
        </button>
        {showSetup && (
          <div className="p-4 space-y-3 font-mono text-xs">
            {isConfigured && status?.serverPublicKey && (
              <div className="bg-black/20 rounded p-2 space-y-1 border border-white/5 mb-3">
                <div className="text-muted-foreground text-[10px]">Server Public Key</div>
                <div className="text-foreground break-all text-[10px]">{status.serverPublicKey}</div>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-muted-foreground mb-1 text-[10px]">Server WireGuard IP</label>
                <input value={setupForm.serverAddress} onChange={e => setSetupForm(f => ({ ...f, serverAddress: e.target.value }))}
                  className="w-full bg-black/30 border border-white/10 rounded px-2 py-1.5 text-xs font-mono text-foreground outline-none focus:border-sky-500/50"
                  placeholder="10.8.0.1/24" data-testid="input-server-address" />
              </div>
              <div>
                <label className="block text-muted-foreground mb-1 text-[10px]">Listen Port</label>
                <input value={setupForm.serverPort} onChange={e => setSetupForm(f => ({ ...f, serverPort: e.target.value }))}
                  className="w-full bg-black/30 border border-white/10 rounded px-2 py-1.5 text-xs font-mono text-foreground outline-none focus:border-sky-500/50"
                  placeholder="51820" data-testid="input-server-port" />
              </div>
              <div>
                <label className="block text-muted-foreground mb-1 text-[10px]">DNS para clientes</label>
                <input value={setupForm.clientDns} onChange={e => setSetupForm(f => ({ ...f, clientDns: e.target.value }))}
                  className="w-full bg-black/30 border border-white/10 rounded px-2 py-1.5 text-xs font-mono text-foreground outline-none focus:border-sky-500/50"
                  placeholder="8.8.8.8" data-testid="input-client-dns" />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              {!isInstalled && (
                <button onClick={() => withPassword("Instalar WireGuard", doInstall)}
                  className="px-3 py-1.5 text-xs font-bold rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30 transition-colors">
                  Instalar WireGuard
                </button>
              )}
              <button onClick={() => withPassword(isConfigured ? "Reconfigurar servidor VPN (se regenerarán las claves)" : "Configurar servidor VPN", doSetup)}
                className="px-3 py-1.5 text-xs font-bold rounded bg-sky-500/20 text-sky-400 border border-sky-500/30 hover:bg-sky-500/30 transition-colors"
                data-testid="button-vpn-setup">
                {isConfigured ? "Reconfigurar" : "Configurar Servidor"}
              </button>
            </div>
            {!isInstalled && (
              <p className="text-[10px] text-amber-400/70 bg-amber-500/5 rounded p-2 border border-amber-500/10">
                Instala WireGuard primero. Tardará ~1-2 min. Recarga la página después.
              </p>
            )}
          </div>
        )}
      </div>

      {/* CLIENTS */}
      <div className="glass-panel rounded-md overflow-hidden" data-testid="panel-vpn-clients">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5 bg-violet-500/5">
          <Wifi className="w-4 h-4 text-violet-400" />
          <h2 className="text-xs font-bold tracking-[0.15em] uppercase text-violet-400">CLIENTES VPN</h2>
          <span className="ml-auto text-[10px] text-muted-foreground font-mono">{clients.length} cliente{clients.length !== 1 ? "s" : ""}</span>
        </div>
        <div className="p-4 space-y-3 font-mono text-xs">
          {!isConfigured && (
            <p className="text-muted-foreground/60 text-center py-4">Configura el servidor primero</p>
          )}
          {isConfigured && (
            <>
              <div className="flex gap-2">
                <input
                  value={newClientName}
                  onChange={e => setNewClientName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && newClientName.trim()) withPassword("Crear cliente VPN", pw => doAddClient(pw)); }}
                  placeholder="Nombre del cliente (ej: movil, tablet)"
                  className="flex-1 bg-black/30 border border-white/10 rounded px-2 py-1.5 text-xs font-mono text-foreground outline-none focus:border-violet-500/50"
                  data-testid="input-client-name"
                />
                <button
                  onClick={() => { if (newClientName.trim()) withPassword("Crear cliente VPN", pw => doAddClient(pw)); }}
                  disabled={!newClientName.trim()}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded bg-violet-500/20 text-violet-400 border border-violet-500/30 hover:bg-violet-500/30 transition-colors disabled:opacity-40"
                  data-testid="button-add-client"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Añadir
                </button>
              </div>

              {clients.length === 0 && (
                <div className="text-muted-foreground/50 text-center py-6">No hay clientes. Añade uno arriba.</div>
              )}

              <div className="space-y-2">
                {clients.map(client => (
                  <div key={client.name} className="flex items-center gap-2 bg-white/3 rounded p-2.5 border border-white/5 group" data-testid={`client-row-${client.name}`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-foreground">{client.name}</span>
                        <span className="text-sky-400 text-[10px]">{client.address}</span>
                      </div>
                      <div className="text-muted-foreground/60 text-[10px] truncate mt-0.5" title={client.publicKey}>
                        {client.publicKey.slice(0, 24)}…
                      </div>
                    </div>
                    <button
                      onClick={() => setQrClient(client.name)}
                      className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 hover:bg-emerald-500/30 transition-colors shrink-0"
                      data-testid={`button-qr-${client.name}`}
                    >
                      <QrCode className="w-3.5 h-3.5" />
                      QR
                    </button>
                    <button
                      onClick={() => withPassword(`Eliminar cliente "${client.name}"`, pw => doDeleteClient(client.name, pw))}
                      className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold rounded bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/25 transition-colors shrink-0"
                      data-testid={`button-delete-${client.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="border-t border-white/5 pt-3 text-[10px] text-muted-foreground/60 leading-relaxed">
                <p>📱 Para conectarte: instala <strong className="text-muted-foreground">WireGuard</strong> en tu móvil → Añadir túnel → Escanear QR</p>
                <p className="mt-1">🔌 Puerto {status?.serverPort || 51820} UDP debe estar abierto en el router (reenvío de puertos a la IP local de la Pi)</p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
