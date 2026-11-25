/**
 * 中英混合斷詞：與匯出器（tools/export/export.mjs）保持同一套規則。
 * 中文採用「單字 + 相鄰二字」切片；英文／數字以詞為單位並轉小寫。
 * 這是最小可用的檢索分詞，不需外部字典，索引可重建。
 */

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff]/;
const LATIN = /[a-z0-9]/;

export function tokenize(input: string): string[] {
  if (!input) return [];
  const text = input.normalize('NFKC').toLowerCase();
  const out: string[] = [];
  let latin = '';
  const flushLatin = () => {
    if (latin.length >= 2) out.push(latin);
    else if (latin.length === 1) out.push(latin);
    latin = '';
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (CJK.test(ch)) {
      flushLatin();
      out.push(ch);
      const next = text[i + 1];
      if (next && CJK.test(next)) out.push(ch + next);
    } else if (LATIN.test(ch) || ch === '-' || ch === '_' || ch === '+') {
      if (ch === '-' || ch === '_' || ch === '+') {
        if (latin.length > 0) latin += ch;
      } else {
        latin += ch;
      }
    } else {
      flushLatin();
    }
  }
  flushLatin();
  return out;
}

export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** int8 量化向量（128 維）解碼為 Float32Array，已 L2 正規化。 */
export function decodeVector(b64: string, dim = 128): Float32Array {
  const out = new Float32Array(dim);
  if (!b64) return out;
  const bin = atob(b64);
  for (let i = 0; i < dim && i < bin.length; i += 1) {
    const v = bin.charCodeAt(i);
    out[i] = (v > 127 ? v - 256 : v) / 127;
  }
  return out;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}
