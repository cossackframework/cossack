export interface StartupProfileMeasurements {
  localStartupProfileMs: number;
  localStartupActiveMs?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonnegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Extract local CPU profile timings without retaining profile content. */
export function parseStartupProfile(input: unknown): StartupProfileMeasurements | undefined {
  try {
    if (!isRecord(input)) return undefined;
    const { startTime, endTime, nodes, samples, timeDeltas } = input;
    if (!isNonnegativeInteger(startTime) || !isNonnegativeInteger(endTime) || endTime <= startTime) {
      return undefined;
    }
    if (!Array.isArray(nodes) || nodes.length > 100_000 || !Array.isArray(samples) ||
        !Array.isArray(timeDeltas) || samples.length !== timeDeltas.length || samples.length > 1_000_000) {
      return undefined;
    }

    const idleNodes = new Map<number, boolean>();
    for (const node of nodes) {
      if (!isRecord(node) || !isNonnegativeInteger(node.id) || node.id === 0 || idleNodes.has(node.id) ||
          !isRecord(node.callFrame) || typeof node.callFrame.functionName !== 'string') return undefined;
      idleNodes.set(node.id, node.callFrame.functionName === '(idle)');
    }

    let total = 0;
    let active = 0;
    for (let index = 0; index < samples.length; index++) {
      const sample = samples[index];
      const delta = timeDeltas[index];
      if (!isNonnegativeInteger(sample) || !idleNodes.has(sample) || !isNonnegativeInteger(delta)) {
        return undefined;
      }
      total += delta;
      if (!Number.isSafeInteger(total)) return undefined;
      if (!idleNodes.get(sample)) active += delta;
    }

    const result: StartupProfileMeasurements = { localStartupProfileMs: (endTime - startTime) / 1000 };
    if (samples.length > 0) result.localStartupActiveMs = active / 1000;
    return result;
  } catch {
    return undefined;
  }
}
