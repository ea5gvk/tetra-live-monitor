# TETRA Live Monitor

## Overview
A real-time TETRA radio network monitoring dashboard. The app displays active terminals (radios), their selected talk groups, status, and call history — similar to the original Python terminal UI but as a modern web application.

## Architecture
- **Frontend**: React + Vite + Tailwind CSS — Terminal-style UI with dark/light theme toggle
- **Backend**: Node.js Express serves the frontend and relays WebSocket data
- **Data Source**: Python script (`tetra_monitor.py`) processes TETRA logs and outputs JSON events
- **Communication**: Python → stdout/JSON → Node.js → WebSocket → Browser

## Key Files
- `tetra_monitor.py` — Python TETRA log processor (the brain)
- `server/routes.ts` — Node.js server that spawns Python, relays data via WebSocket, and serves SSE log stream
- `client/src/pages/Dashboard.tsx` — Main dashboard UI (terminal-style)
- `client/src/pages/Calculator.tsx` — TETRA frequency calculator (iframe wrapper, syncs language via postMessage)
- `client/src/pages/LogLive.tsx` — Real-time journalctl log viewer (SSE stream)
- `client/src/pages/GpsMap.tsx` — GPS/LIP station map (react-leaflet, real-time via WebSocket)
- `client/public/calculator.html` — Standalone TETRA frequency calculator (ETSI TS 100 392-15)
- `client/src/lib/i18n.ts` — Internationalization system (9 languages)
- `client/src/hooks/useTetraWebSocket.ts` — WebSocket connection hook (includes gpsPositions state)
- `client/src/components/UpdateChecker.tsx` — Navbar update button + modal (GitHub check + streaming apply)
- `shared/schema.ts` — Shared TypeScript types

## Internationalization (i18n)
- **Supported languages**: English (EN), Spanish (ES), Chinese (ZH), Portuguese (PT), German (DE), French (FR), Italian (IT)
- **Default language**: Spanish (ES)
- **Storage**: localStorage key `tetra_dashboard_lang`
- **Dashboard**: React Context + `useI18n` hook in `client/src/lib/i18n.ts`
- **Calculator**: Standalone I18N object in `calculator.html`, synced from dashboard via postMessage
- **Language selector**: Globe button in the navigation bar, cycles through all 7 languages

## System Controls
- **Restart Service**: Button to restart a systemd service via `sudo systemctl restart <service>`, requires password
  - Configurable service name (default: `tmo.service`), stored in localStorage key `tetra_restart_service`
  - API endpoint: `POST /api/system/restart-service` with `{ password, serviceName }`
- **Reboot**: Reboots the Raspberry Pi via `sudo reboot`, requires password
- **Shutdown**: Shuts down the Raspberry Pi via `sudo shutdown -h now`, requires password

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
- **Network Info section** (`[net_info]`): MCC (Mobile Country Code) and MNC (Mobile Network Code). Creates/updates `[net_info]` section positioned before `[cell_info]`.
- **Cell Parameters section** (`[cell_info]`): location_area, colour_code (0–63), system_code (0–15), optional timezone broadcast (toggle + 421 IANA timezones dropdown, localStorage key `tetra_calc_timezone`).
- **Local SSI Ranges section**: dynamic list of start/end SSI range pairs. Toggle to enable; "Add Range" button; ranges written as `local_ssi_ranges = [[start, end], ...]` under `[cell_info]`.
- **Homebrew Protocol section** (`[brew]`): host, port (62031), username, password, TLS, reconnect_delay_secs (15), optional whitelisted_ssis (comma-separated). Removed if disabled.
- All sections reflected live in TOML preview; `server/routes.ts` apply-config handles all new fields with insert/update/remove TOML logic

## Log Live
- New tab "LOG LIVE" in the nav bar, next to CALCULATOR
- Shows real-time `journalctl -u <service> -f` output via Server-Sent Events (SSE)
- Backend endpoint: `GET /api/log-stream?service=<name>` spawns `journalctl -u <service> -f -n 50 --no-pager` and streams lines as SSE events
- Frontend: `LogLive.tsx` connects via EventSource, displays lines with color coding (ERROR=red, WARN=yellow, DEBUG=blue, TRACE=gray, default=green)
- Configurable service name: click the gear icon to change the service (default: `tmo.service`), stored in localStorage key `tetra_log_service`
- Features: service selector, clear button, line counter, max 5000 lines buffer
- When `journalctl` is not available (Replit), shows a demo message explaining it works on Raspberry Pi

## Talkgroup Names
- Displays human-readable names next to TG numbers in terminal rows, scanlist, and call history
- **Source**: Brandmeister (BM) or ADN Systems — toggled in Calculator's "Talkgroup Names" section
- **Backend**: `GET /api/talkgroups?source=bm|adn` — proxies BM/ADN API with 1-hour in-memory cache
- **Storage**: localStorage key `tetra_tg_names` = JSON `{id: name}`, `tetra_tg_source` = `'bm'|'adn'`
- **Hook**: `useTgNames()` in `Dashboard.tsx` — reads localStorage, returns `(id) => string` lookup fn
- **Calculator section**: LOAD button fetches all TGs from selected source; CLEAR removes them
- **Display**: amber/muted name shown inline next to TG number; hidden if no name found
- **i18n**: all 9 languages include `tg_names_*` keys

