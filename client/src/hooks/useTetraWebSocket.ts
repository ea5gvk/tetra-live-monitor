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
}

export interface CallLogEntry {
  id: string;
  timestamp: string;
  sourceId: string;
  sourceCallsign?: string;
  targetTg: string;
  display: string;
  isLocal: boolean;
}

export interface TetraState {
  terminals: Record<string, Terminal>;
  localHistory: CallLogEntry[];
  externalHistory: CallLogEntry[];
  connected: boolean;
  mode: string;
}

export function useTetraWebSocket(): TetraState {
  const [terminals, setTerminals] = useState<Record<string, Terminal>>({});
  const [localHistory, setLocalHistory] = useState<CallLogEntry[]>([]);
  const [externalHistory, setExternalHistory] = useState<CallLogEntry[]>([]);
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

  return { terminals, localHistory, externalHistory, connected, mode };
}
