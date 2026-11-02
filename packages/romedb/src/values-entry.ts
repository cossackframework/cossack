// Client-safe typed values and the JSON transport codec. No client, credentials or Node APIs.
export { Float64, Record as RecordId, Vector, type Value } from '@romedb/node/values';
export { toTransport, fromTransport, TRANSPORT_VERSION, type TransportValue } from './transport';
