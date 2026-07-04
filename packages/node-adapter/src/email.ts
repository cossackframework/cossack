// src/email.ts
//
// Node.js polyfill for Cloudflare's `send_email` binding (the `env.EMAIL`
// object). Cloudflare Workers expose `env.EMAIL.send({ to, from, subject,
// html, text })` when a `send_email` binding is declared in `wrangler.jsonc`.
//
// To keep application code identical across runtimes, this module provides a
// `createNodeEmailSender()` factory returning the same `{ send }` shape, backed
// by nodemailer SMTP. Wire it into `env` (e.g. `app.fetch(req, { EMAIL:
// createNodeEmailSender({...}) })`) and pass `env` to the node-adapter so that
// `this.env.EMAIL` works in `@Server` methods on Node just as it does on
// Cloudflare.
import nodemailer, { type Transporter } from 'nodemailer';

export interface EmailAddress {
    name?: string;
    address: string;
}

/**
 * Message shape — compatible with Cloudflare's `EmailMessageBuilder` so the
 * same call site works on both runtimes.
 */
export interface EmailMessageInput {
    to: string | EmailAddress | (string | EmailAddress)[];
    from?: string | EmailAddress;
    subject: string;
    html?: string;
    text?: string;
    cc?: string | EmailAddress | (string | EmailAddress)[];
    bcc?: string | EmailAddress | (string | EmailAddress)[];
    replyTo?: string | EmailAddress;
}

export interface EmailSendResult {
    messageId: string;
}

export interface NodeEmailOptions {
    /** SMTP host, e.g. "smtp.gmail.com". Read from `SMTP_HOST` in your app. */
    host: string;
    /** SMTP port. Read from `SMTP_PORT` (defaults to 587). */
    port: number;
    /** Use TLS (port 465). Defaults to `port === 465`. */
    secure?: boolean;
    auth: {
        user: string;
        pass: string;
    };
    /** Default `from` address when the message omits one. Read from `MAIL_FROM`. */
    from?: string;
}

/**
 * Result type returned by {@link createNodeEmailSender}. Structurally
 * compatible with Cloudflare's `SendEmail` binding (`env.EMAIL`).
 */
export interface NodeEmailSender {
    send(message: EmailMessageInput): Promise<EmailSendResult>;
}

/**
 * Build a Node.js email sender backed by nodemailer SMTP. The returned object
 * matches the shape of Cloudflare's `env.EMAIL` binding, so the same
 * `await env.EMAIL.send({ to, from, subject, html, text })` call works on both
 * runtimes.
 *
 * @example
 * ```ts
 * import { createNodeEmailSender } from '@cossackframework/node-adapter';
 *
 * const email = createNodeEmailSender({
 *   host: process.env.SMTP_HOST!,
 *   port: Number(process.env.SMTP_PORT ?? 587),
 *   secure: process.env.SMTP_SECURE === 'true',
 *   auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
 *   from: process.env.MAIL_FROM ?? 'no-reply@example.com',
 * });
 *
 * // Identical call on Cloudflare (real binding) and Node (this polyfill):
 * await env.EMAIL.send({ to, from, subject, html, text });
 * ```
 *
 * Configure via environment variables (set them in `.dev.vars` for Cloudflare
 * dev, or your shell/`.env` for Node):
 *   SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, MAIL_FROM
 */
export function createNodeEmailSender(options: NodeEmailOptions): NodeEmailSender {
    const transport: Transporter = nodemailer.createTransport({
        host: options.host,
        port: options.port,
        secure: options.secure ?? options.port === 465,
        auth: {
            user: options.auth.user,
            pass: options.auth.pass,
        },
    });

    const defaultFrom = options.from;

    return {
        async send(message: EmailMessageInput): Promise<EmailSendResult> {
            const from = message.from ?? defaultFrom;
            if (!from) {
                throw new Error(
                    'Missing "from" email address. Provide message.from or configure options.from.',
                );
            }
            const info = await transport.sendMail({
                from,
                to: message.to,
                subject: message.subject,
                html: message.html,
                text: message.text,
                cc: message.cc,
                bcc: message.bcc,
                replyTo: message.replyTo,
            });
            return { messageId: info.messageId };
        },
    };
}
