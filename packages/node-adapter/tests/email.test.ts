import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock nodemailer so the unit test doesn't open a real SMTP connection.
// We intercept `createTransport` and capture the options + returned sendMail.
const mockSendMail = vi.fn();
vi.mock('nodemailer', () => ({
    default: {
        createTransport: vi.fn(() => ({ sendMail: mockSendMail })),
    },
    createTransport: vi.fn(() => ({ sendMail: mockSendMail })),
}));

// Import AFTER the mock is registered.
const { createNodeEmailSender } = await import('../src/email');

describe('createNodeEmailSender', () => {
    beforeEach(() => {
        mockSendMail.mockReset();
    });

    it('builds a sender exposing send() that returns { messageId }', async () => {
        mockSendMail.mockResolvedValue({ messageId: '<test@localhost>' });
        const sender = createNodeEmailSender({
            host: 'smtp.example.com',
            port: 587,
            auth: { user: 'u', pass: 'p' },
        });

        const result = await sender.send({
            to: 'dest@example.com',
            from: 'src@example.com',
            subject: 'Hi',
            html: '<b>Hi</b>',
            text: 'Hi',
        });

        expect(result).toEqual({ messageId: '<test@localhost>' });
    });

    it('maps message fields onto nodemailer sendMail options', async () => {
        mockSendMail.mockResolvedValue({ messageId: 'm' });
        const sender = createNodeEmailSender({
            host: 'smtp.example.com',
            port: 465,
            secure: true,
            auth: { user: 'u', pass: 'p' },
            from: 'default@example.com',
        });

        await sender.send({
            to: 'a@example.com',
            from: 'src@example.com',
            cc: 'b@example.com',
            bcc: 'c@example.com',
            replyTo: 'r@example.com',
            subject: 'S',
            html: '<p>h</p>',
            text: 't',
        } as any);

        expect(mockSendMail).toHaveBeenCalledOnce();
        const arg = mockSendMail.mock.calls[0][0];
        expect(arg).toMatchObject({
            to: 'a@example.com',
            cc: 'b@example.com',
            bcc: 'c@example.com',
            replyTo: 'r@example.com',
            subject: 'S',
            html: '<p>h</p>',
            text: 't',
        });
        // explicit from on the message wins over the configured default
        expect(arg.from).toBe('src@example.com');
    });

    it('falls back to the configured default from when message omits it', async () => {
        mockSendMail.mockResolvedValue({ messageId: 'm' });
        const sender = createNodeEmailSender({
            host: 'smtp.example.com',
            port: 587,
            auth: { user: 'u', pass: 'p' },
            from: 'default@example.com',
        });

        await sender.send({
            to: 'a@example.com',
            subject: 'S',
            text: 't',
        } as any);

        expect(mockSendMail.mock.calls[0][0].from).toBe('default@example.com');
    });

    it('rethrows on transport error (fail loud)', async () => {
        mockSendMail.mockRejectedValue(new Error('SMTP down'));
        const sender = createNodeEmailSender({
            host: 'smtp.example.com',
            port: 587,
            auth: { user: 'u', pass: 'p' },
        });

        await expect(
            sender.send({ to: 'a@example.com', from: 's@example.com', subject: 'x' }),
        ).rejects.toThrow('SMTP down');
    });
});
