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
RADIOID_API = "https://radioid.net/api/dmr/user/?id="

def emit(event_type, payload):
    """Send a JSON event to stdout for the Node.js server to pick up."""
    msg = json.dumps({"type": event_type, "payload": payload})
    sys.stdout.write(msg + "\n")
    sys.stdout.flush()


def _unpack_gsm7(data: bytes) -> str:
    """Unpack 7-bit GSM packed bytes into a string."""
    bits = 0
    num_bits = 0
    result = []
    for byte in data:
        bits |= (byte << num_bits)
        num_bits += 8
        while num_bits >= 7:
            result.append(bits & 0x7F)
            bits >>= 7
            num_bits -= 7
    return ''.join(chr(c) for c in result if c > 0)


def _try_decode_sds_text(byte_list: list) -> str | None:
    """
    Best-effort decode of TETRA SDS Type-4 payload bytes into readable text.
    Tries ISO-8859-1 and 7-bit GSM packed with various header skip lengths.
    Returns decoded text string or None if no readable content found.
    """
    if not byte_list:
        return None
    raw = bytes(byte_list)

    def is_readable(s: str, min_ratio: float = 0.65) -> bool:
        if not s or len(s) == 0:
            return False
        printable = sum(1 for c in s if c.isprintable() and ord(c) >= 32)
        return printable / len(s) >= min_ratio and printable >= 3

    def clean_text(s: str) -> str:
        """Replace newlines with spaces, keep other printable chars."""
        return ''.join(' ' if c in ('\n', '\r') else c for c in s if c in ('\n', '\r') or (c.isprintable() and ord(c) >= 32))

    # Try ISO-8859-1 decode with 0..4 leading bytes skipped (possible SDS-TL protocol headers)
    for skip in range(min(5, len(raw))):
        candidate = raw[skip:]
        if not candidate:
            continue
        try:
            decoded = candidate.decode('iso-8859-1')
            cleaned = clean_text(decoded)
            if is_readable(decoded) and cleaned.strip():
                return cleaned.strip()
        except Exception:
            pass

    # Try 7-bit GSM packed with 0..4 leading bytes skipped
    for skip in range(min(5, len(raw))):
        candidate = raw[skip:]
        if not candidate:
            continue
        try:
            decoded = _unpack_gsm7(candidate)
            cleaned = clean_text(decoded)
            if is_readable(decoded) and cleaned.strip():
                return cleaned.strip()
        except Exception:
            pass

    return None


