---
title: 'CMS Block References'
description: 'Blocks and bindings inside text: syntax, nesting, scopes, where they work, and how block types opt in.'
---

# CMS Block References

A block reference puts a block inside text, as a shortcode does in WordPress. Bindings put
values inside text. Both use `{{ }}`:

```text
{{ $.price }}                                              a value of the entry shown
{{ $site.title }}                                          a site setting
{{ $user.name }}                                           the signed-in user
{{ block core/button label="Buy" url="/cart" /}}           a block without a body
{{ block core/button label="Buy {{ $.title }}" url="/" /}} a value in an attribute
{{ block core/button url="/" }}Price is {{ $.price }}{{ /block }}
{{ block core/group }} …blocks and text… {{ /block }}      a container and its children
{{ pattern hero /}}                                        a synced pattern, by slug
\{{ … }}                                                   written as is
```

## Where they work

| Place | Bindings | Block references |
| --- | --- | --- |
| Text fields of blocks (string and text) | Yes | Markdown fields only, such as Paragraph |
| An entry's Markdown fields | Yes | Yes |
| Widgets (Appearance → Widgets) | Yes | Yes, in their Markdown fields |
| Theme options (Appearance → Customize) | Yes | No |
| Rich text | No | Embed blocks with the editor's block button |

## Tags

- A tag without a body ends with `/}}`. Any other tag opens a body, and `{{ /block }}` closes
  it. The closing tag may repeat the name, as in `{{ /block core/group }}`. When it does, the
  name must match the open block.
- Attribute values are quoted strings, numbers, `true` or `false`. A bare name means `true`,
  as in `{{ block core/group wide }}`. Inside quotes, `\"` writes a quote.
- Lists and objects cannot be attributes. Use children or a pattern for them.
- Other `{{ … }}` text, such as `{{ name }}`, stays as written.

## Bodies and children

What a body holds depends on the block type:

- **A container** (a type with `children`) takes its body as children. Each tag becomes a
  child block. Loose text between tags becomes a Paragraph. That is an error when the
  container does not allow paragraphs. For example, `core/columns` holds only `core/column`.
- **A leaf block** puts its body in the field its type names as `body`. For example,
  `core/button` puts it in `label`. A leaf body cannot hold blocks. A type without `body`
  needs `/}}`.

Giving a field both as an attribute and as the body is an error.

## Values in text

Fixed text and bindings mix freely, in attributes and in bodies. `{{ $.price }}` reads the
entry shown, `{{ $site.title }}` reads a site setting and `{{ $user.name }}` reads the
signed-in user. A path walks into objects and lists with dots, as in
`{{ $.specs.0.name }}`.

- `$` is empty where no entry is shown, such as a widget on an archive page.
- `$site` holds `title`, `tagline`, `logo` and `icon`.
- `$user` holds `name`. It is empty for visitors. A signed-in user's page that reads `$user`
  is sent with `cache-control: private, no-store`.
- A binding to another scope, such as `{{ $page.title }}`, is refused when the content is
  saved.
- A bare `$.price`, without braces, is plain text. Text such as "costs $.99" never turns into
  a binding.

## Checks and limits

Content is checked when it is saved. An unknown block, a type that does not allow references,
a missing required field or a wrong attribute is a validation error on its field. At render,
a reference that is still wrong renders nothing.

References nest up to the block depth limit, which is 4 levels, and one text holds at most
200 of them. A `{{ pattern }}` expands one level: patterns inside it are left out.

The site parses each text with references once per isolate and keeps the result. Text
without references is never parsed.

## Letting a block type be referenced

A block type opts in with `inline: true`. It may also name its `body` field, a string or text
field that a reference's body fills:

```json
{ "name": "acme/badge", "label": "Badge", "inline": true, "body": "text",
  "fields": { "text": { "kind": "string", "max": 40 }, "tone": { "kind": "enum", "values": ["info", "warning"] } } }
```

These core blocks can be referenced:

- Text: Paragraph, Heading, Quote and Quick answer. Their body is their text.
- Button. Its body is its label.
- Media: Image, Gallery, Video, Audio, Video embed and Card.
- Layout: Divider, Group, Columns, Column and Grid.
- Latest entries.

## In code

`parseBlockText(text, types)` from `@cossackframework/cms` returns the text's `parts` (text
runs and blocks) and its `problems`. `hasBlockReference(text)` says whether a text needs
parsing. `textBlocks(parsed)` returns the blocks. `validateBlocks` checks references in
Markdown fields and binding scopes in every text field.

For bindings, `resolveBindings(text, { entry, site, user })` resolves them,
`bindingRefs(text)` lists them with their scopes, and `bindingProblem(text)` reports an
unknown scope.

A Markdown field with references renders as `block.content.<field>`. Themes draw it with
`helpers.content()`, which the core Paragraph and Quick answer renderers already do.
`block.html.<field>` holds the text runs alone.
