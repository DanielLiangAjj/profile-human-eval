// Opens data/items.enc.json. The items (names, texts and paper titles of real people) are published only in
// encrypted form; the access phrase comes with the invitation link (after #k=) and never leaves the browser.
// Format written by scripts/export_items.py: PBKDF2-SHA256 -> AES-256-GCM over the gzip-compressed JSON.

export class PhraseError extends Error {}

function fromB64(text) {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The phrase as typed or pasted: spaces and line breaks removed. */
export const normalizePhrase = (text) => String(text || '').replace(/\s+/g, '');

async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Decrypt the box {kdf, iterations, salt, iv, ciphertext, compression}; throws PhraseError for a wrong phrase. */
export async function openBox(box, phrase) {
  if (!globalThis.crypto || !crypto.subtle) throw new Error('This page must be opened over https (or on localhost).');
  if (!box || box.kdf !== 'PBKDF2-SHA256' || box.cipher !== 'AES-256-GCM') throw new Error('Unknown items format.');
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(phrase), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: fromB64(box.salt), iterations: box.iterations, hash: 'SHA-256' },
    material, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(box.iv) }, key, fromB64(box.ciphertext));
  } catch {
    throw new PhraseError('The access phrase does not open the items.');
  }
  let bytes = new Uint8Array(plain);
  if (box.compression === 'gzip') bytes = await gunzip(bytes);
  return JSON.parse(new TextDecoder().decode(bytes));
}
