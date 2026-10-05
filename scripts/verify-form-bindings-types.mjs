import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

/** Compile native and UI bindings against installed public declarations, without app execution. */
export async function verifyFormBindingsTypes(projectDir) {
  projectDir = await fs.realpath(projectDir);
  const packages = ['@cossackframework/core', '@cossackframework/ui'];
  // Node ESM chooses the real public import conditions from this application,
  // rather than a workspace require condition or a source-path alias.
  const resolution = await exec(process.execPath, ['--input-type=module', '-e',
    `console.log(JSON.stringify(${JSON.stringify(packages)}.map(name => ({ name, url: import.meta.resolve(name) }))));`,
  ], { cwd: projectDir, timeout: 10000, maxBuffer: 1024 * 1024 });
  assert.equal(resolution.stderr, '');
  const resolved = JSON.parse(resolution.stdout);
  assert.equal(resolved.length, packages.length);
  for (const [index, entry] of resolved.entries()) {
    assert.equal(entry.name, packages[index]);
    const location = await fs.realpath(fileURLToPath(entry.url));
    assert.ok(location.startsWith(projectDir + path.sep), `${entry.name} must resolve inside the installed fixture, not a workspace checkout.`);
    const directory = await fs.realpath(path.join(projectDir, 'node_modules', entry.name));
    assert.ok(directory.startsWith(projectDir + path.sep));
    const manifest = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
    assert.equal(manifest.name, entry.name);
    assert.ok(manifest.exports?.['.']?.types, `${entry.name} needs a public root declaration entry.`);
    await fs.access(path.resolve(directory, manifest.exports['.'].types));
  }
  const require = createRequire(path.join(projectDir, 'package.json'));
  const compilerDirectory = path.dirname(require.resolve('typescript/package.json'));
  const compilerManifest = JSON.parse(await fs.readFile(path.join(compilerDirectory, 'package.json'), 'utf8'));
  assert.match(compilerManifest.version, /^7\./, 'Run this acceptance with the installed TypeScript 7 compiler.');
  const compiler = path.join(compilerDirectory, 'bin/tsc');
  const fixture = await fs.mkdtemp(path.join(projectDir, '.form-bindings-types-'));
  try {
    await fs.writeFile(path.join(fixture, 'consumer.ts'), `import { input, createFormController, createFormBindings, type RawInputOf, type FormFieldBinding } from '@cossackframework/core';
import { createUiFormBindings, type UiFormBindings, type UiFormFieldBinding, type FormProps } from '@cossackframework/ui';
const schema = input.object({
  profile: input.object({ name: input.string(), age: input.number({coerce:true}) }),
  enabled: input.boolean({coerce:true}),
  items: input.array(input.object({name:input.string()})),
  attachment: input.file().optional(),
});
const controller = createFormController(schema, {profile:{name:'Ada',age:'18'},enabled:'on',items:[{name:'One'}],attachment:undefined});
const native = createFormBindings(controller,{id:'profile'});
const nativeField: FormFieldBinding<RawInputOf<typeof schema>,'items.0.name'> = native.field('items.0.name');
const nestedName:string = nativeField.value;
const nativeAge:string|number = native.field('profile.age').value;
const ui: UiFormBindings<typeof schema> = createUiFormBindings(controller,{id:'ui-profile'});
const uiField: UiFormFieldBinding<RawInputOf<typeof schema>,'profile.age'> = ui.field('profile.age');
const uiAge:string|number = uiField.value;
const uiName:string = ui.field('items.0.name').value;
const optionalFile:File|undefined = ui.field('attachment',{kind:'file'}).value;
controller.setFieldValue('items.0.name','Two');
controller.setFieldValue('profile.age',21);
const formProps:FormProps = {id:'authored-form',bindings:ui.form(data => {
  const parsedAge:number=data.profile.age;
  const parsedEnabled:boolean=data.enabled;
  const attachment:File|undefined=data.attachment;
  return data.profile.name + parsedAge;
},{onResult:result => {
  if(result.status==='submitted') {
    const saved:string=result.result;
    // @ts-expect-error Generic submitted result stays a string, not any/unknown.
    const wrong:number=result.result;
  }
}})};
// @ts-expect-error Invalid native field names remain rejected.
native.field('profile.missing');
// @ts-expect-error Invalid indexed item names remain rejected.
native.field('items.0.missing');
// @ts-expect-error Invalid UI field names remain rejected.
ui.field('profile.missing');
// @ts-expect-error Raw indexed item values retain the schema string type.
controller.setFieldValue('items.0.name',false);
// @ts-expect-error Coerced numeric inputs accept numbers/strings, not booleans.
controller.setFieldValue('profile.age',false);
// @ts-expect-error Optional files cannot be replaced with filename strings.
controller.setFieldValue('attachment','report.txt');
// @ts-expect-error UI field values preserve concrete raw numeric/string type.
const wrongUiAge:boolean=ui.field('profile.age').value;
// @ts-expect-error Unknown public submit input paths are rejected.
ui.form(data=>data.profile.missing);
// @ts-expect-error UI Form requires actual submission bindings, not arbitrary objects.
const invalidFormProps:FormProps={bindings:{id:'fake'}};
void formProps; void nestedName; void nativeAge; void uiAge; void uiName; void optionalFile;
`);
    const checked = await exec(process.execPath, [compiler, '--ignoreConfig', '--noEmit', '--strict', '--skipLibCheck',
      '--module', 'ESNext', '--moduleResolution', 'Bundler', '--target', 'ESNext', '--lib', 'ESNext,DOM',
      '--types', 'node', '--experimentalDecorators', '--emitDecoratorMetadata', path.join(fixture, 'consumer.ts'),
    ], { cwd: fixture, timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
    assert.equal(checked.stdout, ''); assert.equal(checked.stderr, '');
    console.log('Installed Core/UI ESM imports and native/UI binding field, value, submission-result and FormProps types passed.');
    return { packages, types: 'passed', applicationExecution: 'not-performed' };
  } finally {
    await fs.rm(fixture, { recursive: true, force: true });
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.ok(process.argv[2], 'Usage: node scripts/verify-form-bindings-types.mjs <installed-project-root>');
  await verifyFormBindingsTypes(process.argv[2]);
}
