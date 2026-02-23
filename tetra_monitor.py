#!/usr/bin/env python3
"""
TETRA Monitor - Backend processor.
Processes TETRA logs from journalctl (or runs in demo mode)
and outputs JSON events to stdout for the Node.js relay server.
"""
import json
import subprocess
import time
import sys
import re
import os
import select
import random
from datetime import datetime

try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False

JOURNAL_CMD = ["journalctl", "-f", "-o", "json"]
MAX_HISTORY = 50
RADIOID_API = "https://database.radioid.net/api/dmr/user/?id="

def emit(event_type, payload):
    """Send a JSON event to stdout for the Node.js server to pick up."""
    msg = json.dumps({"type": event_type, "payload": payload})
    sys.stdout.write(msg + "\n")
    sys.stdout.flush()

class TetraMonitor:
    def __init__(self):
        self.terminals = {}
        self.hist_local = []
        self.hist_ext = []
        self.last_active = None
        self.last_context_id = None
        self.callsign_cache = {}
        self.event_counter = 0

    def get_callsign(self, issi):
        if not issi or int(issi) < 1000:
            return ""
        if issi in self.callsign_cache:
            return self.callsign_cache[issi]
        if not HAS_REQUESTS:
            self.callsign_cache[issi] = ""
            return ""
        try:
            response = requests.get(f"{RADIOID_API}{issi}", timeout=1.0)
            if response.status_code == 200:
                data = response.json()
                call = ""
                if isinstance(data, dict):
                    if "callsign" in data:
                        call = data["callsign"]
                    elif "results" in data and len(data["results"]) > 0:
                        call = data["results"][0].get("callsign", "")
                if call:
                    self.callsign_cache[issi] = str(call).upper()
                    return self.callsign_cache[issi]
        except Exception:
            pass
        self.callsign_cache[issi] = ""
        return ""

    def _next_id(self):
        self.event_counter += 1
        return str(self.event_counter)

    def _terminal_to_dict(self, tid):
        t = self.terminals[tid]
        return {
            "id": tid,
            "callsign": self.get_callsign(tid),
            "status": t["status"],
            "selectedTg": t["selected"],
            "groups": t["groups"],
            "lastSeen": t["last_seen"],
            "isLocal": t["is_local"],
            "isActive": tid == self.last_active and t["status"] != "Offline",
            "activity": t.get("activity", None),
            "activityTg": t.get("activity_tg", None),
        }

    def _set_activity(self, s_issi, d_gssi):
        """Set TX on source, RX on all terminals listening on same TG."""
        self.terminals[s_issi]["activity"] = "TX"
        self.terminals[s_issi]["activity_tg"] = d_gssi
        emit("update_terminal", self._terminal_to_dict(s_issi))

        for tid, t in self.terminals.items():
            if tid == s_issi:
                continue
            if d_gssi in t["groups"] or t["selected"] == f"TG {d_gssi}":
                t["activity"] = "RX"
                t["activity_tg"] = d_gssi
                emit("update_terminal", self._terminal_to_dict(tid))

    def _clear_activity(self):
        """Clear all TX/RX activity states."""
        for tid, t in self.terminals.items():
            if t.get("activity"):
                t["activity"] = None
                t["activity_tg"] = None
                emit("update_terminal", self._terminal_to_dict(tid))

    def emit_full_state(self):
        terminals = {}
        for tid in self.terminals:
            terminals[tid] = self._terminal_to_dict(tid)
        emit("full_state", {
            "terminals": terminals,
            "localHistory": self.hist_local[-MAX_HISTORY:],
            "externalHistory": self.hist_ext[-MAX_HISTORY:]
        })

    def process_line(self, line):
        try:
            data = json.loads(line)
            msg_raw = data.get("MESSAGE", "")
            msg = "".join(chr(x) for x in msg_raw) if isinstance(msg_raw, list) else msg_raw
            msg = re.sub(r'\x1b\[[0-9;]*m', '', msg)
            ts = int(data.get("__REALTIME_TIMESTAMP", time.time() * 1000000)) / 1000000
            timestamp = datetime.fromtimestamp(ts).strftime("%H:%M:%S")

            global_id = None
            id_match = re.search(
                r"\b(?:issi|ssi|subscriber)[:\s=]+(?:Some\()?(\d+)(?:[\),]*\s*,?\s*ssi_type[:\s=]+(\w+))?",
                msg, re.I
            )
            if id_match:
                found_id = id_match.group(1)
                type_found = id_match.group(2)
                if not (type_found and "gssi" in type_found.lower()):
                    global_id = found_id
                    self.last_context_id = global_id

            # 1. DEREGISTER
            if "deregister" in msg.lower():
                target_id = global_id
                if not target_id:
                    det = re.search(r"\b(?:issi|ssi|subscriber)[:\s=]+(?:Some\()?(\d+)", msg, re.I)
                    if det:
                        target_id = det.group(1)
                if target_id and target_id in self.terminals:
                    self.terminals[target_id]["status"] = "Offline"
                    self.terminals[target_id]["selected"] = "---"
                    self.terminals[target_id]["activity"] = None
                    self.terminals[target_id]["activity_tg"] = None
                    emit("update_terminal", self._terminal_to_dict(target_id))
                return

            # 2. CALLS & TRANSMISSIONS
            call_match = re.search(r"(?:call from ISSI|src=)\s*(\d+).*?(?:to GSSI|dst=)\s*(\d+)", msg, re.I)
            if call_match:
                s_issi, d_gssi = call_match.groups()
                self.last_active = s_issi
                if s_issi not in self.terminals:
                    self.terminals[s_issi] = {
                        "selected": f"TG {d_gssi}",
                        "groups": [d_gssi],
                        "status": "External",
                        "is_local": False,
                        "last_seen": timestamp,
                        "activity": None,
                        "activity_tg": None,
                    }
                else:
                    self.terminals[s_issi]["selected"] = f"TG {d_gssi}"
                    self.terminals[s_issi]["last_seen"] = timestamp
                    if d_gssi not in self.terminals[s_issi]["groups"]:
                        self.terminals[s_issi]["groups"].append(d_gssi)

                call = self.get_callsign(s_issi)
                display_name = f"{s_issi} ({call})" if call else s_issi
                entry = {
                    "id": self._next_id(),
                    "timestamp": timestamp,
                    "sourceId": s_issi,
                    "sourceCallsign": call,
                    "targetTg": d_gssi,
                    "display": f"[{timestamp}] {display_name} -> TG {d_gssi}",
                    "isLocal": self.terminals[s_issi]["is_local"],
                    "activity": "TX",
                }

                if self.terminals[s_issi]["is_local"]:
                    self.hist_local.insert(0, entry)
                    self.hist_local = self.hist_local[:MAX_HISTORY]
                else:
                    self.hist_ext.insert(0, entry)
                    self.hist_ext = self.hist_ext[:MAX_HISTORY]

                self._clear_activity()
                self._set_activity(s_issi, d_gssi)
                emit("new_call", entry)
                return

            # 3. REGISTER & DEEP GSSI RECOVERY
            if id_match:
                tid = id_match.group(1)
                type_found = id_match.group(2)
                if type_found and "gssi" in type_found.lower():
                    return

                is_reg = bool(re.search(r"register|affiliate|attach", msg, re.I))

                if tid not in self.terminals:
                    self.terminals[tid] = {
                        "selected": "---",
                        "groups": [],
                        "status": "Online" if is_reg else "External",
                        "is_local": is_reg,
                        "last_seen": timestamp,
                        "activity": None,
                        "activity_tg": None,
                    }
                if is_reg:
                    self.terminals[tid]["is_local"] = True
                    self.terminals[tid]["status"] = "Online"
                self.terminals[tid]["last_seen"] = timestamp

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
                    self.terminals[tid]["selected"] = f"TG {found_gssi}"
                    if found_gssi not in self.terminals[tid]["groups"]:
                        self.terminals[tid]["groups"].append(found_gssi)
                        self.terminals[tid]["groups"].sort()

                grps_match = re.search(r"groups=\[(.*?)\]", msg)
                if grps_match:
                    raw_grps = [g.strip() for g in grps_match.group(1).split(",") if g.strip()]
                    is_deaffiliate = "deaffiliate" in msg.lower() or "detach" in msg.lower()
                    if is_deaffiliate:
                        for g in raw_grps:
                            if g in self.terminals[tid]["groups"]:
                                self.terminals[tid]["groups"].remove(g)
                        if not self.terminals[tid]["groups"]:
                            self.terminals[tid]["status"] = "Offline"
                            self.terminals[tid]["selected"] = "---"
                            self.terminals[tid]["activity"] = None
                            self.terminals[tid]["activity_tg"] = None
                    else:
                        combined = set(self.terminals[tid]["groups"]) | set(raw_grps)
                        self.terminals[tid]["groups"] = sorted(list(combined))

                emit("update_terminal", self._terminal_to_dict(tid))
                return

            # 4. GROUP CHANGE (ATTACH/DETACH)
            if "AttachDetachGroupIdentity" in msg or "LocationUpdate" in msg:
                id_m = re.search(
                    r"\b(?:issi|ssi|subscriber)[:\s=]+(?:Some\()?(\d+)(?:[\),]*\s*,?\s*ssi_type[:\s=]+(\w+))?",
                    msg, re.I
                )
                current_id = id_m.group(1) if id_m else self.last_context_id

                if current_id and current_id in self.terminals:
                    structs = re.findall(r"GroupIdentity(?:Up|Down)link\s*\{(.*?)\}", msg)
                    to_attach = []
                    to_detach = []

                    if structs:
                        for s in structs:
                            g_match = re.search(r"\bgssi[:\s=]+(?:Some\()?(\d+)", s, re.I)
                            if g_match:
                                gssi = g_match.group(1)
                                is_det = re.search(r"detachment_(?:up|down)link[:\s]+Some", s) is not None
                                if is_det:
                                    to_detach.append(gssi)
                                else:
                                    to_attach.append(gssi)

                    current_groups = self.terminals[current_id]["groups"]
                    current_selected = self.terminals[current_id]["selected"]
                    selected_gssi = current_selected.replace("TG ", "") if "TG " in current_selected else None

                    for g in to_detach:
                        if g in current_groups:
                            current_groups.remove(g)
                    for g in to_attach:
                        if g not in current_groups:
                            current_groups.append(g)

                    if to_detach and not to_attach and not current_groups:
                        self.terminals[current_id]["status"] = "Offline"
                        self.terminals[current_id]["selected"] = "---"
                        self.terminals[current_id]["activity"] = None
                        self.terminals[current_id]["activity_tg"] = None

                    if len(to_attach) == 1:
                        primary_gssi = to_attach[0]
                        if current_id != primary_gssi:
                            self.terminals[current_id]["selected"] = f"TG {primary_gssi}"
                            selected_gssi = primary_gssi
                            if len(current_groups) <= 2 and len(to_detach) == 0:
                                self.terminals[current_id]["groups"] = [primary_gssi]
                                current_groups = self.terminals[current_id]["groups"]
                            elif primary_gssi not in current_groups:
                                current_groups.append(primary_gssi)

                    if selected_gssi and selected_gssi not in current_groups and selected_gssi != "---":
                        current_groups.append(selected_gssi)

                    self.terminals[current_id]["last_seen"] = datetime.now().strftime("%H:%M:%S")
                    self.terminals[current_id]["groups"].sort()
                    emit("update_terminal", self._terminal_to_dict(current_id))

        except Exception:
            pass


