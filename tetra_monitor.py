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
            "timeSlot": t.get("time_slot", None),
        }

    def _set_activity(self, s_issi, d_gssi, time_slot=None):
        """Set TX on source, RX on all terminals listening on same TG."""
        self.terminals[s_issi]["activity"] = "TX"
        self.terminals[s_issi]["activity_tg"] = d_gssi
        if time_slot is not None:
            self.terminals[s_issi]["time_slot"] = time_slot
        emit("update_terminal", self._terminal_to_dict(s_issi))

        for tid, t in self.terminals.items():
            if tid == s_issi:
                continue
            if d_gssi in t["groups"] or t["selected"] == f"TG {d_gssi}":
                t["activity"] = "RX"
                t["activity_tg"] = d_gssi
                if time_slot is not None:
                    t["time_slot"] = time_slot
                emit("update_terminal", self._terminal_to_dict(tid))

    def _update_time_slot(self, voice_ts):
        """Update time slot on active terminals and most recent history entry."""
        if not self.last_active or self.last_active not in self.terminals:
            return
        t = self.terminals[self.last_active]
        if not t.get("activity") or t.get("time_slot") == voice_ts:
            return
        t["time_slot"] = voice_ts
        emit("update_terminal", self._terminal_to_dict(self.last_active))
        for tid, tt in self.terminals.items():
            if tid != self.last_active and tt.get("activity") == "RX":
                if tt.get("time_slot") != voice_ts:
                    tt["time_slot"] = voice_ts
                    emit("update_terminal", self._terminal_to_dict(tid))
        for hist in [self.hist_local, self.hist_ext]:
            if hist and hist[0].get("sourceId") == self.last_active and hist[0].get("timeSlot") != voice_ts:
                hist[0]["timeSlot"] = voice_ts
                emit("update_call", hist[0])

    def _clear_activity(self):
        """Clear all TX/RX activity states."""
        for tid, t in self.terminals.items():
            if t.get("activity"):
                t["activity"] = None
                t["activity_tg"] = None
                t["time_slot"] = None
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

    def _extract_ssi(self, msg):
        m = re.search(
            r"received_address:\s*TetraAddress\s*\{\s*ssi:\s*(\d+),\s*ssi_type:\s*Ssi",
            msg
        )
        if m:
            return m.group(1)
        m = re.search(
            r"\bssi:\s*(?:Some\()?(\d+)\)?,\s*ssi_type:\s*Ssi",
            msg
        )
        if m:
            return m.group(1)
        return None

    def _extract_gssi_list(self, msg):
        groups = []
        for m in re.finditer(r"GroupIdentityUplink\s*\{([^}]+)\}", msg):
            block = m.group(1)
            g = re.search(r"\bgssi:\s*Some\((\d+)\)", block)
            if g:
                det = re.search(r"group_identity_detachment_uplink:\s*Some", block)
                groups.append((g.group(1), bool(det)))
        return groups

    def process_line(self, line):
        try:
            data = json.loads(line)
            msg_raw = data.get("MESSAGE", "")
            msg = "".join(chr(x) for x in msg_raw) if isinstance(msg_raw, list) else msg_raw
            msg = re.sub(r'\x1b\[[0-9;]*m', '', msg)
            ts = int(data.get("__REALTIME_TIMESTAMP", time.time() * 1000000)) / 1000000
            timestamp = datetime.fromtimestamp(ts).strftime("%H:%M:%S")

            context_ssi = self._extract_ssi(msg)
            if context_ssi:
                self.last_context_id = context_ssi

            # 1. CALLS (GROUP_TX from BrewWorker)
            call_match = re.search(r"GROUP_TX\s+.*?src=(\d+)\s+dst=(\d+)", msg)
            if not call_match:
                call_match = re.search(r"call from ISSI\s*(\d+).*?to GSSI\s*(\d+)", msg, re.I)
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
                call_ts = self.terminals[s_issi].get("time_slot", None)
                entry = {
                    "id": self._next_id(),
                    "timestamp": timestamp,
                    "sourceId": s_issi,
                    "sourceCallsign": call,
                    "targetTg": d_gssi,
                    "display": f"[{timestamp}] {display_name} -> TG {d_gssi}",
                    "isLocal": self.terminals[s_issi]["is_local"],
                    "activity": "TX",
                    "timeSlot": call_ts,
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

            # 1b. VOICE FRAME (BrewEntity: voice frame ... ts=N)
            voice_match = re.search(r"voice frame\s+#\d+.*?\bts=(\d+)", msg)
            if voice_match:
                voice_ts = int(voice_match.group(1))
                self._update_time_slot(voice_ts)
                return

            # 1c. ts_assigned from ChanAllocElement (only during active call)
            if self.last_active and self.last_active in self.terminals and self.terminals[self.last_active].get("activity"):
                ts_assigned = re.search(r"ts_assigned:\s*\[([^\]]+)\]", msg)
                if ts_assigned:
                    slots = [s.strip().lower() == "true" for s in ts_assigned.group(1).split(",")]
                    for idx, val in enumerate(slots):
                        if val:
                            self._update_time_slot(idx + 1)
                            break

            # 2. SPEAKER CHANGE
            speaker_match = re.search(
                r"speaker change gssi=(\d+)\s+new_speaker=(\d+)",
                msg
            )
            if speaker_match:
                gssi, new_speaker = speaker_match.groups()
                self._clear_activity()
                if new_speaker in self.terminals:
                    self.terminals[new_speaker]["last_seen"] = timestamp
                    self._set_activity(new_speaker, gssi)
                return

            # 3. CALL END (GROUP_IDLE / D-TX CEASED / network call ended)
            if "GROUP_IDLE" in msg or "D-TX CEASED" in msg:
                self._clear_activity()
                gssi_m = re.search(r"\bgssi=(\d+)", msg)
                if not gssi_m:
                    gssi_m = re.search(r"\bgssi[:\s=]+(\d+)", msg, re.I)
                return

            if "network call ended" in msg:
                self._clear_activity()
                return

            # 4. REGISTRATION (ULocationUpdateDemand / ItsiAttach)
            if "ULocationUpdateDemand" in msg:
                ssi = self._extract_ssi(msg)
                if not ssi:
                    ssi = self.last_context_id
                if not ssi:
                    return

                loc_type_m = re.search(r"location_update_type:\s*(\w+)", msg)
                loc_type = loc_type_m.group(1) if loc_type_m else ""

                if "Detach" in loc_type:
                    if ssi in self.terminals:
                        self.terminals[ssi]["status"] = "Offline"
                        self.terminals[ssi]["selected"] = "---"
                        self.terminals[ssi]["groups"] = []
                        self.terminals[ssi]["activity"] = None
                        self.terminals[ssi]["activity_tg"] = None
                        emit("update_terminal", self._terminal_to_dict(ssi))
                    return

                if ssi not in self.terminals:
                    self.terminals[ssi] = {
                        "selected": "---",
                        "groups": [],
                        "status": "Online",
                        "is_local": True,
                        "last_seen": timestamp,
                        "activity": None,
                        "activity_tg": None,
                    }
                self.terminals[ssi]["status"] = "Online"
                self.terminals[ssi]["is_local"] = True
                self.terminals[ssi]["last_seen"] = timestamp

                gssi_entries = self._extract_gssi_list(msg)
                for gssi, is_detach in gssi_entries:
                    if not is_detach:
                        if gssi not in self.terminals[ssi]["groups"]:
                            self.terminals[ssi]["groups"].append(gssi)
                        if self.terminals[ssi]["selected"] == "---":
                            self.terminals[ssi]["selected"] = f"TG {gssi}"

                self.terminals[ssi]["groups"].sort()
                emit("update_terminal", self._terminal_to_dict(ssi))
                return

            # 4b. SUBSCRIBER AFFILIATE (scan mode groups)
            affiliate_match = re.search(r"subscriber affiliate issi=(\d+)\s+groups=\[([^\]]*)\]", msg)
            if affiliate_match:
                ssi = affiliate_match.group(1)
                groups_str = affiliate_match.group(2).strip()
                new_groups = [g.strip() for g in groups_str.split(",") if g.strip()] if groups_str else []

                if ssi not in self.terminals:
                    self.terminals[ssi] = {
                        "selected": "---",
                        "groups": [],
                        "status": "Online",
                        "is_local": True,
                        "last_seen": timestamp,
                        "activity": None,
                        "activity_tg": None,
                    }

                self.terminals[ssi]["groups"] = sorted(new_groups)
                self.terminals[ssi]["status"] = "Online"
                self.terminals[ssi]["is_local"] = True
                self.terminals[ssi]["last_seen"] = timestamp
                if new_groups:
                    self.terminals[ssi]["selected"] = f"TG {new_groups[0]}"

                emit("update_terminal", self._terminal_to_dict(ssi))
                return

            # 5. GROUP ATTACH/DETACH (UAttachDetachGroupIdentity)
            if "UAttachDetachGroupIdentity" in msg:
                ssi = self._extract_ssi(msg)
                if not ssi:
                    ssi = self.last_context_id
                if not ssi:
                    return

                if ssi not in self.terminals:
                    self.terminals[ssi] = {
                        "selected": "---",
                        "groups": [],
                        "status": "Online",
                        "is_local": True,
                        "last_seen": timestamp,
                        "activity": None,
                        "activity_tg": None,
                    }

                gssi_entries = self._extract_gssi_list(msg)
                to_attach = [g for g, det in gssi_entries if not det]
                to_detach = [g for g, det in gssi_entries if det]

                current_groups = self.terminals[ssi]["groups"]
                for g in to_detach:
                    if g in current_groups:
                        current_groups.remove(g)
                for g in to_attach:
                    if g not in current_groups:
                        current_groups.append(g)

                if to_detach and not to_attach and not current_groups:
                    self.terminals[ssi]["status"] = "Offline"
                    self.terminals[ssi]["selected"] = "---"
                    self.terminals[ssi]["activity"] = None
                    self.terminals[ssi]["activity_tg"] = None
                elif to_attach:
                    self.terminals[ssi]["selected"] = f"TG {to_attach[0]}"
                    self.terminals[ssi]["status"] = "Online"

                self.terminals[ssi]["last_seen"] = timestamp
                self.terminals[ssi]["groups"].sort()
                emit("update_terminal", self._terminal_to_dict(ssi))
                return

            # 6. DEREGISTER (UItsiDetach / explicit deregister)
            if "UItsiDetach" in msg or "ItsiDetach" in msg or "deregister" in msg.lower():
                ssi = self._extract_ssi(msg)
                if not ssi:
                    m = re.search(r"received_address:\s*TetraAddress\s*\{[^}]*ssi:\s*(\d+)", msg)
                    if not m:
                        m = re.search(r"\b(?:issi|ssi)[:\s=]+(?:Some\()?(\d+)", msg, re.I)
                    if m:
                        ssi = m.group(1)
                if not ssi:
                    ssi = self.last_context_id
                if ssi and ssi in self.terminals:
                    self.terminals[ssi]["status"] = "Offline"
                    self.terminals[ssi]["selected"] = "---"
                    self.terminals[ssi]["groups"] = []
                    self.terminals[ssi]["activity"] = None
                    self.terminals[ssi]["activity_tg"] = None
                    emit("update_terminal", self._terminal_to_dict(ssi))
                return

            # 7. BrewWorker affiliated groups (BS own groups, informational)
            brew_groups = re.search(r"affiliated to groups \[([^\]]*)\]", msg)
            if brew_groups:
                return

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
        demo_ts = random.choice([1, 2, 3, 4])
        line = json.dumps({
            "MESSAGE": f"call from ISSI {dt['issi']} to GSSI {tg}",
            "__REALTIME_TIMESTAMP": str(int(time.time() * 1000000))
        })
        mon.process_line(line)
        voice_line = json.dumps({
            "MESSAGE": f"BrewEntity: voice frame #1 uuid=demo len=36 bytes ts={demo_ts}",
            "__REALTIME_TIMESTAMP": str(int(time.time() * 1000000))
        })
        mon.process_line(voice_line)


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
