import { commandSpecs } from '../command-specs.js';
import { runWithSpec } from '../command-spec.js';
import { findProjectRoot } from '../fs-utils.js';
import { readDevelopmentTraces } from '@cossackframework/framework/development-traces';

export function tracesCommand(args, ctx) {
  return runWithSpec(commandSpecs.traces, args, ctx, async () => {
    const result = await readDevelopmentTraces(await findProjectRoot(ctx.cwd), { session: ctx.flags.session });
    if (ctx.flags.json) return { exitCode: 0, data: result.data, diagnostics: result.diagnostics };
    if (result.data.status === 'missing') console.log('No recorded development trace. Enable developmentTraces in cossackPages and record in the browser.');
    else {
      const { record, freshness } = result.data;
      console.log(`Capture ${record.snapshot.sessionId}: ${record.snapshot.events.length} events, ${record.snapshot.dropped} dropped; received ${freshness.ageMs} ms ago.`);
      console.log('Recorded browser snapshot; not a live query or proof of server execution.');
    }
    return 0;
  });
}
export function tracesHelp() {
  return commandSpecs.traces.help(`cossack traces [--session <uuid>] [--json]

Read bounded browser snapshots saved by the opt-in Vite development bridge.
Defaults to the most recently received capture. Does not start recording, execute
application code or contact a server. State values are omitted. A collecting flag
is historical; inspect freshness.ageMs before using the recorded evidence.`);
}
