#!/usr/bin/env python3
import json
import subprocess
import time
import sys
import re
import requests
import select
from datetime import datetime
# --- DEPENDENCY CHECK ---
try:
    from rich.live import Live
    from rich.table import Table
    from rich.layout import Layout
    from rich.panel import Panel
    from rich import box
except ImportError:
    print("\n[!] 'rich' fehlt: sudo apt install python3-rich\n")
    sys.exit(1)

# --- KONFIGURATION ---
JOURNAL_CMD = ["journalctl", "-f", "-o", "json"]
MAX_HISTORY = 12
RADIOID_API = "https://database.radioid.net/api/dmr/user/?id="

class TetraMonitor:
    def __init__(self):
        self.terminals = {}
        self.hist_local = []
        self.hist_ext = []
        self.last_active = None
        self.last_context_id = None  # Stores the last seen valid Terminal ID from logs processing
        self.callsign_cache = {}

    def get_callsign(self, issi):
        if not issi or int(issi) < 1000: return ""
        if issi in self.callsign_cache:
            return self.callsign_cache[issi]
        try:
            response = requests.get(f"{RADIOID_API}{issi}", timeout=1.0)
            if response.status_code == 200:
                data = response.json()
                call = ""
                if isinstance(data, dict):
                    if "callsign" in data: call = data["callsign"]
                    elif "results" in data and len(data["results"]) > 0:
                        call = data["results"][0].get("callsign", "")
                if call:
                    self.callsign_cache[issi] = str(call).upper()
                    return self.callsign_cache[issi]
        except: pass
        self.callsign_cache[issi] = "" 
        return ""

    def process_line(self, line):
        try:
            data = json.loads(line)
            msg_raw = data.get("MESSAGE", "")
            msg = "".join(chr(x) for x in msg_raw) if isinstance(msg_raw, list) else msg_raw
            msg = re.sub(r'\x1b\[[0-9;]*m', '', msg)
            ts = int(data.get("__REALTIME_TIMESTAMP", time.time()*1000000)) / 1000000
            timestamp = datetime.fromtimestamp(ts).strftime("%H:%M:%S")

            # Global ID Extraction for Context
            global_id = None
            id_match = re.search(r"\b(?:issi|ssi|subscriber)[:\s=]+(?:Some\()?(\d+)(?:[\),]*\s*,?\s*ssi_type[:\s=]+(\w+))?", msg, re.I)
            if id_match:
                found_id = id_match.group(1)
                type_found = id_match.group(2)
                # Only use if NOT a Group ID
                if not (type_found and "gssi" in type_found.lower()):
                    global_id = found_id
                    self.last_context_id = global_id  # Store for multi-line context

            # --- 1. DEREGISTER ---
            if "deregister" in msg.lower():
                # Use global_id or fallback to local search if global regex missed something specific (unlikely but safe)
                target_id = global_id
                if not target_id:
                     det = re.search(r"\b(?:issi|ssi|subscriber)[:\s=]+(?:Some\()?(\d+)", msg, re.I)
                     if det: target_id = det.group(1)
                
                if target_id:
                    if target_id in self.terminals:
                        self.terminals[target_id]["status"] = "Offline"
                        self.terminals[target_id]["selected"] = "---"
                    return True

            # --- 2. CALLS & TRANSMISSIONS ---
            call_match = re.search(r"(?:call from ISSI|src=)\s*(\d+).*?(?:to GSSI|dst=)\s*(\d+)", msg, re.I)
            if call_match:
                s_issi, d_gssi = call_match.groups()
                self.last_active = s_issi
                if s_issi not in self.terminals:
                    self.terminals[s_issi] = {"selected": f"TG {d_gssi}", "groups": [d_gssi], "status": "External", "is_local": False, "last_seen": timestamp}
                else:
                    self.terminals[s_issi]["selected"] = f"TG {d_gssi}"
                    self.terminals[s_issi]["last_seen"] = timestamp
                    if d_gssi not in self.terminals[s_issi]["groups"]:
                        self.terminals[s_issi]["groups"].append(d_gssi)

                call = self.get_callsign(s_issi)
                display_name = f"{s_issi} ({call})" if call else s_issi
                entry = f"[{timestamp}] {display_name} -> TG {d_gssi}"
                target = self.hist_local if self.terminals[s_issi]["is_local"] else self.hist_ext
                if not target or target[0] != entry:
                    target.insert(0, entry); del target[MAX_HISTORY:]
                return True

            # --- 3. REGISTER & DEEP GSSI RECOVERY ---
            # Use broader regex to capture ssi_type if present to filter out Group SSIs
            id_match = re.search(r"\b(?:issi|ssi|subscriber)[:\s=]+(?:Some\()?(\d+)(?:[\),]*\s*,?\s*ssi_type[:\s=]+(\w+))?", msg, re.I)
            if id_match:
                id = id_match.group(1)
                
                # Check for ssi_type (Gssi/Group) to ignore groups appearing as SSIs
                type_found = id_match.group(2)
                if type_found and "gssi" in type_found.lower():
                    return False
                
                is_reg = "register" in msg.lower() or "affiliate" in msg.lower() or "attach" in msg.lower()
                
                if id not in self.terminals:
                    self.terminals[id] = {"selected": "---", "groups": [], "status": "Online" if is_reg else "External", "is_local": is_reg, "last_seen": timestamp}
                
                if is_reg:
                    self.terminals[id]["is_local"] = True
                    self.terminals[id]["status"] = "Online"
                self.terminals[id]["last_seen"] = timestamp

                # BREITE SUCHE NACH DER GEWÄHLTEN GRUPPE (Selected TG)
                # Deckt ab: gssi=123, gssi: 123, gssi: Some(123), selected: 123, group: 123
                found_gssi = None
                patterns = [
                    r"selected(?:[\s_]*tg)?[:\s=]+(\d+)",
                    r"target[:\s=]+(\d+)",
                    r"dest(?:ination)?[:\s=]+(\d+)",
                    r"group[:\s=]+(\d+)"
                ]
                
                for p in patterns:
                    m = re.search(p, msg, re.I)
                    if m:
                        found_gssi = m.group(1)
                        break
                
                if found_gssi:
                    self.terminals[id]["selected"] = f"TG {found_gssi}"
                    if found_gssi not in self.terminals[id]["groups"]:
                        self.terminals[id]["groups"].append(found_gssi)
                        self.terminals[id]["groups"].sort()

                # Scanlist Extraktion (groups=[...])
                grps_match = re.search(r"groups=\[(.*?)\]", msg)
                if grps_match:
                    raw_grps = [g.strip() for g in grps_match.group(1).split(",") if g.strip()]
                    
                    is_deaffiliate = "deaffiliate" in msg.lower() or "detach" in msg.lower() 
                    
                    if is_deaffiliate:
                         # Remove from list
                        for g in raw_grps:
                            if g in self.terminals[id]["groups"]:
                                self.terminals[id]["groups"].remove(g)
                    else:
                        # Add to list
                        combined = set(self.terminals[id]["groups"]) | set(raw_grps)
                        self.terminals[id]["groups"] = sorted(list(combined))

                return True

            # --- 4. GROUP CHANGE (ATTACH/DETACH) - Fallback if Section 3 missed it ---
            # Also capture LocationUpdate which is the initial registration often containing the Selected TG
            if "AttachDetachGroupIdentity" in msg or "LocationUpdate" in msg:
                 # Search for Terminal ID locally
                id_match = re.search(r"\b(?:issi|ssi|subscriber)[:\s=]+(?:Some\()?(\d+)(?:[\),]*\s*,?\s*ssi_type[:\s=]+(\w+))?", msg, re.I)
                
                # Determine ID: Local match OR Context fallback
                current_id = None
                if id_match:
                    current_id = id_match.group(1)
                    # Vet it roughly here too, but mostly handled by global extraction
                
                if not current_id:
                    current_id = self.last_context_id

                if current_id in self.terminals:
                    # Parse Individual Group Identity Structs to handle mixed Attach/Detach events (e.g. Knob Turn Swap)
                    # Pattern captures the body of each GroupIdentityUplink or Downlink struct
                    # We rely on non-greedy match until the closing brace
                    structs = re.findall(r"GroupIdentity(?:Up|Down)link\s*\{(.*?)\}", msg)
                    
                    to_attach = []
                    to_detach = []
                    
                    # If regex simple finding failed (e.g. format change), fallback to previous global logic? 
                    # But if structs found, use them.
                    if structs:
                        for s in structs:
                            # Extract GSSI
                            g_match = re.search(r"\bgssi[:\s=]+(?:Some\()?(\d+)", s, re.I)
                            if g_match:
                                gssi = g_match.group(1)
                                # Check for Detachment (Some = Detach, None = Attach)
                                # Look for detachment_uplink or downlink
                                is_det = re.search(r"detachment_(?:up|down)link[:\s]+Some", s) is not None
                                
                                if is_det:
                                    to_detach.append(gssi)
                                else:
                                    to_attach.append(gssi)
                    else:
                        # Fallback for simple/other formats (e.g. just raw GSSI list without full blocks?)
                        # Assuming Attach if no structs detected but simple GSSI pattern is (unlikely given logs)
                        pass

                    current_groups = self.terminals[current_id]["groups"]
                    current_selected = self.terminals[current_id]["selected"] 
                    selected_gssi = current_selected.replace("TG ", "") if "TG " in current_selected else None

                    # Apply Detaches
                    for g in to_detach:
                        if g in current_groups:
                            current_groups.remove(g)
                            
                    # Apply Attaches
                    for g in to_attach:
                        if g not in current_groups:
                            current_groups.append(g)

                    # Update Selected Handling
                    if len(to_attach) == 1:
                        primary_gssi = to_attach[0]
                        if current_id != primary_gssi:
                            self.terminals[current_id]["selected"] = f"TG {primary_gssi}"
                            selected_gssi = primary_gssi # Update local var 
                            
                            # Knob Turn Heuristic:
                            # If we are adding exactly ONE group (Selection Change), and the scan list is essentially empty (<=1),
                            # we assume Scan is OFF and we should REPLACE the list to avoid accumulation.
                            # If the list is large (>1), we assume Scan is ON and we just append the new Selection.
                            if len(current_groups) <= 2 and len(to_detach) == 0: 
                                # Safety margin <= 2 (e.g. Old + New before cleanup, or just Old)
                                # Actually, if we just appended 'g' above, length increased.
                                # If it was 1 (Old), now 2 (Old, New). We want just [New].
                                # We should clear and set to [primary_gssi].
                                self.terminals[current_id]["groups"] = [primary_gssi]
                                current_groups = self.terminals[current_id]["groups"] # Update ref
                            elif primary_gssi not in current_groups:
                                current_groups.append(primary_gssi)
                    
                    # Ensure Selected is kept in list (User requirement: Only Selected remains on clear)
                    if selected_gssi and selected_gssi not in current_groups and selected_gssi != "---":
                         current_groups.append(selected_gssi)

                    self.terminals[current_id]["last_seen"] = timestamp
                    self.terminals[current_id]["groups"].sort()
                    return True
            
 


        except Exception: pass
        return False

    def generate_table(self, show_local):
        table = Table(expand=True, box=box.SIMPLE, header_style="bold cyan")
        table.add_column("T", width=2, justify="center")
        table.add_column("TERMINAL (CALL)", width=32)
        table.add_column("SELECTED", width=12, style="bold yellow")
        table.add_column("STATUS", width=10)
        table.add_column("SCANLIST", ratio=1)
        table.add_column("SEEN", width=10, justify="right")

        for id in sorted(self.terminals.keys()):
            t = self.terminals[id]
            if t["is_local"] != show_local: continue
            
            active = "[bold yellow]▶[/]" if id == self.last_active and t["status"] != "Offline" else ""
            st_map = {"Online": "[green]Online[/]", "Offline": "[red]Offline[/]", "External": "[orange1]External[/]"}
            call = self.get_callsign(id)
            id_display = f"[yellow]{id}[/] [bold white]({call})[/]" if call else f"[yellow]{id}[/]"
            
            sel_tg_num = t["selected"].replace("TG ", "")
            formatted_grps = []
            for g in t["groups"]:
                if g == sel_tg_num:
                    formatted_grps.append(f"[bold yellow][{g}][/]")
                else:
                    formatted_grps.append(g)
            
            scan_str = ", ".join(formatted_grps) if formatted_grps else "---"
            table.add_row(active, id_display, t["selected"], st_map.get(t["status"], t["status"]), scan_str, t["last_seen"])
        return table

