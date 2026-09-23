// Run: npx tsx audit/2026-09-23-vnext/probes/codec_roundtrip.mts
import { isValidCallsign } from '../../../src/dsp/bandPlan.ts';
import { packZ30Message, unpackZ30Message } from '../../../src/dsp/z30Codec.ts';
for (const call of ['K1ABC', 'ZY2ABC', 'EA8/G4XYZ', 'G4XYZ/P', '3DA0XYZ']) {
  const tx = `CQ ${call} FN31`;
  const rx = unpackZ30Message(packZ30Message(tx).infoBits).rawText;
  console.log(`${call.padEnd(10)} gate isValidCallsign=${isValidCallsign(call)}  TX "${tx}" -> RX "${rx}"`);
}
for (const grid of ['FN31', 'FN42', 'JO01', 'IO91', 'PM95', 'GG66', 'EM12']) {
  const tx = `CQ K1ABC ${grid}`;
  console.log(`grid ${grid}: TX "${tx}" -> RX "${unpackZ30Message(packZ30Message(tx).infoBits).rawText}"`);
}
for (const rpt of ['-24', '-30', '-31', '+05', 'R-12', 'RRR', '73', 'RR73']) {
  const tx = `W1AW K1ABC ${rpt}`;
  console.log(`report ${rpt}: TX "${tx}" -> RX "${unpackZ30Message(packZ30Message(tx).infoBits).rawText}"`);
}