def run_demo_mode(mon):
    """Simulate TETRA traffic for demo/testing."""
    demo_terminals = [
        {"issi": "2145007", "call": "EA5GVK", "local": True},
        {"issi": "3020760", "call": "VO1TR", "local": False},
        {"issi": "3161484", "call": "K3GLS", "local": False},
        {"issi": "3211213", "call": "N8EPF", "local": False},
        {"issi": "3214363", "call": "KD2FNL", "local": False},
        {"issi": "3221095", "call": "KF0VST", "local": False},
        {"issi": "3222074", "call": "K0SAV", "local": False},
        {"issi": "4100038", "call": "AP2AN", "local": False},
        {"issi": "4220074", "call": "A41MK", "local": False},
        {"issi": "4220120", "call": "A41SM", "local": False},
    ]
    tgs = ["91", "262", "1", "10"]

    for dt in demo_terminals:
        mon.callsign_cache[dt["issi"]] = dt["call"]
        status = "Online" if dt["local"] else "External"
        initial_tg = random.choice(tgs)
        mon.terminals[dt["issi"]] = {
            "selected": f"TG {initial_tg}",
            "groups": [initial_tg],
            "status": status,
            "is_local": dt["local"],
            "last_seen": datetime.now().strftime("%H:%M:%S"),
            "activity": None,
            "activity_tg": None,
        }

    mon.terminals["2145007"]["status"] = "Offline"
    mon.terminals["2145007"]["selected"] = "---"
    mon.terminals["2145007"]["groups"] = []

    mon.emit_full_state()

    while True:
        time.sleep(random.uniform(2.0, 5.0))
        mon._clear_activity()
        dt = random.choice([d for d in demo_terminals if not d["local"]])
        tg = random.choice(tgs)
        line = json.dumps({
            "MESSAGE": f"call from ISSI {dt['issi']} to GSSI {tg}",
            "__REALTIME_TIMESTAMP": str(int(time.time() * 1000000))
        })
        mon.process_line(line)


def run_journal_mode(mon):
    """Read real TETRA logs from journalctl."""
    proc = subprocess.Popen(JOURNAL_CMD, stdout=subprocess.PIPE, text=True, bufsize=1)
    mon.emit_full_state()

    while True:
        r, _, _ = select.select([proc.stdout], [], [], 0.25)
        if r:
            line = proc.stdout.readline()
            if not line:
                break
            mon.process_line(line.strip())


def main():
    mon = TetraMonitor()

    use_journal = True
    try:
        result = subprocess.run(["which", "journalctl"], capture_output=True, text=True)
        if result.returncode != 0:
            use_journal = False
    except Exception:
        use_journal = False

    if os.environ.get("TETRA_DEMO", "0") == "1":
        use_journal = False

    emit("status", {"mode": "journal" if use_journal else "demo"})

    if use_journal:
        run_journal_mode(mon)
    else:
        run_demo_mode(mon)


if __name__ == "__main__":
    main()
