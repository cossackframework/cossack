import fs from 'node:fs/promises';
import path from 'node:path';
import { commandSpecs } from '../command-specs.js';
import { showCommandHelp, validateCommand } from '../command-spec.js';
import { findProjectRoot } from '../fs-utils.js';
import { commandFailure, diagnosticCode, diagnosticMessage, writeResult } from '../output.js';

/** Emit the app model: routes, classes and render() UI trees as versioned JSON. */
export async function specsCommand(args, ctx) {
  if (showCommandHelp(commandSpecs.specs, args, ctx, specsHelp)) return 0;
  if (!validateCommand(commandSpecs.specs, args, ctx)) return 1;
  try {
    const { appModelSchema, validateAppModel } = await import('@cossackframework/core/app-model');
    if (ctx.flags.schema === true) {
      if (ctx.flags.json === true) writeResult('specs', { data: appModelSchema });
      else console.log(JSON.stringify(appModelSchema, null, 2));
      return 0;
    }
    const root = await findProjectRoot(ctx.cwd);
    const { buildAppModel } = await import('../app-model.js');
    const model = await buildAppModel(root, { environment: ctx.flags.env ?? process.env.CLOUDFLARE_ENV });
    const { valid, errors } = validateAppModel(model);
    if (!valid) {
      return commandFailure(ctx, 'specs', 'COSSACK_SPECS_INVALID', `The app model does not match its schema: ${errors.slice(0, 5).join('; ')}`);
    }
    if (ctx.flags.output) {
      const output = path.resolve(ctx.cwd ?? process.cwd(), ctx.flags.output);
      await fs.mkdir(path.dirname(output), { recursive: true });
      await fs.writeFile(output, JSON.stringify(model, null, 2) + '\n');
      const summary = { output: path.relative(root, output).split(path.sep).join('/'), routes: model.routes.length, classes: model.classes.length };
      if (ctx.flags.json === true) writeResult('specs', { data: summary });
      else console.log(`Wrote the app model to ${summary.output}: ${summary.routes} route(s), ${summary.classes} class(es).`);
      return 0;
    }
    if (ctx.flags.json === true) writeResult('specs', { data: model });
    else console.log(JSON.stringify(model, null, 2));
    return 0;
  } catch (error) {
    const code = diagnosticCode(error, 'COSSACK_INSPECTION_FAILED');
    return commandFailure(ctx, 'specs', code, ctx.flags.json === true ? diagnosticMessage(error, code) : error.message);
  }
}

export function specsHelp() {
  return commandSpecs.specs.help(`cossack specs [--output <file>] [--schema] [--json]

Print the app model: a versioned JSON document with routes and layouts from
route discovery, every application class (decorators, props, state fields,
server and client methods, server$ resources, injected services and
comments) and one UI tree per render() with element, component, control
(when, choose, repeat, map, conditionals), text and expression nodes.
Expressions carry their source text and inferred TypeScript type.
Project modules are never executed. --output writes the document to a file.
--schema prints the JSON Schema of the document
(@cossackframework/core/app-model exports the schema, types and a validator).`);
}
