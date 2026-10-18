/* Minimal EMF reader for tests: walks records, validates structure and decodes the few records we assert on. */

export type EmfRecord = { type: number; size: number; offset: number; data: DataView };

export type EmfFile = {
  records: EmfRecord[];
  header: {
    bounds: [number, number, number, number];
    frame: [number, number, number, number];
    signature: number;
    version: number;
    bytes: number;
    nRecords: number;
    handles: number;
    device: [number, number];
    millimeters: [number, number];
    description: string;
  };
};

export function readEmf(bytes: Uint8Array): EmfFile {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const records: EmfRecord[] = [];
  let i = 0;
  while (i < bytes.length) {
    if (i + 8 > bytes.length) throw new Error(`Truncated record at ${i}`);
    const type = dv.getUint32(i, true);
    const size = dv.getUint32(i + 4, true);
    if (size < 8 || size % 4 !== 0) throw new Error(`Bad record size ${size} (type ${type}) at ${i}`);
    if (i + size > bytes.length) throw new Error(`Record overruns file at ${i}`);
    records.push({ type, size, offset: i, data: new DataView(bytes.buffer, bytes.byteOffset + i, size) });
    i += size;
    if (type === 14) break;
  }
  const h = records[0].data;
  if (records[0].type !== 1) throw new Error('First record is not EMR_HEADER');
  const rect = (o: number): [number, number, number, number] => [
    h.getInt32(o, true),
    h.getInt32(o + 4, true),
    h.getInt32(o + 8, true),
    h.getInt32(o + 12, true),
  ];
  const nDesc = h.getUint32(60, true);
  const offDesc = h.getUint32(64, true);
  let description = '';
  for (let k = 0; k < nDesc; k++) description += String.fromCharCode(h.getUint16(offDesc + k * 2, true));
  return {
    records,
    header: {
      bounds: rect(8),
      frame: rect(24),
      signature: h.getUint32(40, true),
      version: h.getUint32(44, true),
      bytes: h.getUint32(48, true),
      nRecords: h.getUint32(52, true),
      handles: h.getUint16(56, true),
      device: [h.getInt32(72, true), h.getInt32(76, true)],
      millimeters: [h.getInt32(80, true), h.getInt32(84, true)],
      description,
    },
  };
}

export const u32 = (r: EmfRecord, at: number) => r.data.getUint32(at, true);
export const i32 = (r: EmfRecord, at: number) => r.data.getInt32(at, true);
