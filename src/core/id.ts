/** ULID-style ids (Crockford base32: 10 chars time + 16 chars random). */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let lastTime = 0;
let lastRandom: number[] = [];

function randomChars(n: number): number[] {
  const out: number[] = [];
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < n; i++) out.push(bytes[i] % 32);
  return out;
}

export function ulid(now = Date.now()): string {
  let rand: number[];
  if (now === lastTime) {
    // Monotonic within the same millisecond: increment the previous random part.
    rand = lastRandom.slice();
    for (let i = rand.length - 1; i >= 0; i--) {
      if (rand[i] < 31) {
        rand[i]++;
        break;
      }
      rand[i] = 0;
    }
  } else {
    rand = randomChars(16);
  }
  lastTime = now;
  lastRandom = rand;
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32] + time;
    t = Math.floor(t / 32);
  }
  return time + rand.map((r) => ALPHABET[r]).join('');
}

export const newId = (prefix: string) => `${prefix}_${ulid()}`;
