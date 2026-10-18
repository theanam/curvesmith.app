declare module 'pathkit-wasm/bin/pathkit.js' {
  const init: (opts?: {
    locateFile?: (file: string) => string;
    wasmBinary?: ArrayBuffer | Uint8Array;
  }) => Promise<unknown>;
  export default init;
}

declare module 'opentype.js';
