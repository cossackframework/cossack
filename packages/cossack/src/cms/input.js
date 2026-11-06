/** Fields a `cossack cms` write sends: `--data` (JSON, @file or @- for stdin) and `--set name=value` pairs, the pairs winning. */
import fs from 'node:fs/promises';
import path from 'node:path';

const coded = (code, message) => Object.assign(new Error(message), { code });

export async function readBody(flags, { cwd = process.cwd(), stdin = process.stdin } = {}) {
  let body = {};
  if (flags.data !== undefined) {
    const text = await readData(String(Array.isArray(flags.data) ? flags.data.at(-1) : flags.data), cwd, stdin);
    let parsed;
    try { parsed = JSON.parse(text); } catch (error) { throw coded('COSSACK_CMS_DATA_INVALID', `--data is not JSON: ${error.message}`); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw coded('COSSACK_CMS_DATA_INVALID', '--data is a JSON object of fields.');
    body = parsed;
  }
  for (const pair of flags.set === undefined ? [] : Array.isArray(flags.set) ? flags.set : [flags.set]) {
    const index = String(pair).indexOf('=');
    if (index < 1) throw coded('COSSACK_CMS_DATA_INVALID', `--set takes name=value, not ${pair}.`);
    assign(body, String(pair).slice(0, index).split('.'), parseValue(String(pair).slice(index + 1)));
  }
  return body;
}

async function readData(value, cwd, stdin) {
  if (value === '@-') {
    let text = '';
    for await (const chunk of stdin) text += chunk;
    return text;
  }
  if (value.startsWith('@')) {
    try { return await fs.readFile(path.resolve(cwd, value.slice(1)), 'utf8'); }
    catch (error) { throw coded('COSSACK_CMS_DATA_INVALID', `Cannot read ${value.slice(1)}: ${error.message}`); }
  }
  return value;
}

/** JSON when it parses (numbers, booleans, null, arrays, objects, quoted strings), otherwise the text itself. */
export function parseValue(text) {
  const trimmed = text.trim();
  if (/^(?:true|false|null|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?|".*"|\[.*\]|\{.*\})$/s.test(trimmed)) {
    try { return JSON.parse(trimmed); } catch { /* text */ }
  }
  return text;
}

function assign(target, keys, value) {
  const [head, ...rest] = keys;
  if (!head || head === '__proto__' || head === 'constructor' || head === 'prototype') throw coded('COSSACK_CMS_DATA_INVALID', `--set has an invalid field name ${keys.join('.')}.`);
  if (!rest.length) { target[head] = value; return; }
  if (!target[head] || typeof target[head] !== 'object' || Array.isArray(target[head])) target[head] = {};
  assign(target[head], rest, value);
}
