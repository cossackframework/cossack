// Client-safe CMS declarations: resources, fields, permissions, extension points and records.
export { defineResource, resolveResource, resourceProblems, storageName, permissionFor, declarationHash, canonicalJson, SYSTEM_FIELDS, RESOURCE_NAME, OWNER_NAME, ResourceDeclarationError,
    type ResourceDeclaration, type Resource, type ResourceAccess, type ResourceAction, type AccessRule, type IndexDeclaration, type MigrationStep } from './resource';
export { field, fieldProblems, validateValue, storageType, storageCheck, slugify, FIELD_NAME, SLUG_PATTERN, TAXONOMY_NAME, type FieldDeclaration, type FieldKind, type ListItemKind } from './fields';
export { ANONYMOUS, PERMISSIONS, DEFAULT_ROLES, systemPrincipal, userPrincipal, hasPermission, permissionMatches, evaluateRule, ruleScope, principalId, type Principal, type RecordScope } from './permissions';
export { CmsError, isCmsError, type CmsErrorCode } from './errors';
export { beforeWrite, afterCommit, EXTENSION_POINTS, type BeforeWriteInput, type Draft, type ResourceEvent, type WriteActor } from './hooks';
export type { RecordShape, RecordPage, RevisionShape, FieldFilter, ListFilter, ListOptions } from './records';
export { contentModule, categories, tags, patterns } from './modules/content';
export { CONTENT_STATUSES, CORE_FIELDS, LOCALE, SEO_FIELDS, collectionProblems, collectionResource, entryUrl, extendCollection, orderedFields, posts, pages, type CollectionDefinition, type ContentStatus } from './collections';
export { CORE_BLOCKS, BLOCK_NAME, blockProblems, blocksShapeProblem, validateBlocks, blockMedia, blockId, type Block, type BlockDeclaration } from './blocks';
export { formInput, formValue, recordTitle, isSameOriginPost, type FormInput, type SubmittedForm } from './forms';
export { manifestProblems, validateManifest, requestedGrants, commandInput, ManifestError, HOST_SLOTS, type CmsPluginManifest, type PluginCommand, type CommandOption, type SlotLink, type HostSlot } from './manifest';
export { MEDIA_TYPES, AVATAR_TYPES, MEDIA_FILTERS, mediaKind, mediaUrl, formatBytes, matchesSignature, imageSize, type MediaKind } from './media';
export { taxonomyProblems, type TaxonomyDeclaration, type TermShape } from './taxonomy';
export { general, media, appearance, writing, reading, discussion, seo, languages, DATE_FORMATS, TIME_FORMATS, TITLE_SEPARATORS, formatSiteDate, validTimeZone, type SettingsGroup, type SettingDeclaration, type SettingSource, type SiteSettings } from './settings';
export type { CmsModule, ModuleContext } from './module';
export {
    MENU_LIMITS, MENU_LOCATION, menuProblems, normalizeMenu, menuSize, menuItemId, flattenMenu, buildMenu, subtreeEnd, dropDepths, moveRows, shiftRows, allowedMoves,
    type MenuItem, type MenuItemKind, type MenuShape, type MenuItemView, type MenuRow, type MenuMove,
} from './menus';
export {
    RICH_TEXT_LIMITS, RICH_TEXT_NODES, RICH_TEXT_MARKS, checkRichText, richTextProblem, normalizeRichText, emptyRichText, richTextFromPlain, richTextEmpty, richTextPlain, richTextExcerpt, richTextBlocks, richTextMedia,
    richTextParts, richTextHtml, withRichTextBlocks, escapeHtml, safeLinkUrl, safeImageUrl,
    type RichTextDoc, type RichTextNode, type RichTextMark, type EmbeddedBlock, type ContentPart, type RichTextRenderOptions, type RichTextMediaInfo,
} from './richtext';
export {
    themeProblems, siteThemeProblems,
    type ThemeManifest, type SiteTheme, type ThemeHelpers, type SiteView, type EntryView, type ArchiveView, type RenderedBlock, type BodyPart, type MediaView, type TermLink, type Paging,
    type CommentView, type CommentsView, type CommentFormView, type LanguageLink,
} from './theme';
export { diffWords, compareRecords, comparableValue, type DiffPart, type FieldChange } from './diff';
export { REDIRECT_STATUSES, REDIRECT_PATH, redirectPath, redirectProblems, type Redirect, type RedirectInput, type RedirectStatus } from './redirects';
export { WEBHOOK_EVENTS, webhookUrlProblem, type Webhook, type WebhookDelivery, type WebhookEvent, type WebhookInput, type WebhookPayload } from './webhooks';
export { COMMENT_STATUSES, checkComment, type CommentShape, type CommentRow, type CommentStatus } from './comments';
export { IMAGE_WIDTHS, TRANSFORMABLE_TYPES, imageEditsProblems, editedSize, variantWidth, variantRect, transformable, imageUrl, imageSrcset, type ImageEdits, type ImageRect, type ImageSource } from './images';