class TetraMonitor:
    def __init__(self):
        self.terminals = {}
        self.hist_local = []
        self.hist_ext = []
        self.sds_messages = []
        self.last_active = None
        self.last_context_id = None
        self.callsign_cache = {}
        self.event_counter = 0
        self.sds_report_uuids = set()      # UUIDs of delivery reports to suppress
        self.sds_pending_ack = {}          # (dst, src) -> timestamp, for delivery-report filtering
        self.sds_content_pending = {}      # src_issi -> {type, content, ts} for text/LIP correlation

    def get_callsign(self, issi):
        if not issi or int(issi) < 1000:
            return ""
        if issi in self.callsign_cache:
            return self.callsign_cache[issi]
        if not HAS_REQUESTS:
            self.callsign_cache[issi] = ""
            return ""
        try:
            response = requests.get(f"{RADIOID_API}{issi}", timeout=4.0)
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
        """Update time slot on active terminals (same TG as last_active) and most recent history entry."""
        if not self.last_active or self.last_active not in self.terminals:
            return
        t = self.terminals[self.last_active]
        if not t.get("activity") or t.get("time_slot") == voice_ts:
            return
        active_tg = t.get("activity_tg")
        t["time_slot"] = voice_ts
        emit("update_terminal", self._terminal_to_dict(self.last_active))
        for tid, tt in self.terminals.items():
            if tid != self.last_active and tt.get("activity") == "RX" and str(tt.get("activity_tg")) == str(active_tg):
                if tt.get("time_slot") != voice_ts:
                    tt["time_slot"] = voice_ts
                    emit("update_terminal", self._terminal_to_dict(tid))
        for hist in [self.hist_local, self.hist_ext]:
            if hist and hist[0].get("sourceId") == self.last_active and hist[0].get("timeSlot") != voice_ts:
                hist[0]["timeSlot"] = voice_ts
                emit("update_call", hist[0])

    def _clear_activity(self, tg=None):
        """Clear TX/RX activity states. If tg is given, only clear terminals on that TG."""
        for tid, t in self.terminals.items():
            if t.get("activity"):
                if tg is not None and str(t.get("activity_tg")) != str(tg):
                    continue
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
            "externalHistory": self.hist_ext[-MAX_HISTORY:],
            "sdsMessages": self.sds_messages[-MAX_HISTORY:],
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

                self._clear_activity(tg=d_gssi)
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
                self._clear_activity(tg=gssi)
                if new_speaker in self.terminals:
                    self.terminals[new_speaker]["last_seen"] = timestamp
                    self._set_activity(new_speaker, gssi)
                return

            # 3. CALL END (GROUP_IDLE / D-TX CEASED / network call ended)
            if "GROUP_IDLE" in msg or "D-TX CEASED" in msg:
                gssi_m = re.search(r"\bgssi=(\d+)", msg)
                if not gssi_m:
                    gssi_m = re.search(r"\bgssi[:\s=]+(\d+)", msg, re.I)
                if gssi_m:
                    self._clear_activity(tg=gssi_m.group(1))
                else:
                    self._clear_activity()
                return

            if "network call ended" in msg:
                gssi_m = re.search(r"\bgssi=(\d+)", msg)
                if gssi_m:
                    self._clear_activity(tg=gssi_m.group(1))
                else:
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
                    self.terminals[ssi]["status"] = "Online"
                    prev = self.terminals[ssi].get("selected", "---")
                    if prev == "---" and to_detach:
                        self.terminals[ssi]["selected"] = f"TG {to_detach[0]}"
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

            # 8. SDS messages

            # --- Content lines stored for enriching next BrewEntity SDS entry ---

            # D-SDS-DATA: downlink SDS from network → radio, logged by bluestation CMCE layer.
            # Format: "-> D-SDS-DATA DSdsData { calling_party_address_ssi: Some(SSSI), ...,
            #           user_defined_data: Type4(N, [b0, b1, ...]) }"
            # The calling_party_address_ssi is the SENDER; bytes may encode text.
            dsds_match = re.search(
                r"D-SDS-DATA\s+DSdsData\s*\{.*?calling_party_address_ssi:\s*Some\((\d+)\)"
                r".*?user_defined_data:\s*Type4\(\d+,\s*\[([^\]]+)\]\)",
                msg, re.DOTALL
            )
            if dsds_match:
                src_i = dsds_match.group(1)
                try:
                    byte_list = [int(b.strip()) for b in dsds_match.group(2).split(",") if b.strip()]
                    text_val = _try_decode_sds_text(byte_list)
                    if text_val:
                        self.sds_content_pending[src_i] = {"type": "text", "content": text_val, "ts": time.time()}
                except Exception:
                    pass
                return

            # LIP / GPS: "SDS: LIP from ISSI X: lat=Y lon=Z [speed=N] [heading=N]"
            # (used in demo mode and some custom TETRA implementations)
            sds_lip_line = re.search(
                r"(?:SDS[:\s]+LIP|LIP)[:\s].*?(?:from\s+(?:ISSI\s+)?)?(\d{4,}).*?"
                r"lat=([\d.+\-]+).*?lon=([\d.+\-]+)"
                r"(?:.*?speed=([\d.]+))?(?:.*?heading=([\d.]+))?",
                msg, re.IGNORECASE
            )
            if sds_lip_line:
                src_i = sds_lip_line.group(1)
                lip_data = {
                    "lat": float(sds_lip_line.group(2)),
                    "lon": float(sds_lip_line.group(3)),
                }
                if sds_lip_line.group(4) is not None:
                    lip_data["speed"] = float(sds_lip_line.group(4))
                if sds_lip_line.group(5) is not None:
                    lip_data["heading"] = float(sds_lip_line.group(5))
                self.sds_content_pending[src_i] = {"type": "lip", "content": lip_data, "ts": time.time()}
                return

            # Delivery report UUID registration: BrewEntity: SDS_REPORT uuid=... status=N -> Brew
            # Secondary filter — UUID arrives in any order relative to SDS transfer
            sds_report = re.search(
                r"BrewEntity: SDS_REPORT\s+uuid=(\S+)\s+status=",
                msg
            )
            if sds_report:
                self.sds_report_uuids.add(sds_report.group(1))
                if len(self.sds_report_uuids) > 200:
                    self.sds_report_uuids = set(list(self.sds_report_uuids)[-100:])
                return

            # Outgoing: BrewEntity: sending SDS uuid=... src=X dst=Y type=N N bits
            sds_out = re.search(
                r"BrewEntity: sending SDS\s+uuid=(\S+)\s+src=(\d+)\s+dst=(\d+)\s+type=(\d+)\s+(\d+)\s+bits",
                msg
            )
            if sds_out:
                uuid_out, src, dst, sds_type, size = sds_out.groups()
                # Register (dst, src) so the delivery-report transfer back is suppressed
                self.sds_pending_ack[(dst, src)] = time.time()
                # Keep dict bounded; evict entries older than 30 s
                now = time.time()
                self.sds_pending_ack = {
                    k: v for k, v in self.sds_pending_ack.items() if now - v < 30
                }
                src_call = self.get_callsign(src)
                dst_call = self.get_callsign(dst)
                entry = {
                    "id": self._next_id(),
                    "timestamp": timestamp,
                    "srcIssi": src,
                    "srcCallsign": src_call,
                    "dstIssi": dst,
                    "dstCallsign": dst_call,
                    "direction": "outgoing",
                    "messageType": "data",
                    "sdsType": int(sds_type),
                    "size": int(size),
                    "sizeUnit": "bits",
                }
                # Attach pending text/LIP content if available for this src ISSI
                pending = self.sds_content_pending.pop(src, None)
                if pending and now - pending["ts"] < 5.0:
                    if pending["type"] == "text":
                        entry["textContent"] = pending["content"]
                    elif pending["type"] == "lip":
                        entry["lipData"] = pending["content"]
                # Evict stale pending content
                self.sds_content_pending = {
                    k: v for k, v in self.sds_content_pending.items() if now - v["ts"] < 10.0
                }
                self.sds_messages.insert(0, entry)
                self.sds_messages = self.sds_messages[:MAX_HISTORY]
                emit("sds_message", entry)
                return

            # Incoming: BrewEntity: SDS transfer uuid=... src=X dst=Y N bytes
            sds_in = re.search(
                r"BrewEntity: SDS transfer\s+uuid=(\S+)\s+src=(\d+)\s+dst=(\d+)\s+(\d+)\s+bytes",
                msg
            )
            if sds_in:
                uuid_val, src, dst, size = sds_in.groups()
                size_int = int(size)

                # Filter 1: UUID-based (SDS_REPORT arrived before this transfer)
                if uuid_val in self.sds_report_uuids:
                    self.sds_report_uuids.discard(uuid_val)
                    return

                # Filter 2: pair-based (SDS_REPORT arrived after, or UUID missed)
                # A delivery report is tiny (≤ 8 bytes) and the pair (src, dst) was
                # registered when we emitted the matching outgoing message.
                pair_key = (src, dst)
                if size_int <= 8 and pair_key in self.sds_pending_ack:
                    del self.sds_pending_ack[pair_key]
                    return

                src_call = self.get_callsign(src)
                dst_call = self.get_callsign(dst)
                entry = {
                    "id": self._next_id(),
                    "timestamp": timestamp,
                    "srcIssi": src,
                    "srcCallsign": src_call,
                    "dstIssi": dst,
                    "dstCallsign": dst_call,
                    "direction": "incoming",
                    "messageType": "data",
                    "sdsType": 3,
                    "size": size_int,
                    "sizeUnit": "bytes",
                }
                # Attach pending text/LIP content if available for this src ISSI
                now = time.time()
                pending = self.sds_content_pending.pop(src, None)
                if pending and now - pending["ts"] < 5.0:
                    if pending["type"] == "text":
                        entry["textContent"] = pending["content"]
                    elif pending["type"] == "lip":
                        entry["lipData"] = pending["content"]
                self.sds_content_pending = {
                    k: v for k, v in self.sds_content_pending.items() if now - v["ts"] < 10.0
                }
                self.sds_messages.insert(0, entry)
                self.sds_messages = self.sds_messages[:MAX_HISTORY]
                emit("sds_message", entry)
                return

            # Status message: SDS: U-STATUS from ISSI X to ISSI Y, status=Z
            sds_status = re.search(
                r"SDS: U-STATUS from ISSI\s+(\d+)\s+to ISSI\s+(\d+),\s+status=(.+)",
                msg
            )
            if sds_status:
                src, dst, status_code = sds_status.groups()
                status_code = status_code.strip()
                src_call = self.get_callsign(src)
                dst_call = self.get_callsign(dst)
                entry = {
                    "id": self._next_id(),
                    "timestamp": timestamp,
                    "srcIssi": src,
                    "srcCallsign": src_call,
                    "dstIssi": dst,
                    "dstCallsign": dst_call,
                    "direction": "outgoing",
                    "messageType": "status",
                    "statusCode": status_code,
                    "sdsType": 0,
                    "size": 0,
                    "sizeUnit": "bits",
                }
                self.sds_messages.insert(0, entry)
                self.sds_messages = self.sds_messages[:MAX_HISTORY]
                emit("sds_message", entry)
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

    used_slots = set()

    while True:
        time.sleep(random.uniform(2.0, 5.0))

        concurrent = random.random() < 0.35
        num_calls = 2 if concurrent else 1

        available_slots = [s for s in [1, 2, 3, 4] if s not in used_slots]
        if not available_slots:
            available_slots = [1, 2, 3, 4]
        used_slots.clear()

        mon._clear_activity()

        external = [d for d in demo_terminals if not d["local"]]
        chosen = random.sample(external, min(num_calls, len(external)))

        for i, dt in enumerate(chosen):
            tg = tgs[i % len(tgs)] if num_calls > 1 else random.choice(tgs)
            demo_ts = available_slots[i] if i < len(available_slots) else random.choice([1, 2, 3, 4])
            used_slots.add(demo_ts)

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

        # ~20% chance of an SDS data message each cycle
        if random.random() < 0.20:
            sds_terminals = [d for d in demo_terminals if d["issi"] != "2145007"]
            if len(sds_terminals) >= 2:
                src_t, dst_t = random.sample(sds_terminals, 2)
                direction = random.choice(["outgoing", "incoming"])
                content_roll = random.random()
                ts_us = str(int(time.time() * 1000000))

                # ~40% text SDS, ~30% GPS/LIP, ~30% raw data
                if content_roll < 0.40:
                    demo_texts = [
                        "73 de EA5GVK", "En camino al repetidor", "QTH Valencia",
                        "Frecuencia OK", "Llegando en 10 min", "Todo correcto",
                        "Hello from Madrid", "QSL 73", "On my way",
                        "Radar check OK", "Saliendo de la base", "At destination",
                        "Need assistance", "All clear", "Position confirmed",
                    ]
                    text_msg = random.choice(demo_texts)
                    # Encode text as ISO-8859-1 bytes with a 4-byte SDS-TL header (0x82, 0x04, 0x10, 0x01)
                    sds_header = [0x82, 0x04, 0x10, 0x01]
                    text_bytes = sds_header + list(text_msg.encode("iso-8859-1"))
                    bytes_str = ", ".join(str(b) for b in text_bytes)
                    bit_count = len(text_bytes) * 8
                    # Emit D-SDS-DATA with calling_party_address_ssi = sender (src_t for demo)
                    content_line = json.dumps({
                        "MESSAGE": (
                            f"DEBUG [entities/cmce] sds_bs.rs:288:      "
                            f"-> D-SDS-DATA DSdsData {{ calling_party_type_identifier: Ssi, "
                            f"calling_party_address_ssi: Some({src_t['issi']}), "
                            f"calling_party_extension: None, "
                            f"user_defined_data: Type4({bit_count}, [{bytes_str}]), "
                            f"external_subscriber_number: None, dm_ms_address: None }}"
                        ),
                        "__REALTIME_TIMESTAMP": ts_us
                    })
                    mon.process_line(content_line)
                    size = bit_count
                    if direction == "outgoing":
                        brew_line = json.dumps({
                            "MESSAGE": f"BrewEntity: sending SDS uuid=demo-{int(time.time())} src={src_t['issi']} dst={dst_t['issi']} type=3 {size} bits",
                            "__REALTIME_TIMESTAMP": ts_us
                        })
                    else:
                        brew_line = json.dumps({
                            "MESSAGE": f"BrewEntity: SDS transfer uuid=demo-{int(time.time())} src={src_t['issi']} dst={dst_t['issi']} {len(text_bytes)} bytes",
                            "__REALTIME_TIMESTAMP": ts_us
                        })
                    mon.process_line(brew_line)

                elif content_roll < 0.70:
                    # GPS / LIP
                    lat = round(random.uniform(36.0, 43.5), 6)
                    lon = round(random.uniform(-9.0, 4.0), 6)
                    speed = random.randint(0, 120)
                    heading = random.randint(0, 359)
                    lip_line = json.dumps({
                        "MESSAGE": f"SDS: LIP from ISSI {src_t['issi']}: lat={lat} lon={lon} speed={speed} heading={heading}",
                        "__REALTIME_TIMESTAMP": ts_us
                    })
                    mon.process_line(lip_line)
                    if direction == "outgoing":
                        brew_line = json.dumps({
                            "MESSAGE": f"BrewEntity: sending SDS uuid=demo-{int(time.time())} src={src_t['issi']} dst={dst_t['issi']} type=10 32 bits",
                            "__REALTIME_TIMESTAMP": ts_us
                        })
                    else:
                        brew_line = json.dumps({
                            "MESSAGE": f"BrewEntity: SDS transfer uuid=demo-{int(time.time())} src={src_t['issi']} dst={dst_t['issi']} 17 bytes",
                            "__REALTIME_TIMESTAMP": ts_us
                        })
                    mon.process_line(brew_line)

                else:
                    # Raw data (no content)
                    if direction == "outgoing":
                        size = random.choice([32, 64, 128, 256])
                        sds_line = json.dumps({
                            "MESSAGE": f"BrewEntity: sending SDS uuid=demo-{int(time.time())} src={src_t['issi']} dst={dst_t['issi']} type=3 {size} bits",
                            "__REALTIME_TIMESTAMP": ts_us
                        })
                    else:
                        size = random.choice([10, 20, 40, 82])
                        sds_line = json.dumps({
                            "MESSAGE": f"BrewEntity: SDS transfer uuid=demo-{int(time.time())} src={src_t['issi']} dst={dst_t['issi']} {size} bytes",
                            "__REALTIME_TIMESTAMP": ts_us
                        })
                    mon.process_line(sds_line)

        # ~10% chance of an SDS status message each cycle
        if random.random() < 0.10:
            all_terminals = demo_terminals
            if len(all_terminals) >= 2:
                src_t, dst_t = random.sample(all_terminals, 2)
                status_codes = [
                    "NetworkUserSpecific(61000)",
                    "NetworkUserSpecific(61001)",
                    "NetworkUserSpecific(62000)",
                    "EmergencyAlert",
                    "Acknowledge",
                    "Called party busy",
                ]
                status_code = random.choice(status_codes)
                status_line = json.dumps({
                    "MESSAGE": f"SDS: U-STATUS from ISSI {src_t['issi']} to ISSI {dst_t['issi']}, status={status_code}",
                    "__REALTIME_TIMESTAMP": str(int(time.time() * 1000000))
                })
                mon.process_line(status_line)


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
