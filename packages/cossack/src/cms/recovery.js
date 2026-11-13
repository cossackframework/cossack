/**
 * `cossack cms password reset`: recovery mode for a locked-out administrator. The site turns it
 * on with CMS_RECOVERY_CODE in its environment; this sends that code (from CMS_RECOVERY_CODE
 * here, the project's .env or .dev.vars, or a prompt) with the account's email and prints the
 * one-hour reset link the site answers with. The new password is chosen in the browser.
 */
import { assertCredentialTarget, createClient, isLocalAddress, projectEnv, resolveTarget } from './client.js';

const coded = (code, message) => Object.assign(new Error(message), { code });

async function terminalAsk({ type, message }) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return undefined;
  const { default: prompts } = await import('prompts');
  const answer = await prompts({ type, name: 'value', message }, { onCancel: () => { throw coded('COSSACK_COMMAND_ABORTED', 'Canceled.'); } });
  return answer.value;
}

export async function passwordResetCommand({ flags, env = process.env, cwd = process.cwd(), out = () => {}, ask = terminalAsk, fetch = globalThis.fetch }) {
  const { url, site, source, allowHttp } = await resolveTarget({ flags, env, cwd, needToken: false });
  const email = flags.email || env.CMS_EMAIL || await ask({ type: 'text', message: 'Email of the account' });
  if (!email) throw coded('COSSACK_CMS_EMAIL_REQUIRED', 'Pass --email with the account\'s email address.');
  // A code from the shell goes only to a confirmed address; the project's own code goes to its own APP_URL.
  const shellCode = env.CMS_RECOVERY_CODE;
  if (shellCode) assertCredentialTarget(url, { source, credential: 'CMS_RECOVERY_CODE', allowHttp });
  let code = shellCode || await projectEnv(cwd, 'CMS_RECOVERY_CODE');
  if (!code) {
    // A typed code is a credential for some site: checked before it is typed, and sent to an
    // address only this folder's .env names (a cloned project could name any host) once confirmed.
    assertCredentialTarget(url, { source, credential: 'CMS_RECOVERY_CODE', fromEnvironment: false, allowHttp });
    const origin = new URL(url).origin;
    if (source === 'project' && !isLocalAddress(url)) {
      const confirmed = await ask({ type: 'confirm', message: `Only this folder's .env names ${origin}. Send your recovery code there?` });
      if (confirmed !== true) throw coded('COSSACK_CMS_URL_UNCONFIRMED', `Your recovery code is not sent to ${origin}, which only this folder's .env names. Pass --url ${origin} (or set COSSACK_CMS_URL) to confirm.`);
    }
    code = await ask({ type: 'password', message: `Recovery code (CMS_RECOVERY_CODE) for ${origin}` });
  }
  if (!code) throw coded('COSSACK_CMS_RECOVERY_CODE_REQUIRED', 'Set CMS_RECOVERY_CODE to the code in the site\'s environment (or run in a terminal to be asked).');
  assertCredentialTarget(url, { source, credential: 'CMS_RECOVERY_CODE', fromEnvironment: false, allowHttp });
  // The recovery code goes in the authorization header; the client sends no stored password.
  const client = createClient({ url, site, fetch });
  const { data } = await client.request('POST', '/api/cms/recovery', { headers: { authorization: `Bearer ${code}` }, body: { email, secondFactors: flags['second-factors'] === true } });
  out(`Open this link within the hour to choose a new password for ${data.email}${site ? ` on ${site}` : ''}:\n\n  ${data.resetUrl}\n`);
  if (data.secondFactorsCleared) out('Its authenticator app, recovery codes and passkeys were removed: set up two-step sign-in again after signing in.');
  out('Remove CMS_RECOVERY_CODE from the site\'s environment when you are back in.');
  return data;
}
