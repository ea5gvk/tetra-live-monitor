package com.ea5gvk.tetralivemonitor.net

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * TetraApi.decodeTier2 against the answers of GET /api/dmr/tier2/state (server/dmrTier2.ts). A capture of a real
 * panel is checked too when TIER2_JSON names it: TIER2_JSON=t2.json gradlew :app:testDebugUnitTest
 */
class Tier2DecodeTest {
    @Test
    fun state() {
        val s = TetraApi.decodeTier2(200, OK, null).state
        assertNotNull(s)
        s!!
        assertTrue(s.ok)
        assertEquals("ED5ZAA", s.station.callsign)
        assertEquals(438425000L, s.station.txHz)
        assertTrue(s.station.shared)
        assertEquals("0.7.0", s.stack.version)
        val ts1 = s.slots.ts1!!
        assertEquals("rf", ts1.src)
        assertEquals(2141234L, ts1.fromId)
        assertEquals("EA1ABC Luis", ts1.ta)
        assertNull(s.slots.ts2)
        assertEquals(2, s.heard.size)
        val h = s.heard[0]
        assertEquals("watchdog", h.endKind)
        assertEquals("ADN", h.net)
        assertEquals(12.3, h.dur!!, 1e-9)
        assertEquals(-80.0, s.heard[1].rssi!!.min, 1e-9)
        assertEquals(1.5, s.heard[1].ber!!, 1e-9)
        assertEquals("ALL", s.heard[1].to)
        assertNull(s.heard[1].fromId)
        assertEquals(3, s.heard[1].blocks)
        assertEquals(listOf("up", "down"), s.nets.map { it.status })
        assertEquals("Connection to the master has timed out, retrying connection", s.nets[1].reason)
        assertEquals(600000.0, s.window!!.sdrRate!!, 1e-9)
        assertEquals(32.5, s.window!!.minMarginMs!!, 1e-9)
        assertEquals("warn", s.alerts[0].level)
        assertEquals("EA1ABC", s.names["2141234"]?.callsign)
        assertTrue(s.modem.tx)
    }

    @Test
    fun notApplicable() {
        val r = TetraApi.decodeTier2(503, """{"ok":false,"reason":"tier3","state":{"installed":true,"exists":true,"enabled":true,"version":"0.7.0","active":true,"degraded":false,"missing":[]},"message":"Tier III"}""", null)
        assertNull(r.state)
        assertEquals("tier3", r.reason)
        assertEquals("0.7.0", r.stack?.version)
        assertEquals("stopped", TetraApi.decodeTier2(503, """{"ok":false,"reason":"stopped","state":null,"message":"parada"}""", null).reason)
    }

    @Test
    fun olderPanel() {
        // the web's index.html (the SPA answers any unknown path) or a 404: a panel without the monitor
        assertEquals("unsupported", TetraApi.decodeTier2(200, "<!DOCTYPE html><html></html>", null).reason)
        assertEquals("unsupported", TetraApi.decodeTier2(404, "Cannot GET /api/dmr/tier2/state", null).reason)
    }

    @Test
    fun failures() {
        assertEquals("offline", TetraApi.decodeTier2(-1, "", "timeout").reason)
        assertEquals("error", TetraApi.decodeTier2(500, """{"message":"boom"}""", null).reason)
        assertEquals("error", TetraApi.decodeTier2(200, """{"ok":false}""", null).reason)
    }

    @Test
    fun capture() {
        val f = System.getenv("TIER2_JSON")?.let(::File)?.takeIf { it.isFile } ?: return
        val r = TetraApi.decodeTier2(200, f.readText(), null)
        assertNull(r.message, r.message)
        val s = r.state!!
        assertTrue(s.ok)
        assertTrue(s.heard.isNotEmpty())
        assertTrue(s.heard.all { it.key.isNotEmpty() && it.start > 0 && it.slot in 1..2 && it.src in setOf("rf", "net") })
        println("captura: ${s.station.callsign} ${s.station.id}, ${s.heard.size} escuchadas, ${s.nets.size} redes, ${s.alerts.size} avisos, ${s.names.size} nombres, " +
            "TS1=${s.slots.ts1?.from} TS2=${s.slots.ts2?.from}, fin=${s.heard.groupingBy { it.endKind }.eachCount()}")
    }

    private companion object {
        val OK = """
            {"ok":true,"demo":true,"now":1794589564257,
             "stack":{"installed":true,"exists":true,"enabled":true,"version":"0.7.0","active":true,"degraded":false,"missing":[]},
             "station":{"callsign":"ED5ZAA","id":214500,"rx_hz":430825000,"tx_hz":438425000,"color_code":1,"timeout_s":180,"shared":true,"display_level":2},
             "slots":{"1":{"key":"1-1794589560000","slot":1,"src":"rf","kind":"voice","from":"2141234","from_id":2141234,"to":"9","to_id":9,"group":true,"net":null,
                           "start":1794589560000,"end":null,"dur":null,"ber":null,"loss":null,"rssi":null,"end_kind":null,"blocks":null,"ta":"EA1ABC Luis","late":false},
                      "2":null},
             "heard":[
               {"key":"2-1794589371374","slot":2,"src":"net","kind":"voice","from":"2142345","from_id":2142345,"to":"91","to_id":91,"group":true,"net":"ADN",
                "start":1794589371374,"end":1794589383674,"dur":12.3,"ber":0,"loss":2,"rssi":null,"end_kind":"watchdog","blocks":null,"ta":null,"late":true},
               {"key":"1-1794589300000","slot":1,"src":"rf","kind":"data","from":"EA4DEF","from_id":null,"to":"ALL","to_id":16777215,"group":false,"net":null,
                "start":1794589300000,"end":1794589301000,"dur":1,"ber":1.5,"loss":null,"rssi":{"min":-80,"max":-70,"ave":-75},"end_kind":"end","blocks":3,"ta":null,"late":false}
             ],
             "nets":[
               {"n":1,"name":"ADN","address":"10.33.1.50","port":62037,"routes":"S1,S2","enabled":true,"status":"up","since":1794588000000,"reason":null},
               {"n":2,"name":"Red 2","address":"192.0.2.20","port":62031,"routes":"S2:91","enabled":true,"status":"down","since":1794589000000,"reason":"Connection to the master has timed out, retrying connection"}
             ],
             "modem":{"tx":true,"mode":"DMR","since":1794589560100},
             "window":{"attached":true,"sdr_rate":600000,"rx_hz":430825000,"tx_hz":438425000,"tx_gain":0.5,"rx_lost":0,"tx_late":0,"min_margin_ms":32.5,"at":1794589500000},
             "alerts":[{"ts":1794589000000,"level":"warn","text":"Red 2, Connection to the master has timed out, retrying connection"}],
             "names":{"2141234":{"callsign":"EA1ABC","name":"Luis","city":"Oviedo","country":"Spain"}}}
        """.trimIndent()
    }
}
