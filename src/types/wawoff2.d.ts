/** Google's WOFF2 decoder compiled to WebAssembly (wawoff2). */
declare module 'wawoff2/decompress.js' {
  const decompress: (woff2: Uint8Array) => Promise<Uint8Array>;
  export default decompress;
}
