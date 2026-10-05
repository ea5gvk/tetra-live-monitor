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
