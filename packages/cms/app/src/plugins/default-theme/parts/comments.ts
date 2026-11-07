/** The comment list and form below an entry. */
import { component, html, unsafeHTML, type TemplateResult } from '@cossackframework/renderer';
import { Turnstile } from '@cossackframework/ui';
import type { CommentFormView, CommentView, CommentsView } from '@cossackframework/cms';

const INPUT = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring';

/** The comment form; `parent` makes it a reply. The hidden `website` field catches bots. */
function commentForm(form: CommentFormView, parent: string | null): TemplateResult {
    if (form.requireSignIn) return html`<p class="text-sm text-muted-foreground"><a href=${form.signInUrl} class="text-primary hover:underline">${__('Log in')}</a> ${__('to post a comment.')}</p>`;
    const id = (name: string) => `comment-${parent ?? 'new'}-${name}`;
    return html`<form method="post" action=${form.action} class="space-y-3">
        <input type="hidden" name="collection" value=${form.collection}>
        <input type="hidden" name="entry" value=${form.entry}>
        ${parent ? html`<input type="hidden" name="parent" value=${parent}>` : null}
        <div aria-hidden="true" class="hidden"><label>${__('Leave this empty')} <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
        <div class="space-y-1">
            <label for=${id('content')} class="block text-sm font-medium text-foreground">${parent ? __('Your reply') : __('Your comment')}</label>
            <textarea id=${id('content')} name="content" required rows="4" maxlength="5000" class=${INPUT}></textarea>
        </div>
        ${form.userName ? html`<p class="text-xs text-muted-foreground">${__('Commenting as')} ${form.userName}.</p>` : html`<div class="grid gap-3 sm:grid-cols-3">
            <div class="space-y-1"><label for=${id('name')} class="block text-sm font-medium text-foreground">${__('Name')}${form.requireNameEmail ? ' *' : ''}</label>
                <input id=${id('name')} name="authorName" maxlength="100" ?required=${form.requireNameEmail} autocomplete="name" class=${INPUT}></div>
            <div class="space-y-1"><label for=${id('email')} class="block text-sm font-medium text-foreground">${__('Email')}${form.requireNameEmail ? ' *' : ''}</label>
                <input id=${id('email')} name="authorEmail" type="email" maxlength="254" ?required=${form.requireNameEmail} autocomplete="email" class=${INPUT}></div>
            <div class="space-y-1"><label for=${id('url')} class="block text-sm font-medium text-foreground">${__('Website')}</label>
                <input id=${id('url')} name="authorUrl" type="url" maxlength="200" autocomplete="url" class=${INPUT}></div>
        </div>
        <p class="text-xs text-muted-foreground">${__('Your email address will not be published.')}</p>`}
        ${form.turnstileSiteKey ? component(Turnstile, { id: id('verify'), siteKey: form.turnstileSiteKey, action: 'comment', label: __('Bot protection') }) : null}
        <button type="submit" class="rounded-md border-none bg-primary px-4 py-2 text-sm font-medium text-primary-foreground cursor-pointer">${parent ? __('Post reply') : __('Post comment')}</button>
    </form>`;
}

function comment(item: CommentView, form: CommentFormView | null): TemplateResult {
    return html`<li id=${`comment-${item.id}`} class="space-y-3">
        <article class="flex gap-3">
            ${item.avatar ? html`<img src=${item.avatar} alt="" width="40" height="40" class="size-10 shrink-0 rounded-full object-cover">`
                : html`<span aria-hidden="true" class="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground">${[...item.author][0]?.toUpperCase() ?? '?'}</span>`}
            <div class="min-w-0 flex-1 space-y-1">
                <p class="text-sm"><span class="font-semibold text-foreground">${item.authorUrl ? html`<a href=${item.authorUrl} rel="ugc nofollow noopener" class="text-foreground hover:underline">${item.author}</a>` : item.author}</span>
                    <span class="text-muted-foreground"> · ${item.date}</span></p>
                <div class="text-sm leading-6 text-foreground [&_p]:my-2">${unsafeHTML(item.html)}</div>
                ${item.replyable && form ? html`<details class="text-sm"><summary class="cursor-pointer text-primary">${__('Reply')}</summary><div class="mt-3">${commentForm(form, item.id)}</div></details>` : null}
            </div>
        </article>
        ${item.replies.length ? html`<ol class="ml-6 space-y-4 border-l border-border pl-4 sm:ml-12">${item.replies.map(reply => comment(reply, form))}</ol>` : null}
    </li>`;
}

const COMMENT_ERRORS: Record<string, string> = {
    closed: 'Comments are closed.', 'sign-in': 'Log in to comment.', 'too-fast': 'You are commenting too quickly. Wait a moment and try again.',
    invalid: 'Write a comment, with your name and a valid email address.', bot: 'The check against bots failed. Try again.',
};

export function comments(view: CommentsView): TemplateResult {
    return html`<section id="comments" aria-labelledby="comments-title" class="space-y-6 border-t border-border pt-8">
        <h2 id="comments-title" class="text-2xl font-semibold text-foreground">${view.count ? `${view.count} ${view.count === 1 ? __('comment') : __('comments')}` : __('Comments')}</h2>
        ${view.notice === 'held' ? html`<p role="status" class="rounded-md border border-border bg-muted px-3 py-2 text-sm">${__('Thanks! Your comment is awaiting moderation.')}</p>` : null}
        ${view.notice === 'posted' ? html`<p role="status" class="rounded-md border border-border bg-muted px-3 py-2 text-sm">${__('Thanks! Your comment is posted.')}</p>` : null}
        ${view.error ? html`<p role="alert" class="rounded-md border border-destructive/50 px-3 py-2 text-sm text-destructive">${__(COMMENT_ERRORS[view.error] ?? 'Your comment could not be posted.')}</p>` : null}
        ${view.items.length ? html`<ol class="space-y-6">${view.items.map(item => comment(item, view.form))}</ol>` : view.open ? html`<p class="text-sm text-muted-foreground">${__('No comments yet.')}</p>` : null}
        ${view.form ? html`<div class="space-y-3"><h3 class="text-lg font-semibold text-foreground">${__('Leave a comment')}</h3>${commentForm(view.form, null)}</div>`
            : html`<p class="text-sm text-muted-foreground">${__('Comments are closed.')}</p>`}
    </section>`;
}
