export function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

export async function readJson(req, maxBytes = 4 * 1024 * 1024) {
  if (req.body) {
    if (typeof req.body === 'string') return req.body ? JSON.parse(req.body) : {};
    return req.body;
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) {
      const err = new Error('حجم الطلب كبير جداً. قلّل حجم النص أو قسّم الملفات.');
      err.statusCode = 413;
      throw err;
    }
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? JSON.parse(raw) : {};
}

export function isAdmin(req, body = {}) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  const supplied = req.headers['x-admin-password'] || body.adminPassword || '';
  return String(supplied) === String(expected);
}

export function hasPublicAccess(req, body = {}) {
  const expected = process.env.PUBLIC_ACCESS_CODE;
  if (!expected) return true;
  const supplied = req.headers['x-access-code'] || body.accessCode || '';
  return String(supplied) === String(expected);
}

export function cleanText(input) {
  return String(input || '')
    .replace(/\u0000/g, '')
    .replace(/[\t\r ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function limitText(input, maxChars) {
  const text = cleanText(input);
  if (!text) return '';
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

export function makeId(prefix = 'src') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export function publicSource(source) {
  return {
    id: source.id,
    groupId: source.groupId || source.id,
    type: source.type,
    name: source.name,
    displayName: source.displayName || source.name,
    url: source.url || '',
    size: source.size || '',
    part: source.part || 1,
    parts: source.parts || 1,
    chars: source.content ? source.content.length : 0,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt
  };
}

export function safeUrl(raw) {
  const url = new URL(String(raw || '').trim().startsWith('http') ? String(raw).trim() : `https://${String(raw || '').trim()}`);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('الرابط يجب أن يبدأ بـ http أو https.');
  return url.toString();
}

export function htmlToText(html) {
  return String(html || '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeArabic(input) {
  return String(input || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/\u0640/g, '')
    .replace(/[إأآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const STOP_WORDS = new Set([
  'هذا','هذه','ذلك','تلك','التي','الذي','الذين','الى','إلى','على','عن','من','في','ما','ماذا','هل','كيف','متى','اين','أين','لماذا','كان','كانت','يكون','تكون','مع','كل','او','أو','ثم','قد','لقد','لا','نعم','هو','هي','هم','هن','ان','أن','إن','اذا','إذا','هناك','عند','بعد','قبل','بين','وفق','حسب','بشأن','بخصوص','القانون','النظام','المادة','مواد'
]);

export function tokenize(input) {
  const normalized = normalizeArabic(input);
  if (!normalized) return [];
  return normalized
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}
