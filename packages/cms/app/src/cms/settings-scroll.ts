/** Select the section crossing the reading line, including the last short section. */
export function activeSettingsSection(sections: readonly { id: string; top: number }[], readingLine: number, atEnd: boolean): string | undefined {
    if (atEnd) return sections.at(-1)?.id;
    let current = sections[0]?.id;
    for (const section of sections) {
        if (section.top > readingLine + 1) break;
        current = section.id;
    }
    return current;
}
