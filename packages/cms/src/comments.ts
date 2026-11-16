/** Comments: statuses, shape and the checks of a posted comment. Client-safe; the host stores them. */
import { CmsError } from './errors';

export const COMMENT_STATUSES = Object.freeze(['pending', 'approved', 'spam', 'trash'] as const);
export type CommentStatus = (typeof COMMENT_STATUSES)[number];

export interface CommentShape {
    readonly id: string;
    /** The entry's resource, such as `cms/posts`, and ID. */
    readonly resource: string;
    readonly recordId: string;
    readonly parentId: string | null;
    /** The signed-in author, if any. */
    readonly userId: string | null;
    readonly authorName: string;
    readonly authorEmail: string;
    readonly authorUrl: string;
    readonly content: string;
    readonly status: CommentStatus;
    readonly createdAt: number;
    readonly updatedAt: number;
}

export interface CommentRow extends CommentShape {
    readonly ipHash: string | null;
    readonly userAgent: string | null;
}

/** Trimmed comment fields, or a validation error naming the fields. */
export function checkComment(input: { content?: unknown; authorName?: unknown; authorEmail?: unknown; authorUrl?: unknown }, requireNameEmail: boolean): { content: string; authorName: string; authorEmail: string; authorUrl: string } {
    const errors: { [field: string]: string } = {};
    const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
    const content = text(input.content).replace(/\r\n?/g, '\n');
    const authorName = text(input.authorName);
    const authorEmail = text(input.authorEmail).toLowerCase();
    const authorUrl = text(input.authorUrl);
    if (!content) errors.content = 'Write a comment.';
    else if ([...content].length > 5000) errors.content = 'Comments can be at most 5000 characters.';
    if (requireNameEmail && !authorName) errors.authorName = 'Enter your name.';
    if (authorName.length > 100) errors.authorName = 'Names can be at most 100 characters.';
    if (requireNameEmail && !authorEmail) errors.authorEmail = 'Enter your email address.';
    else if (authorEmail && (authorEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(authorEmail))) errors.authorEmail = 'Enter a valid email address.';
    if (authorUrl && (authorUrl.length > 200 || !/^https?:\/\/[^\s]+$/.test(authorUrl))) errors.authorUrl = 'Enter a website starting with https://.';
    if (Object.keys(errors).length) throw new CmsError('CMS_VALIDATION', Object.values(errors).join(' '), { fields: errors });
    return { content, authorName, authorEmail, authorUrl };
}
