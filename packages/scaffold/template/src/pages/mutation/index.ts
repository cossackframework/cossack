import { Client, ClientState, ClientStore, Cossack, Page, RpcError, Server, Validate, input, storeRules, type InputOf } from '@cossackframework/core';
import { html } from '@cossackframework/renderer';

interface Submission { email: string; message: string }

const inputRules = storeRules<Submission>({
  email: { required: true, email: true, maxLength: 254, message: 'Enter a valid email address.' },
  message: { required: true, minLength: 3, maxLength: 500, pattern: /\S/, message: 'Enter a message of 3 to 500 characters.' },
});

const submissionInput = input.object({
  email: input.string(inputRules.email!),
  message: input.string(inputRules.message!),
});

@Page({ transport: 'http' })
export default class MutationPage extends Cossack {
  @ClientStore()
  @Validate({ rules: inputRules, config: { trigger: 'submit', runOn: 'client' } })
  form: Submission = { email: '', message: '' };

  @ClientStore() errors: Record<string, string> = {};
  @ClientState() pending = false;
  @ClientState() failure = '';
  @ClientState() acknowledgment = '';

  @Server({ input: submissionInput })
  async submitMessage(input: InputOf<typeof submissionInput>): Promise<string> {
    // Only validated arguments reach this method. Add authorization and a
    // service/database write here when adapting this public demonstration.
    // HTTP component state is not durable storage. This example saves nothing.
    return `Submission received for ${input.email.toLowerCase()}.`;
  }

  @Client()
  updateField(field: keyof Submission, event: Event) {
    this.form[field] = (event.currentTarget as HTMLInputElement | HTMLTextAreaElement).value;
    this.clearErrors();
    this.failure = '';
    this.acknowledgment = '';
  }

  @Client()
  async submit(event: Event) {
    event.preventDefault();
    if (this.pending) return;
    this.pending = true;
    this.failure = '';
    this.acknowledgment = '';
    this.clearErrors();
    try {
      if (!await this.validateAll()) return;
      // Pass an explicit snapshot. Client-only form state is not sent as
      // authoritative component state, and the server revalidates the payload.
      this.acknowledgment = await this.submitMessage({ ...this.form });
      this.form = { email: '', message: '' };
    } catch (error) {
      if (error instanceof RpcError && error.code === 'COSSACK_VALIDATION_FAILED') {
        for (const field of ['email', 'message'] as const) {
          const message = error.fieldErrors?.[field];
          if (typeof message === 'string') this.errors[`form.${field}`] = message;
        }
        this.failure = 'Check the fields and submit again.';
      } else {
        this.failure = 'Could not submit. Your input is preserved; try again.';
      }
    } finally {
      this.pending = false;
    }
  }

  render() {
    return html`
      <main>
        <h1>Validated mutation</h1>
        <p>This public example validates a submission and returns an acknowledgment. It does not save or send your data.</p>
        <form novalidate @submit=${this.submit} aria-busy=${this.pending}>
          <fieldset ?disabled=${this.pending}>
            <label for="mutation-email">Email</label>
            <input id="mutation-email" name="email" type="email" autocomplete="email"
              .value=${this.form.email} @input=${(event: Event) => this.updateField('email', event)}
              aria-invalid=${this.hasError('form.email')} aria-describedby="mutation-email-error" />
            <p id="mutation-email-error">${this.getError('form.email') ?? ''}</p>
            <label for="mutation-message">Message</label>
            <textarea id="mutation-message" name="message"
              .value=${this.form.message} @input=${(event: Event) => this.updateField('message', event)}
              aria-invalid=${this.hasError('form.message')} aria-describedby="mutation-message-error"></textarea>
            <p id="mutation-message-error">${this.getError('form.message') ?? ''}</p>
            <button type="submit">${this.pending ? 'Submitting…' : 'Submit'}</button>
          </fieldset>
        </form>
        ${this.failure ? html`<p role="alert">${this.failure}</p>` : ''}
        ${this.acknowledgment ? html`<p role="status">${this.acknowledgment}</p>` : ''}
      </main>
    `;
  }
}
