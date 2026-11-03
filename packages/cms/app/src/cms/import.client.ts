/**
 * Sending a site export from the browser. The chosen file goes as the request body, so the
 * server reads it as a stream however large it is; the form posts it as a multipart upload
 * when JavaScript is off.
 */

/** Post the form's file to its page; resolves to where to go next, or the server's error. */
export async function sendExport(form: HTMLFormElement, headers: Record<string, string> = {}): Promise<{ next?: string; error?: string }> {
    const file = (form.elements.namedItem('file') as HTMLInputElement | null)?.files?.[0];
    if (!file) return { error: 'Choose an export file.' };
    try {
        const response = await fetch(form.action || location.href, { method: 'POST', body: file, headers: { 'content-type': 'application/json', accept: 'application/json', ...headers } });
        const result = await response.json().catch(() => ({})) as { next?: string; error?: string };
        return response.ok ? { next: result.next ?? location.href } : { error: result.error ?? `The import failed (${response.status}).` };
    } catch { return { error: 'The export could not be sent. Check the connection and try again.' }; }
}
