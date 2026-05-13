import { NAV_ENDPOINT } from '../../shared/constants';
import { biliGet } from './client';

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

let cachedMixinKey: string | null = null;
let cachedAt = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

function md5(str: string): string {
  // Simple MD5 implementation for WBI signing
  // In production, use a proper crypto library or Web Crypto API
  function rotateLeft(n: number, s: number): number {
    return (n << s) | (n >>> (32 - s));
  }

  function toHex(n: number): string {
    let hex = '';
    for (let i = 0; i < 4; i++) {
      hex += ((n >>> (i * 8)) & 0xff).toString(16).padStart(2, '0');
    }
    return hex;
  }

  // Encode string to UTF-8 bytes
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }

  // Padding
  const msgLen = bytes.length * 8;
  bytes.push(0x80);
  while ((bytes.length % 64) !== 56) {
    bytes.push(0);
  }

  // Append length
  for (let i = 0; i < 8; i++) {
    bytes.push((msgLen >>> (i * 8)) & 0xff);
  }

  // Constants
  const T: number[] = [];
  for (let i = 0; i < 64; i++) {
    T[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000);
  }

  // Process
  let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476;

  for (let i = 0; i < bytes.length; i += 64) {
    const chunk = bytes.slice(i, i + 64);
    const X: number[] = [];
    for (let j = 0; j < 16; j++) {
      X[j] = chunk[j * 4] | (chunk[j * 4 + 1] << 8) | (chunk[j * 4 + 2] << 16) | (chunk[j * 4 + 3] << 24);
    }

    let aa = a, bb = b, cc = c, dd = d;

    for (let j = 0; j < 64; j++) {
      let f: number, g: number;
      if (j < 16) {
        f = (b & c) | (~b & d);
        g = j;
      } else if (j < 32) {
        f = (d & b) | (~d & c);
        g = (5 * j + 1) % 16;
      } else if (j < 48) {
        f = b ^ c ^ d;
        g = (3 * j + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * j) % 16;
      }

      const temp = d;
      d = c;
      c = b;
      b = b + rotateLeft(a + f + X[g] + T[j], [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21][
        j < 16 ? j % 4 : j < 32 ? j % 4 + 4 : j < 48 ? j % 4 + 8 : j % 4 + 12
      ]);
      a = temp;
    }

    a = (a + aa) >>> 0;
    b = (b + bb) >>> 0;
    c = (c + cc) >>> 0;
    d = (d + dd) >>> 0;
  }

  return toHex(a) + toHex(b) + toHex(c) + toHex(d);
}

async function fetchMixinKey(): Promise<string> {
  if (cachedMixinKey && Date.now() - cachedAt < CACHE_TTL) {
    return cachedMixinKey;
  }

  const nav = await biliGet<{ wbi_img: { img_url: string; sub_url: string } }>(NAV_ENDPOINT);
  const imgUrl = nav.wbi_img.img_url;
  const subUrl = nav.wbi_img.sub_url;

  const imgKey = imgUrl.split('/').pop()!.split('.')[0];
  const subKey = subUrl.split('/').pop()!.split('.')[0];
  const rawKey = imgKey + subKey;

  cachedMixinKey = MIXIN_KEY_ENC_TAB.map(i => rawKey[i]).join('').slice(0, 32);
  cachedAt = Date.now();

  return cachedMixinKey;
}

export async function signWbi(params: URLSearchParams): Promise<void> {
  const mixinKey = await fetchMixinKey();
  const wts = String(Math.floor(Date.now() / 1000));
  params.set('wts', wts);

  const sorted = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b));
  const queryStr = sorted.map(([k, v]) => `${k}=${v}`).join('&');
  const toHash = queryStr + mixinKey;
  const wRid = md5(toHash);

  params.set('w_rid', wRid);
}
