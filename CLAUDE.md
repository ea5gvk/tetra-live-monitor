# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Express + React (Vite) web dashboard that tails a TETRA hotspot's logs and shows live status. Runs as a single-port appliance on a Raspberry Pi / Linux VPS. READMEs are in Spanish; the user prefers Spanish for conversation.

Sources:
- `client/` — React SPA (wouter routing, Radix/shadcn UI, Tailwind).
- `server/` — Express + `ws` WebSocket. `server/routes.ts` (~5000 lines) is the core.
- `shared/` — TypeScript domain types used by both sides (`Terminal`, `CallLog`, `MonitorState`, WS message shapes) in `shared/schema.ts`.

## Commands

- `npm run dev` — dev server, `tsx server/index.ts` with Vite middleware + HMR.
- `npm run build` — `tsx script/build.ts`: builds the client with Vite, then bundles `server/index.ts` with esbuild into `dist/index.cjs` (CJS, minified). Deps in `script/build.ts`'s `allowlist` get bundled; the rest stay external.
- `npm start` — `NODE_ENV=production node dist/index.cjs`. Serves API + built client on **PORT (default 5000)**.
- `npm run check` — `tsc` typecheck (no emit). There is no lint or test setup.
- `npm run db:push` — `drizzle-kit push` (Postgres). Only the `settings` table is in Drizzle — most state is in-memory (see below).

## How it works

One process serves both API and client on a single port (`server/index.ts`). At startup `server/routes.ts` spawns **`journalctl`** to tail the bluestation's TETRA logs and a **`python3`** helper (radioid.net callsign lookups — needs `pip3 install requests`). Parsed events become a `MonitorState` broadcast to browsers over WebSocket. If `journalctl` is unavailable (e.g. dev on Windows) it runs in **demo mode**; force it with `TETRA_DEMO=1`.

This is a Linux-target appliance: the dashboard performs privileged operations by `spawn`-ing shell commands (shutdown/reboot, WireGuard `wg`/`wg-quick`, `apt`) that require passwordless sudo on the Pi. `DATABASE_URL` is required only when Postgres features are used.

Runtime files at the project root: `config.json` (`systemPassword` gating shutdown/VPN actions, hot-reloaded) and `vpn-data.json` (WireGuard client keys/IPs).