def main():
    mon = TetraMonitor()
    layout = Layout()
    layout.split_column(Layout(name="h", size=3), Layout(name="m", ratio=1), Layout(name="f", size=MAX_HISTORY + 4))
    layout["m"].split_column(Layout(name="l"), Layout(name="e"))
    layout["f"].split_row(Layout(name="hl"), Layout(name="he"))

    proc = subprocess.Popen(JOURNAL_CMD, stdout=subprocess.PIPE, text=True, bufsize=1)
    with Live(layout, refresh_per_second=4, screen=True) as live:
        while True:
            r, _, _ = select.select([proc.stdout], [], [], 0.1) # Timeout 0.1s
            if r:
                line = proc.stdout.readline()
                if not line: break
                mon.process_line(line)
            
            # Update Header Clock constantly
            layout["h"].update(Panel(f"[bold white]📡 TETRA LIVE MONITOR[/] | {datetime.now().strftime('%H:%M:%S')}", style="on blue", box=box.SQUARE))
            layout["l"].update(Panel(mon.generate_table(True), title="[bold cyan]LOCAL TERMINALS[/]", border_style="cyan"))
            layout["e"].update(Panel(mon.generate_table(False), title="[bold orange1]EXTERNAL TERMINALS[/]", border_style="orange1"))
            layout["hl"].update(Panel("\n".join(mon.hist_local), title="LOCAL CALL HISTORY", border_style="cyan"))
            layout["he"].update(Panel("\n".join(mon.hist_ext), title="EXTERNAL CALL HISTORY", border_style="orange1"))

if __name__ == "__main__":
    main()
