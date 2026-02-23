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
- `server/routes.ts` — Node.js server that spawns Python and relays data via WebSocket
- `client/src/pages/Dashboard.tsx` — Main dashboard UI (terminal-style)
- `client/src/pages/Calculator.tsx` — TETRA frequency calculator (iframe wrapper, syncs language via postMessage)
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

## Demo Mode
When `journalctl` is not available (like in Replit), the Python script runs in demo mode with simulated TETRA traffic using realistic callsigns and talk groups.

## User Preferences
- Language: Spanish (default), with 7-language support
- Style: Terminal-like, matching the original Python `rich` library output
