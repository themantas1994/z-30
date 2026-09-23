// Run: TZ=America/Los_Angeles npx tsx audit/2026-09-23-vnext/probes/autolog_fields.mts
import { packZ30Message, unpackZ30Message } from '../../../src/dsp/z30Codec.ts';
import { qsoEngine } from '../../../src/dsp/qsoEngine.ts';
for (const t of ['W1AW K1ABC -16.3', 'W1AW K1ABC +012', 'W1AW K1ABC +05.3']) {
  const p = packZ30Message(t);
  console.log(`TX "${t}" type=${p.type} -> RX "${unpackZ30Message(p.infoBits).rawText}"`);
}
// Drive the auto-sequencer through a QSO where the DX station's grid was never decoded and
// its report arrives in a message without a report field (RR73).
const cfg: any = { myCall: 'W1AW', myGrid: 'FN31', autoSeq: true, watchdogCycles: 0, autoReplyPriority: 'FIRST' };
const e: any = qsoEngine;
e.state.stage = 'SENDING_REPORT';
e.state.targetDxCall = 'K1ABC';
e.state.targetDxGrid = '';
const d: any = { id: 'x', message: 'W1AW K1ABC RR73', callTo: 'W1AW', callFrom: 'K1ABC', snr: -18.4, sicPass: 1 };
const r = qsoEngine.processDecodesForAutoSeq([d], cfg, '20m', 14_080_000);
console.log('auto-logged:', JSON.stringify(r.autoLogged));
console.log('process TZ:', Intl.DateTimeFormat().resolvedOptions().timeZone, ' real UTC now:', new Date().toISOString());
