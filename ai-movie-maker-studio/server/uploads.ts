/** Upload rules: allowed types per folder, size limits, and file-signature (magic byte) checks. */
export type UploadKind = 'images' | 'videos' | 'zips' | 'movies' | 'assets' | 'files';
export type Family = 'png' | 'jpeg' | 'gif' | 'webp' | 'mp4' | 'webm' | 'zip' | 'pdf' | 'text';

const MB = 1024 * 1024;

/** Declared content type -> the file families it may really contain. */
export const MIME_FAMILIES: Record<string, Family[]> = {
  'image/png': ['png'],
  'image/jpeg': ['jpeg'],
  'image/webp': ['webp'],
  'image/gif': ['gif'],
  'video/mp4': ['mp4'],
  'video/quicktime': ['mp4'],
  'video/webm': ['webm'],
  'application/zip': ['zip'],
  'application/x-zip-compressed': ['zip'],
  'application/pdf': ['pdf'],
  'text/plain': ['text'],
  'application/json': ['text'],
};

export const UPLOAD_RULES: Record<UploadKind, { mimes: string[]; maxBytes: number }> = {
  images: { mimes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], maxBytes: 15 * MB },
  videos: { mimes: ['video/mp4', 'video/webm', 'video/quicktime'], maxBytes: 30 * MB },
  zips: { mimes: ['application/zip', 'application/x-zip-compressed'], maxBytes: 30 * MB },
  movies: { mimes: ['video/mp4'], maxBytes: 30 * MB },
  assets: { mimes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime'], maxBytes: 30 * MB },
  files: { mimes: ['application/pdf', 'text/plain', 'application/json'], maxBytes: 5 * MB },
};

export const UPLOAD_KINDS = Object.keys(UPLOAD_RULES) as UploadKind[];

/** Detects the real file family from the first bytes. Unknown => null. SVG/HTML are never accepted. */
export function sniffFamily(head: Uint8Array): Family | null {
  const b = head;
  const eq = (off: number, ...bytes: number[]) => bytes.every((v, i) => b[off + i] === v);
  if (b.length >= 8 && eq(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png';
  if (b.length >= 3 && eq(0, 0xff, 0xd8, 0xff)) return 'jpeg';
  if (b.length >= 6 && eq(0, 0x47, 0x49, 0x46, 0x38)) return 'gif';
  if (b.length >= 12 && eq(0, 0x52, 0x49, 0x46, 0x46) && eq(8, 0x57, 0x45, 0x42, 0x50)) return 'webp';
  if (b.length >= 12 && eq(4, 0x66, 0x74, 0x79, 0x70)) return 'mp4'; // "ftyp": mp4 / mov
  if (b.length >= 4 && eq(0, 0x1a, 0x45, 0xdf, 0xa3)) return 'webm';
  if (b.length >= 4 && eq(0, 0x50, 0x4b, 0x03, 0x04)) return 'zip';
  if (b.length >= 4 && eq(0, 0x50, 0x4b, 0x05, 0x06)) return 'zip';
  if (b.length >= 5 && eq(0, 0x25, 0x50, 0x44, 0x46, 0x2d)) return 'pdf';
  // plain text / JSON: valid UTF-8 without NUL bytes and not markup
  if (b.length > 0 && !b.includes(0)) {
    try {
      const t = new TextDecoder('utf-8', { fatal: true }).decode(b);
      if (!/^\s*<(!doctype|html|svg|script|\?xml)/i.test(t)) return 'text';
    } catch {
      return null;
    }
  }
  return null;
}

export type UploadCheck = { ok: true; mime: string } | { ok: false; status: 400 | 413 | 415; error: string };

export function checkDeclared(kind: UploadKind, mime: string, size?: number): UploadCheck {
  const rule = UPLOAD_RULES[kind];
  const m = mime.split(';')[0].trim().toLowerCase();
  if (!rule.mimes.includes(m)) return { ok: false, status: 415, error: `"${m || 'unknown'}" is not allowed in "${kind}". Allowed: ${rule.mimes.join(', ')}.` };
  if (size !== undefined && size > rule.maxBytes) return { ok: false, status: 413, error: `File is too large for "${kind}" (max ${Math.round(rule.maxBytes / MB)} MB).` };
  return { ok: true, mime: m };
}

/** Full check of the real bytes (head + total size) against the declared type. */
export function checkFile(kind: UploadKind, declaredMime: string, head: Uint8Array, size: number): UploadCheck {
  const declared = checkDeclared(kind, declaredMime, size);
  if (!declared.ok) return declared;
  if (size === 0) return { ok: false, status: 400, error: 'Empty file.' };
  const family = sniffFamily(head);
  if (!family || !MIME_FAMILIES[declared.mime].includes(family)) {
    return { ok: false, status: 415, error: `The file content does not match its type (${declared.mime}). It was not stored.` };
  }
  return declared;
}
