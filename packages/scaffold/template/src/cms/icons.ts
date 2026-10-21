/** Icons for collections and dashboard sections. Collections choose one by name in the builder. */
import type { IconEntry } from '@cossackframework/solar-icons/types';
import { DocumentTextIcon } from '@cossackframework/solar-icons/document-text/line';
import { NotebookIcon } from '@cossackframework/solar-icons/notebook/line';
import { BoxIcon } from '@cossackframework/solar-icons/box/line';
import { Bag4Icon } from '@cossackframework/solar-icons/bag-4/line';
import { CartLarge2Icon } from '@cossackframework/solar-icons/cart-large-2/line';
import { ShopIcon } from '@cossackframework/solar-icons/shop/line';
import { GalleryIcon } from '@cossackframework/solar-icons/gallery/line';
import { CalendarMarkIcon } from '@cossackframework/solar-icons/calendar-mark/line';
import { MapPointIcon } from '@cossackframework/solar-icons/map-point/line';
import { StarIcon } from '@cossackframework/solar-icons/star/line';
import { BookmarkIcon } from '@cossackframework/solar-icons/bookmark/line';
import { CaseIcon } from '@cossackframework/solar-icons/case/line';
import { CupIcon } from '@cossackframework/solar-icons/cup/line';
import { Home2Icon } from '@cossackframework/solar-icons/home-2/line';
import { NotesIcon } from '@cossackframework/solar-icons/notes/line';
import { ClipboardListIcon } from '@cossackframework/solar-icons/clipboard-list/line';
import { GraphIcon } from '@cossackframework/solar-icons/graph/line';
import { MedalRibbonIcon } from '@cossackframework/solar-icons/medal-ribbon/line';
import { VideoLibraryIcon } from '@cossackframework/solar-icons/video-library/line';
import { MusicNoteIcon } from '@cossackframework/solar-icons/music-note/line';
import { BookIcon } from '@cossackframework/solar-icons/book/line';
import { TicketIcon } from '@cossackframework/solar-icons/ticket/line';
import { UserIdIcon } from '@cossackframework/solar-icons/user-id/line';
import { HashtagIcon } from '@cossackframework/solar-icons/hashtag/line';
import { FolderIcon } from '@cossackframework/solar-icons/folder/line';
import { TagIcon } from '@cossackframework/solar-icons/tag/line';
import { Widget4Icon } from '@cossackframework/solar-icons/widget-4/line';
import { StructureIcon } from '@cossackframework/solar-icons/structure/line';
import { Tuning2Icon } from '@cossackframework/solar-icons/tuning-2/line';
import { Server2Icon } from '@cossackframework/solar-icons/server-2/line';
import { PlugCircleIcon } from '@cossackframework/solar-icons/plug-circle/line';
import { SettingsIcon } from '@cossackframework/solar-icons/settings/line';
import { TextFieldIcon } from '@cossackframework/solar-icons/text-field/line';
import { Palette2Icon } from '@cossackframework/solar-icons/palette-2/line';
import { WidgetAddIcon } from '@cossackframework/solar-icons/widget-add/line';
import { ChatRoundDotsIcon } from '@cossackframework/solar-icons/chat-round-dots/line';
import { ParagraphSpacingIcon } from '@cossackframework/solar-icons/paragraph-spacing/line';
import { TextBoldIcon } from '@cossackframework/solar-icons/text-bold/line';
import { GalleryWideIcon } from '@cossackframework/solar-icons/gallery-wide/line';
import { ChatRoundLineIcon } from '@cossackframework/solar-icons/chat-round-line/line';
import { ListIcon } from '@cossackframework/solar-icons/list/line';
import { CodeSquareIcon } from '@cossackframework/solar-icons/code-square/line';
import { CursorSquareIcon } from '@cossackframework/solar-icons/cursor-square/line';
import { PlayCircleIcon } from '@cossackframework/solar-icons/play-circle/line';
import { MinusSquareIcon } from '@cossackframework/solar-icons/minus-square/line';
import { LayersIcon } from '@cossackframework/solar-icons/layers/line';
import { WidgetIcon } from '@cossackframework/solar-icons/widget/line';
import { Widget2Icon } from '@cossackframework/solar-icons/widget-2/line';
import { Widget3Icon } from '@cossackframework/solar-icons/widget-3/line';

export const ICONS: Readonly<Record<string, IconEntry>> = Object.freeze({
    'document-text': { line: DocumentTextIcon },
    'notebook': { line: NotebookIcon },
    'box': { line: BoxIcon },
    'bag-4': { line: Bag4Icon },
    'cart-large-2': { line: CartLarge2Icon },
    'shop': { line: ShopIcon },
    'gallery': { line: GalleryIcon },
    'calendar-mark': { line: CalendarMarkIcon },
    'map-point': { line: MapPointIcon },
    'star': { line: StarIcon },
    'bookmark': { line: BookmarkIcon },
    'case': { line: CaseIcon },
    'cup': { line: CupIcon },
    'home-2': { line: Home2Icon },
    'notes': { line: NotesIcon },
    'clipboard-list': { line: ClipboardListIcon },
    'graph': { line: GraphIcon },
    'medal-ribbon': { line: MedalRibbonIcon },
    'video-library': { line: VideoLibraryIcon },
    'music-note': { line: MusicNoteIcon },
    'book': { line: BookIcon },
    'ticket': { line: TicketIcon },
    'user-id': { line: UserIdIcon },
    'hashtag': { line: HashtagIcon },
    'folder': { line: FolderIcon },
    'tag': { line: TagIcon },
    'widget-4': { line: Widget4Icon },
    'structure': { line: StructureIcon },
    'tuning-2': { line: Tuning2Icon },
    'server-2': { line: Server2Icon },
    'plug-circle': { line: PlugCircleIcon },
    'settings': { line: SettingsIcon },
    'text-field': { line: TextFieldIcon },
    'palette-2': { line: Palette2Icon },
    'widget-add': { line: WidgetAddIcon },
    'chat-round-dots': { line: ChatRoundDotsIcon },
    // Blocks.
    'paragraph-spacing': { line: ParagraphSpacingIcon },
    'text-bold': { line: TextBoldIcon },
    'gallery-wide': { line: GalleryWideIcon },
    'chat-round-line': { line: ChatRoundLineIcon },
    'list': { line: ListIcon },
    'code-square': { line: CodeSquareIcon },
    'cursor-square': { line: CursorSquareIcon },
    'play-circle': { line: PlayCircleIcon },
    'minus-square': { line: MinusSquareIcon },
    'layers': { line: LayersIcon },
    'widget': { line: WidgetIcon },
    'widget-2': { line: Widget2Icon },
    'widget-3': { line: Widget3Icon },
});

/** Names offered for collections, in the builder's order. */
export const COLLECTION_ICONS = Object.freeze(['document-text', 'notebook', 'box', 'bag-4', 'cart-large-2', 'shop', 'gallery', 'calendar-mark', 'map-point', 'star', 'bookmark', 'case', 'cup', 'home-2', 'notes', 'clipboard-list', 'graph', 'medal-ribbon', 'video-library', 'music-note', 'book', 'ticket', 'user-id', 'hashtag', 'widget-add']);

export function icon(name: string | undefined, fallback = 'document-text'): IconEntry {
    return ICONS[name ?? ''] ?? ICONS[fallback]!;
}

/** A block's icon; plugin blocks naming an icon this map lacks get a generic one. */
export function blockIcon(name: string | undefined): IconEntry {
    return icon(name, 'widget-4');
}
