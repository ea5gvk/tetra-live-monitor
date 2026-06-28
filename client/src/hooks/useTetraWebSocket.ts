import { useState, useEffect, useRef, useCallback } from "react";

export interface Terminal {
  id: string;
  callsign?: string;
  status: "Online" | "Offline" | "External";
  selectedTg: string;
  groups: string[];
  lastSeen: string;
  isLocal: boolean;
  isActive?: boolean;
  activity?: "TX" | "RX" | null;
  activityTg?: string | null;
  timeSlot?: number | null;
  rssiDbfs?: number | null;
  energySaving?: string | null;
}

export interface CallLogEntry {
  id: string;
  timestamp: string;
  sourceId: string;
  sourceCallsign?: string;
  targetTg: string;
  targetIssi?: string;
  display: string;
  isLocal: boolean;
  activity?: "TX" | "RX" | null;
  timeSlot?: number | null;
  callType?: "group" | "private";
}

export interface SdsLipData {
  lat: number;
  lon: number;
  speed?: number;
  heading?: number;
}

export interface SdsMessage {
  id: string;
  timestamp: string;
  srcIssi: string;
  srcCallsign?: string;
  dstIssi: string;
  dstCallsign?: string;
  direction: "outgoing" | "incoming";
  messageType: "data" | "status";
  statusCode?: string;
  sdsType: number;
  size: number;
  sizeUnit: "bits" | "bytes";
  textContent?: string;
  lipData?: SdsLipData;
}

export interface GpsPosition {
  issi: string;
  callsign: string | null;
  lat: number;
  lon: number;
  speed: number | null;
  heading: number | null;
  timestamp: string;
  hasFix: boolean;
}

export interface RfCall {
  callId: number;
  callType: string;
  gssi: number;
  callerIssi: number;
  calledIssi: number;
  ts: number;
  // Carrier / RF channel the call sits on. Absent (null/undefined) for legacy
  // single-carrier flowstation builds; present when dual carrier is active.
  carrier?: number | null;
}

export interface EmergencyEntry {
  issi: number;
  dest_ssi: number;
  started_secs_ago: number;
}

export interface BrewStatus {
  connected: boolean;
  version: number;
}

export interface LastHeardEntry {
  ts: string;
  issi: number;
  activity: string;
  dest: number;
}

export interface TxQuality {
  papr_db?: number;
  evm_pct?: number;
  dc_offset_i?: number;
  dc_offset_q?: number;
  iq_amplitude_imbalance_db?: number;
  iq_phase_imbalance_deg?: number;
  carrier_leakage_db?: number;
  occupied_bandwidth_hz?: number;
}

export interface SdrHealth {
  temperature_c?: number;
  tx_gains?: [string, number][];
  rx_gains?: [string, number][];
}

export interface SysHealth {
  total_power_w?: number;
  sensors?: { name: string; kind: string; value: number }[];
}

export type HealthLevel = "ok" | "degraded" | "critical";

export interface HealthDomain {
  domain: string;
  level: HealthLevel;
  detail?: string;
}

export interface HealthSnapshot {
  overall: HealthLevel;
  domains: HealthDomain[];
  last_action?: string;
  uptime_secs?: number;
}

export interface TetraState {
  terminals: Record<string, Terminal>;
  localHistory: CallLogEntry[];
  externalHistory: CallLogEntry[];
  sdsMessages: SdsMessage[];
  gpsPositions: Record<string, GpsPosition>;
  gpsHistory: Record<string, GpsPosition[]>;
  rfCalls: RfCall[];
  fsDashboardActive: boolean;
  tsVoiceActivity: Record<number, number>;
  emergencies: EmergencyEntry[];
  brewStatus: BrewStatus | null;
  lastHeard: LastHeardEntry[];
  txQuality: TxQuality | null;
  health: HealthSnapshot | null;
  sdrHealth: SdrHealth | null;
  sysHealth: SysHealth | null;
  connected: boolean;
  mode: string;
}

