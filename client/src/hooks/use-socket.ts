import { useEffect, useRef, useState } from 'react';
import { useToast } from './use-toast';
import { Terminal, CallLog, WS_EVENTS, MonitorState } from '@shared/schema';

type WebSocketStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export function useMonitorSocket() {
  const [status, setStatus] = useState<WebSocketStatus>('connecting');
  const [terminals, setTerminals] = useState<Record<string, Terminal>>({});
  const [localHistory, setLocalHistory] = useState<CallLog[]>([]);
  const [externalHistory, setExternalHistory] = useState<CallLog[]>([]);
  
  const socketRef = useRef<WebSocket | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    function connect() {
      console.log('Connecting to WebSocket...', wsUrl);
      setStatus('connecting');
      socketRef.current = new WebSocket(wsUrl);

      socketRef.current.onopen = () => {
        console.log('WebSocket Connected');
        setStatus('connected');
        // Request initial state immediately
        socketRef.current?.send(JSON.stringify({ type: WS_EVENTS.REQUEST_STATE }));
        
        toast({
          title: "System Online",
          description: "Connected to TETRA Monitor Network",
          className: "border-primary text-primary",
        });
      };

      socketRef.current.onclose = () => {
        console.log('WebSocket Disconnected');
        setStatus('disconnected');
        // Attempt reconnect after delay
        setTimeout(connect, 3000);
      };

      socketRef.current.onerror = (error) => {
        console.error('WebSocket Error:', error);
        setStatus('error');
      };

      socketRef.current.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          switch (message.type) {
            case WS_EVENTS.INIT_STATE: {
              const payload = message.payload as MonitorState;
              setTerminals(payload.terminals);
              setLocalHistory(payload.localHistory);
              setExternalHistory(payload.externalHistory);
              break;
            }
            case WS_EVENTS.UPDATE_TERMINAL: {
              const terminal = message.payload as Terminal;
              setTerminals(prev => ({
                ...prev,
                [terminal.id]: terminal
              }));
              break;
            }
            case WS_EVENTS.NEW_CALL: {
              const call = message.payload as CallLog;
              if (call.isLocal) {
                setLocalHistory(prev => [call, ...prev].slice(0, 100)); // Keep last 100
              } else {
                setExternalHistory(prev => [call, ...prev].slice(0, 100));
              }
              break;
            }
          }
        } catch (err) {
          console.error('Failed to parse WS message', err);
        }
      };
    }

    connect();

    return () => {
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, [toast]);

  return {
    status,
    terminals,
    localHistory,
    externalHistory
  };
}
