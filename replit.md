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
- `client/src/hooks/useTetraWebSocket.ts` — WebSocket connection hook
- `shared/schema.ts` — Shared TypeScript types

## How It Works
1. Node.js starts and spawns `tetra_monitor.py`
2. Python processes TETRA logs (or runs demo mode if journalctl unavailable)
3. Python outputs JSON events to stdout
4. Node.js reads stdout and broadcasts to all WebSocket clients
5. Browser receives updates and renders the live dashboard

## Demo Mode
When `journalctl` is not available (like in Replit), the Python script runs in demo mode with simulated TETRA traffic using realistic callsigns and talk groups.

## User Preferences
- Language: Spanish
- Style: Terminal-like, matching the original Python `rich` library output
