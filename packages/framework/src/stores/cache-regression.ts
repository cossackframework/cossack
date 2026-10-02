let version = 1;

export function readVersion(): number {
    return version;
}

export function incrementVersion(): number {
    version++;
    return version;
}
