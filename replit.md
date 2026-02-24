# TETRA Live Monitor

## Overview
A real-time TETRA radio network monitoring dashboard. The app displays active terminals (radios), their selected talk groups, status, and call history — similar to the original Python terminal UI but as a modern web application.

## Architecture
- **Frontend**: React + Vite + Tailwind CSS — Terminal-style dark UI
- **Backend**: Node.js Express serves the frontend and relays WebSocket data
- **Data Source**: Python script (`tetra_monitor.py`) processes TETRA logs and outputs JSON events
- **Communication**: Python → stdout/JSON → Node.js → WebSocket → Browser

## Key Files
- `tetra_monitor.py` — Python TETRA log processor (the brain)
- `server/routes.ts` — Node.js server that spawns Python, relays data via WebSocket, and serves SSE log stream
- `client/src/pages/Dashboard.tsx` — Main dashboard UI (terminal-style)
- `client/src/pages/Calculator.tsx` — TETRA frequency calculator (iframe wrapper, syncs language via postMessage)
- `client/src/pages/LogLive.tsx` — Real-time journalctl log viewer (SSE stream)
- `client/public/calculator.html` — Standalone TETRA frequency calculator (ETSI TS 100 392-15)
- `client/src/lib/i18n.ts` — Internationalization system (7 languages)
- `client/src/hooks/useTetraWebSocket.ts` — WebSocket connection hook
- `shared/schema.ts` — Shared TypeScript types

## Internationalization (i18n)
- **Supported languages**: English (EN), Spanish (ES), Chinese (ZH), Portuguese (PT), German (DE), French (FR), Italian (IT)
- **Default language**: Spanish (ES)
- **Storage**: localStorage key `tetra_dashboard_lang`
- **Dashboard**: React Context + `useI18n` hook in `client/src/lib/i18n.ts`
- **Calculator**: Standalone I18N object in `calculator.html`, synced from dashboard via postMessage
- **Language selector**: Globe button in the navigation bar, cycles through all 7 languages

## How It Works
1. Node.js starts and spawns `tetra_monitor.py`
2. Python processes TETRA logs (or runs demo mode if journalctl unavailable)
3. Python outputs JSON events to stdout
4. Node.js reads stdout and broadcasts to all WebSocket clients
5. Browser receives updates and renders the live dashboard

## TETRA Frequency Calculator
- Embedded as iframe from `client/public/calculator.html`
- Calculates TX/RX frequencies based on ETSI TS 100 392-15
- Can apply calculated values directly to Raspberry Pi config.toml via API
- Config section: `[phy_io.soapysdr]` for tx_freq/rx_freq, `[cell_info]` for other params
- `custom_duplex_spacing` only written when `duplex_spacing=7`; removed from config if not applicable

## Log Live
- New tab "LOG LIVE" in the nav bar, next to CALCULATOR
- Shows real-time `journalctl -u <service> -f` output via Server-Sent Events (SSE)
- Backend endpoint: `GET /api/log-stream?service=<name>` spawns `journalctl -u <service> -f -n 50 --no-pager` and streams lines as SSE events
- Frontend: `LogLive.tsx` connects via EventSource, displays lines with color coding (ERROR=red, WARN=yellow, DEBUG=blue, TRACE=gray, default=green)
- Configurable service name: click the gear icon to change the service (default: `tmo.service`), stored in localStorage key `tetra_log_service`
- Features: service selector, clear button, line counter, max 5000 lines buffer
- When `journalctl` is not available (Replit), shows a demo message explaining it works on Raspberry Pi

## Demo Mode
When `journalctl` is not available (like in Replit), the Python script runs in demo mode with simulated TETRA traffic using realistic callsigns and talk groups. ~35% of demo cycles simulate two concurrent calls on different TGs with different time slots.

## Concurrent Calls
- `_clear_activity(tg=X)` only clears terminals on the specified TG, allowing multiple simultaneous calls
- `_update_time_slot()` scopes TS propagation to terminals on the same TG as the active call
- Call end events (GROUP_IDLE, D-TX CEASED) extract the GSSI to clear only the relevant TG

## User Preferences
- Language: Spanish (default), with 7-language support
- Style: Terminal-like, matching the original Python `rich` library output
