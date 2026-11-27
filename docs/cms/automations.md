---
title: 'Automations'
description: 'Send an email from the site when an entry is published, a form is submitted or a payment completes.'
---

# Automations

An automation says "when this happens, send this email". It is data, kept in the site's
database and edited under Tools → Automations, which needs the Manage settings permission.
To post the same events to a URL, add a webhook instead (Tools → Webhooks).

## Events

| Event | When |
| --- | --- |
| `entry.published` | An entry goes live. |
| `entry.created` | An entry is created. |
| `entry.updated` | An entry changes. |
| `entry.deleted` | An entry is deleted. |
| `form.submitted` | A form is submitted. |
| `payment.completed` | A payment provider reports a completed payment. |

Conditions narrow an event: `collection` for entry events, `form` (a form's slug) for form
events.

## The email

The action has `to` (up to ten addresses, comma-separated), `subject` and `text`. Each field
binds values as content does ([Block references](/docs/cms/block-references.md)):

- `{{ $.name }}` reads the event: for entries `title`, `collection`, `collectionLabel`, `id`,
  `status`, `path`, `url`, `actor` and `record`; for forms `form`, `formTitle`, `submission`,
  `values` and `origin`; for payments the payment event, such as `customerEmail`, `amount`,
  `currency` and `reference`.
- `{{ $site.title }}` reads the site, and `{{ $user.name }}` the person who acted.

A recipient can be a binding, such as `{{ $.values.email }}` or `{{ $.customerEmail }}`. An
unknown path becomes empty.

```text
To:      {{ $.values.email }}
Subject: Thanks for writing to {{ $site.title }}
Text:    We received your message and will answer soon.
```

## How it runs

Automations run from the outbox, after the change is saved. An automation runs as the user who
saved it or last switched it on, with that user's permissions at the time it runs: saving one
needs read access to what its event carries (the collection's entries, form submissions, or
settings for payments), and an entry is sent without the fields its author may not read. If the
author can no longer act, the automation is skipped until someone switches it on again.

Each automation keeps a count of runs, the time of the last run and the last error. A failure
that may pass is retried with the outbox delivery; automations that already sent for that
delivery are not sent again. A missing email sender or an empty recipient is only recorded.

Emails go out through the site's mail sender with the HTML part from Settings → Email (see
[How an application hosts the CMS](/docs/cms/index.md#how-an-application-hosts-the-cms)).
