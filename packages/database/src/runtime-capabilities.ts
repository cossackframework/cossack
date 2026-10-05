import type { Driver, DialectName } from './adapter/types.js';

export interface ProviderCapabilityReport {
  readonly provider: string;
  readonly dialect: DialectName;
  readonly transactions: { readonly interactive: boolean; readonly nested: boolean; readonly atomicBatch: boolean; readonly ddlRollback: boolean };
  readonly schema: Readonly<Record<'createTable' | 'dropTable' | 'renameTable' | 'addColumn' | 'dropColumn' | 'renameColumn' | 'alterColumn', boolean>>;
  readonly generated: { readonly increment: boolean; readonly identity: boolean; readonly uuid: 'client' };
  readonly returning: boolean;
  readonly reserveConnection: boolean;
  readonly cancellation: boolean;
  readonly parameterLimit: number;
  readonly batchLimit: number;
}
/** Driver declarations describe local support, not remote connectivity or server versions. */
export function inspectProviderCapabilities(driver: Driver, provider: unknown = driver.dialect): ProviderCapabilityReport {
  const capabilities = driver.capabilities;
  const interactive = capabilities.transactions && typeof driver.transaction === 'function';
  return Object.freeze({
    provider: typeof provider === 'string' && /^[a-zA-Z0-9_.-]{1,64}$/.test(provider) ? provider : 'custom',
    dialect: driver.dialect,
    transactions: Object.freeze({ interactive, nested: interactive && capabilities.savepoints,
      atomicBatch: capabilities.batch && typeof driver.batch === 'function', ddlRollback: driver.dialect !== 'mysql' && interactive }),
    schema: Object.freeze({ createTable: true, dropTable: true, renameTable: true, addColumn: true, dropColumn: true,
      renameColumn: true, alterColumn: driver.dialect !== 'sqlite' }),
    generated: Object.freeze({ increment: true, identity: driver.dialect === 'postgres', uuid: 'client' as const }),
    returning: capabilities.returning, reserveConnection: capabilities.reserveConnection && typeof driver.reserve === 'function',
    cancellation: capabilities.cancellation, parameterLimit: capabilities.parameterLimit, batchLimit: capabilities.batchLimit,
  });
}
