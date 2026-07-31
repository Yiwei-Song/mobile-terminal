// qrcode-terminal ships no types and @types/qrcode-terminal would be a whole
// dependency for one function. It is CJS (`module.exports = {...}`), so only the
// default import resolves at runtime — a named `generate` import is undefined.
declare module "qrcode-terminal" {
  const qrcode: { generate(text: string, opts?: { small?: boolean }): void };
  export default qrcode;
}
