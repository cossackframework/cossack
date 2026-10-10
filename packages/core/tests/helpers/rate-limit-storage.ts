// Transactional storage double. Platform concurrency/eviction are tested in workerd.
export class RateLimitStorageFixture {
    records = new Map<string, unknown>();
    alarmTime: number | null = null;
    failWrite = false;
    failAlarm = false;
    private tail: Promise<unknown> = Promise.resolve();

    state(): DurableObjectState {
        return { storage: this } as unknown as DurableObjectState;
    }

    transaction<T>(callback: (txn: DurableObjectTransaction) => Promise<T>): Promise<T> {
        const run = this.tail.then(async () => {
            const records = new Map(this.records);
            let alarmTime = this.alarmTime;
            const txn = {
                get: async (key: string) => structuredClone(records.get(key)),
                put: async (key: string, value: unknown) => {
                    if (this.failWrite) throw new Error('storage write failed');
                    records.set(key, structuredClone(value));
                },
                delete: async (key: string) => records.delete(key),
                setAlarm: async (time: number) => {
                    if (this.failAlarm) throw new Error('alarm write failed');
                    alarmTime = time;
                },
                deleteAlarm: async () => { alarmTime = null; },
            };
            const result = await callback(txn as unknown as DurableObjectTransaction);
            this.records = records;
            this.alarmTime = alarmTime;
            return result;
        });
        this.tail = run.catch(() => {});
        return run;
    }
}