export function useTetraWebSocket(): TetraState {
  const [terminals, setTerminals] = useState<Record<string, Terminal>>({});
  const [localHistory, setLocalHistory] = useState<CallLogEntry[]>([]);
  const [externalHistory, setExternalHistory] = useState<CallLogEntry[]>([]);
  const [sdsMessages, setSdsMessages] = useState<SdsMessage[]>([]);
  const [gpsPositions, setGpsPositions] = useState<Record<string, GpsPosition>>({});
  const [gpsHistory, setGpsHistory] = useState<Record<string, GpsPosition[]>>({});
  const [rfCalls, setRfCalls] = useState<RfCall[]>([]);
  const [fsDashboardActive, setFsDashboardActive] = useState(false);
  const [tsVoiceActivity, setTsVoiceActivity] = useState<Record<number, number>>({});
  const [emergencies, setEmergencies] = useState<EmergencyEntry[]>([]);
  const [brewStatus, setBrewStatus] = useState<BrewStatus | null>(null);
  const [lastHeard, setLastHeard] = useState<LastHeardEntry[]>([]);
  const [txQuality, setTxQuality] = useState<TxQuality | null>(null);
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [sdrHealth, setSdrHealth] = useState<SdrHealth | null>(null);
  const [sysHealth, setSysHealth] = useState<SysHealth | null>(null);
  const [connected, setConnected] = useState(false);
  const [mode, setMode] = useState("connecting");
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();

  const connect = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/ws`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        switch (msg.type) {
          case "full_state":
            setTerminals(msg.payload.terminals || {});
            setLocalHistory(msg.payload.localHistory || []);
            setExternalHistory(msg.payload.externalHistory || []);
            setSdsMessages(msg.payload.sdsMessages || []);
            setGpsPositions(msg.payload.gpsPositions || {});
            setGpsHistory(msg.payload.gpsHistory || {});
            if (msg.payload.rfCalls) setRfCalls(msg.payload.rfCalls);
            if (msg.payload.fsDashboardActive !== undefined) setFsDashboardActive(!!msg.payload.fsDashboardActive);
            setEmergencies(msg.payload.emergencies || []);
            setBrewStatus(msg.payload.brewStatus ?? null);
            setLastHeard(msg.payload.lastHeard || []);
            setTxQuality(msg.payload.txQuality ?? null);
            setHealth(msg.payload.health ?? null);
            setSdrHealth(msg.payload.sdrHealth ?? null);
            setSysHealth(msg.payload.sysHealth ?? null);
            break;

          case "fs_emergency":
            setEmergencies(msg.payload?.emergencies || []);
            break;

          case "fs_brew_status":
            setBrewStatus(msg.payload ?? null);
            break;

          case "fs_last_heard":
            setLastHeard(msg.payload?.list || []);
            break;

          case "fs_tx_quality":
            setTxQuality(msg.payload ?? null);
            break;

          case "fs_health":
            setHealth(msg.payload ?? null);
            break;

          case "fs_sdr_health":
            setSdrHealth(msg.payload ?? null);
            break;

          case "fs_sys_health":
            setSysHealth(msg.payload ?? null);
            break;

          case "rf_calls_state":
            setRfCalls(msg.payload || []);
            break;

          case "fs_dashboard_status":
            setFsDashboardActive(!!msg.payload?.active);
            break;

          case "rf_call_started":
            setRfCalls(prev => {
              const filtered = prev.filter((c: RfCall) => c.callId !== msg.payload.callId);
              return [...filtered, msg.payload as RfCall];
            });
            break;

          case "rf_call_ended":
            setRfCalls(prev => prev.filter((c: RfCall) => c.callId !== msg.payload.callId));
            break;

          case "rf_ts_voice":
            if (msg.payload?.ts >= 1 && msg.payload?.ts <= 4) {
              setTsVoiceActivity(prev => ({ ...prev, [msg.payload.ts]: Date.now() }));
            }
            break;

          case "update_terminal":
            setTerminals(prev => ({
              ...prev,
              [msg.payload.id]: msg.payload
            }));
            break;

          case "new_call": {
            const entry = msg.payload as CallLogEntry;
            if (entry.isLocal) {
              setLocalHistory(prev => [entry, ...prev].slice(0, 50));
            } else {
              setExternalHistory(prev => [entry, ...prev].slice(0, 50));
            }
            break;
          }

          case "update_call": {
            const updated = msg.payload as CallLogEntry;
            if (updated.isLocal) {
              setLocalHistory(prev => prev.map(e => e.id === updated.id ? updated : e));
            } else {
              setExternalHistory(prev => prev.map(e => e.id === updated.id ? updated : e));
            }
            break;
          }

          case "sds_message": {
            const sds = msg.payload as SdsMessage;
            setSdsMessages(prev => {
              const idx = prev.findIndex(m => m.id === sds.id);
              if (idx >= 0) {
                const updated = [...prev];
                updated[idx] = sds;
                return updated;
              }
              return [sds, ...prev].slice(0, 50);
            });
            // Update GPS positions + track history when SDS carries LIP data
            if (sds.lipData && sds.srcIssi) {
              const newPos: GpsPosition = {
                issi: sds.srcIssi,
                callsign: sds.srcCallsign || null,
                lat: sds.lipData!.lat,
                lon: sds.lipData!.lon,
                speed: sds.lipData!.speed ?? null,
                heading: sds.lipData!.heading ?? null,
                timestamp: new Date().toISOString(),
                hasFix: true,
              };
              setGpsPositions(prev => ({
                ...prev,
                [sds.srcIssi]: { ...newPos, callsign: sds.srcCallsign || prev[sds.srcIssi]?.callsign || null },
              }));
              setGpsHistory(prev => {
                const existing = prev[sds.srcIssi] || [];
                const updated = [...existing, newPos].slice(-200);
                return { ...prev, [sds.srcIssi]: updated };
              });
            }
            break;
          }

          case "status":
            setMode(msg.payload.mode || "unknown");
            break;
        }
      } catch (e) {
        // ignore parse errors
      }
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      reconnectTimer.current = setTimeout(connect, 2000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [connect]);

  return { terminals, localHistory, externalHistory, sdsMessages, gpsPositions, gpsHistory, rfCalls, fsDashboardActive, tsVoiceActivity, emergencies, brewStatus, lastHeard, txQuality, health, sdrHealth, sysHealth, connected, mode };
}
