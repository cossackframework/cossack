import { snapshotRpcValue } from './rpc-stream';

/** File arguments belong to multipart; all other values use the JSON contract. */
export function snapshotRpcPayload(payload: unknown[]): { payload: unknown[]; files: Map<string, File> } {
    const files = new Map<string, File>();
    const isFile = (value: object) => typeof File !== 'undefined' && value instanceof File;
    const isFileList = (value: object) => typeof FileList !== 'undefined' && value instanceof FileList;
    const normalized = snapshotRpcValue(payload, 'payload', { handled: value => isFile(value) || isFileList(value) });
    const extract = (value: any): any => {
        if (value && isFile(value)) {
            const id = `file_${files.size}`;
            files.set(id, value);
            return { _cossack_file_id: id };
        }
        if (value && isFileList(value)) return Array.from(value as FileList).map(extract);
        if (Array.isArray(value)) return value.map(extract);
        if (value && typeof value === 'object') {
            const result = Object.create(null);
            for (const key of Object.keys(value)) result[key] = extract(value[key]);
            return result;
        }
        return value;
    };
    return { payload: extract(normalized), files };
}

export function rpcFormData(body: Record<string, unknown>, files: Map<string, File>): FormData {
    const form = new FormData();
    for (const [key, value] of Object.entries(body)) {
        if (value === undefined) continue;
        form.set(key, ['state', 'payload', 'service', 'pageParams'].includes(key) ? JSON.stringify(value) : String(value));
    }
    for (const [id, file] of files) form.set(id, file);
    return form;
}
