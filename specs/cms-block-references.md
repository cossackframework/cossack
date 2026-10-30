# Block references and binding scopes

Blocks and values inside text, for content written where no block editor exists: widget
text, Markdown fields and theme options. This replaces WordPress shortcodes. The guide is
`docs/cms/block-references.md`. This file records the decisions.

## Decisions

- **One `{{ }}` family.** Block tags (`{{ block … }}`, `{{ /block }}`, `{{ pattern … /}}`)
  share their braces with bindings (`{{ $.price }}`). JSON in text was rejected: it needs
  quote escaping, `@{` occurs in code and CSS, and a second brace style would confuse authors.
- **`/}}` ends a tag without a body.** The parser then matches tags without knowing block
  types. A closing tag may repeat the name, and it must match when it does.
- **A body means children or a field, by type.** A container's body becomes its children,
  and loose text in it becomes paragraphs. A leaf's body fills the field the type names as
  `body`.
- **Types opt in with `inline: true`.** Plugins declare `inline` and `body` in their
  manifests, and `blockProblems` checks both.
- **Bindings stay `{{ }}` only.** The bare `$.price` form stays dropped (2026-10-27).
  Quoted attribute values are kept as written and resolve at render, after parsing. A value
  with quotes therefore cannot break a tag.
- **Three binding scopes.** `$` is the entry shown, `$site` holds public settings (title,
  tagline, logo, icon) and `$user` is the signed-in user's name. Unknown scopes are
  validation errors. A signed-in page that reads `$user` is `private, no-store`.
- **Validated on save, parsed once when serving.** `validateBlocks` parses Markdown fields
  with references and validates the blocks they make with the blocks' own rules. The site
  keeps each parsed text in a per-isolate map of 500 entries.
- **Rendered as blocks.** A Markdown field with references renders as
  `block.content.<field>` (`BodyPart[]`), as rich text does. Referenced blocks go through
  the same `renderedBlock`, so media, children and bindings work, and patterns named by slug
  expand one level.

## Changes from the plan

- **The plan said to store the parsed tree next to the text.** That would change the stored
  shape of every text field, and the API, search, exports and editors all read those fields
  as strings. Parsing once per isolate costs the same per request, and saving still finds
  every error.
- **Rich text has no inline chip node.** Rich text already embeds blocks as top-level
  `cmsBlock` nodes, so the text syntax is for Markdown and plain fields.
- **Theme options resolve bindings but not block references.** Templates print options as
  text, and block references there would need a render helper.
- **The editor shows the syntax in its hints but has no autocomplete after `{{`.** The field
  picker still inserts `{{ $.field }}`.
- **References in an entry's own top-level Markdown fields render, but are not validated on
  save.** Only blocks fields run through `validateBlocks`.

## Verified by

`packages/cms/tests/block-references.test.ts` covers parsing, nesting, bodies, problems,
patterns, escapes, depth, save-time checks and declarations. `tests/bindings.test.ts`
covers scopes, unknown scopes and user detection.
