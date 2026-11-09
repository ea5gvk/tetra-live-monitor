// node --test via tsx:  npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { applySoapyTxGains } from "./miuraConfig";

test("tx_gain: an off-step value applied untouched stays as written; a real change rewrites it", () => {
  const cfg = "[phy_io.soapysdr]\ntx_freq = 1\ntx_gain_dac = 5\ntx_gain_mixer = 29   # near max\n\n[cell_info]\n";
  // what the card sends after loading it: the values on the driver's steps
  const load = { tx_gain_dac: { enabled: true, value: 6 }, tx_gain_mixer: { enabled: true, value: 30 } };
  for (const c of [cfg, cfg.replace(/\n/g, "\r\n")]) assert.equal(applySoapyTxGains(c.split("\n"), load).join("\n"), c);
  assert.equal(applySoapyTxGains(cfg.split("\n"), { ...load, tx_gain_mixer: { enabled: true, value: 28 } }).join("\n"),
    cfg.replace("tx_gain_mixer = 29", "tx_gain_mixer = 28"));
  assert.equal(applySoapyTxGains(cfg.split("\n"), { ...load, tx_gain_dac: { enabled: false, value: 6 } }).join("\n"),
    cfg.replace("tx_gain_dac = 5", "# tx_gain_dac = 5"));
});

test("sample_rate / centre freq: MiuraStation never comments an active sample_rate; the DMR window keeps the centres", async () => {
  const { soapyDcLine, soapyDcNote } = await import("./miuraConfig");
  const win = "[phy_io.soapysdr]\nsample_rate = 600000\n\n[dmr_window]\n# >>> dmr-tier3: SDR_COMPARTIDO=1\ncarriers = 1\n# <<< dmr-tier3\n";
  const noWin = "[phy_io.soapysdr]\nsample_rate = 600000\n";
  // Apply, secondary carrier unticked
  assert.equal(soapyDcLine("sample_rate", "active", false, true, noWin), "keep", "MiuraStation: an active one stays as it is");
  assert.equal(soapyDcLine("sample_rate", "active", false, true, win), "keep");
  assert.equal(soapyDcLine("sample_rate", "commented", false, true, win), "active", "commented with [dmr_window] (what main's Apply left): written active");
  assert.equal(soapyDcLine("sample_rate", "commented", false, true, noWin), "commented", "commented without the window: as before");
  assert.equal(soapyDcLine("sample_rate", "missing", false, true, win), "active", "missing with [dmr_window]: written active");
  assert.equal(soapyDcLine("sample_rate", "missing", false, true, noWin), "commented", "missing without the window: as before");
  // Apply, secondary carrier ticked: active (600000), as before
  for (const l of ["active", "commented", "missing"] as const) assert.equal(soapyDcLine("sample_rate", l, true, true, win), "active");
  // centre frequency unticked
  for (const k of ["tx_center_freq", "rx_center_freq"]) {
    assert.equal(soapyDcLine(k, "active", false, true, win), "keep", `${k} with [dmr_window]`);
    assert.equal(soapyDcLine(k, "active", false, true, noWin), "commented", `${k} without the window: as before`);
    assert.equal(soapyDcLine(k, "commented", false, true, win), "commented");
    assert.equal(soapyDcLine(k, "missing", false, true, win), "commented");
    assert.equal(soapyDcLine(k, "active", true, true, win), "active");
  }
  // the window is an active [dmr_window] header (CRLF too); commented or a sub-table is not
  assert.equal(soapyDcLine("tx_center_freq", "active", false, true, win.replace(/\n/g, "\r\n")), "keep");
  assert.equal(soapyDcLine("tx_center_freq", "active", false, true, win.replace("[dmr_window]", "# [dmr_window]")), "commented");
  assert.equal(soapyDcLine("tx_center_freq", "active", false, true, win.replace("[dmr_window]", "[dmr_window.x]")), "commented");
  // FlowStation (razvan) and BlueStation: exactly as before
  assert.equal(soapyDcLine("sample_rate", "active", false, false, noWin), "commented");
  assert.equal(soapyDcLine("sample_rate", "missing", false, false, noWin), "commented");
  assert.equal(soapyDcLine("tx_center_freq", "active", false, false, noWin), "commented");
  assert.equal(soapyDcLine("tx_center_freq", "active", false, false, win), "commented", "the window is MiuraStation's");
  assert.equal(soapyDcLine("sample_rate", "missing", false, false, win), "commented");
  assert.equal(soapyDcLine("sample_rate", "active", true, false, noWin), "active");
  // the dual-carrier switch: OFF comments its keys out except the ones kept, ON uncomments them all
  const keys = ["sample_rate", "tx_center_freq", "rx_center_freq", "secondary_carrier", "dual_carrier_enabled"];
  assert.deepEqual(keys.map((k) => soapyDcLine(k, "active", false, true, win)), ["keep", "keep", "keep", "commented", "commented"], "MiuraStation + DMR window");
  assert.deepEqual(keys.map((k) => soapyDcLine(k, "active", false, true, noWin)), ["keep", "commented", "commented", "commented", "commented"], "MiuraStation");
  assert.deepEqual(keys.map((k) => soapyDcLine(k, "active", false, false, noWin)), Array(5).fill("commented"), "FlowStation");
  assert.deepEqual(keys.map((k) => soapyDcLine(k, "active", false, false, win)), Array(5).fill("commented"), "FlowStation, even with the window");
  assert.deepEqual(keys.map((k) => soapyDcLine(k, "commented", true, true, win)), Array(5).fill("active"), "ON");
  assert.match(soapyDcNote("sample_rate"), /MiuraStation/);
  assert.match(soapyDcNote("rx_center_freq"), /^rx_center_freq .*\[dmr_window\]/);
});