## Callsign Badge
- `@EA5GVK` badge visible en la barra de navegación, a la derecha del selector de idioma
- Color ámbar/dorado (`text-amber-400`, `bg-amber-500/15`, borde `border-amber-500/30`)
- Estilo: negrita, tracking-widest, no seleccionable

## WiFi Manager
- Nueva pestaña "WIFI" en la barra de navegación (después de VPN)
- Página: `client/src/pages/WifiManager.tsx`
- **ESTADO WIFI**: muestra si hay conexión, SSID, IP, señal, interfaz, seguridad
- **REDES DISPONIBLES**: botón Escanear → lista ordenada por señal con barras de señal, seguridad, botón Conectar (pide contraseña WiFi + contraseña del sistema)
- **REDES GUARDADAS**: lista de redes guardadas con botón Olvidar (requiere contraseña del sistema)
- Backend usa `nmcli` (NetworkManager CLI) disponible en Raspberry Pi OS Bookworm
- Modo demo cuando `nmcli` no está disponible (Replit)
- Traducciones `wifi_*` en los 7 idiomas
- API endpoints: `GET /api/wifi/status`, `GET /api/wifi/scan`, `GET /api/wifi/saved`, `POST /api/wifi/connect`, `POST /api/wifi/disconnect`, `POST /api/wifi/forget`
- Las operaciones de escritura requieren la contraseña del sistema (misma que restart/shutdown/VPN)

## VPN Manager (WireGuard)
- New tab "VPN" in the nav bar (next to LOG LIVE)
- Page: `client/src/pages/VpnManager.tsx`
- **VPN STATUS panel**: Shows if WireGuard is installed (YES/NO), if the wg0 interface is active (UP/DOWN), connected peers and their handshake/transfer stats
- **SERVER CONFIGURATION panel**: Fields to configure server WireGuard IP, listen port (default 51820), DNS for clients (default 8.8.8.8). Collapsible. Requires system password to setup.
- **CLIENTS panel**: List of configured VPN clients. Add a new client (name → generates key pair → assigns next IP). Each client has a QR code button (opens modal with QR + config text to scan with WireGuard mobile app) and a delete button.
- **Data stored**: `vpn-data.json` in project root (server keys + client list with private/public keys and addresses)
- **WireGuard config**: Written to `/etc/wireguard/wg0.conf` via sudo. Clients get sequential IPs (10.8.0.2, 10.8.0.3, …)
- **API endpoints**: `GET /api/vpn/status`, `POST /api/vpn/install`, `POST /api/vpn/setup`, `POST /api/vpn/connect`, `POST /api/vpn/disconnect`, `GET /api/vpn/clients`, `POST /api/vpn/clients`, `GET /api/vpn/clients/:name/config`, `DELETE /api/vpn/clients/:name`
- All mutating operations require the system password (same as restart/shutdown)
- Client config includes QR code (via react-qr-code) scannable with the WireGuard mobile app
- **Requirements**: Port 51820 UDP must be forwarded in the router to the Pi's local IP

## SDS Messages
SDS (Short Data Service) messages are detected from TETRA logs and displayed in a dedicated panel at the bottom of the dashboard:
- **Outgoing** (radio → network): `BrewEntity: sending SDS uuid=... src=X dst=Y type=N N bits`
- **Incoming** (network → radio): `BrewEntity: SDS transfer uuid=... src=X dst=Y N bytes`
- **Text SDS content**: decoded from `D-SDS-DATA DSdsData { calling_party_address_ssi: Some(SSSI), ..., user_defined_data: Type4(N, [bytes...]) }` debug lines logged by bluestation CMCE layer. Bytes are decoded using ISO-8859-1 and 7-bit GSM packed with 0–4 byte header skip heuristic (min 3 printable chars required).
- **LIP/GPS content**: `SDS: LIP from ISSI X: lat=Y lon=Z [speed=N] [heading=N]` (demo mode and custom implementations)
- Panel shows: timestamp, direction badge (OUT/IN), source ISSI, destination ISSI, SDS type, message size
- When present: text content (violet, with speech icon) and GPS coordinates (cyan, with map link to Google Maps)
- Up to 50 SDS messages kept in history
- Displayed in violet/purple color scheme to distinguish from voice calls
- State tracked in server `currentState.sdsMessages` so new connections receive full history
- D-SDS-DATA content lines are correlated with BrewEntity SDS entries via `sds_content_pending` dict keyed by `calling_party_address_ssi` (5s window, 10s eviction)
- **Note**: bluestation does NOT log outgoing SDS text in plain format — outgoing SDS from the radio show without text content (only metadata)

## Demo Mode
When `journalctl` is not available (like in Replit), the Python script runs in demo mode with simulated TETRA traffic using realistic callsigns and talk groups. ~35% of demo cycles simulate two concurrent calls on different TGs with different time slots. ~20% of demo cycles also simulate an SDS message (outgoing or incoming).

## Concurrent Calls
- `_clear_activity(tg=X)` only clears terminals on the specified TG, allowing multiple simultaneous calls
- `_update_time_slot()` scopes TS propagation to terminals on the same TG as the active call
- Call end events (GROUP_IDLE, D-TX CEASED) extract the GSSI to clear only the relevant TG

## User Preferences
- Language: Spanish (default), with 7-language support
- Style: Terminal-like, matching the original Python `rich` library output
