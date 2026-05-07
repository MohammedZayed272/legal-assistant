import { loadSourcesStore, saveSourcesStore } from '../lib/store.js';
import {
  cleanText,
  htmlToText,
  isAdmin,
  limitText,
  makeId,
  publicSource,
  readJson,
  safeUrl,
  sendJson
} from '../lib/http.js';

const DEFAULT_SOURCE_CHAR_LIMIT = 120000;
const FETCH_TIMEOUT_MS = 20000;

function getSourceLimit() {
  const value = Number(process.env.SOURCE_CHAR_LIMIT || DEFAULT_SOURCE_CHAR_LIMIT);
  return Number.isFinite(value) && value > 1000 ? value : DEFAULT_SOURCE_CHAR_LIMIT;
}

async function fetchUrlText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': 'NB-Legal-Assistant/2.0 (+https://vercel.com)'
      }
    });

    if (!response.ok) {
      throw new Error(`تعذر تحميل الرابط. رمز الاستجابة: ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || '';
    const raw = await response.text();
    if (contentType.includes('text/plain')) return cleanText(raw);
    return cleanText(htmlToText(raw));
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const store = await loadSourcesStore();
      return sendJson(res, 200, {
        ok: true,
        updatedAt: store.updatedAt,
        sources: store.sources.map(publicSource)
      });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return sendJson(res, 405, { ok: false, error: 'الطريقة غير مدعومة.' });
    }

    const body = await readJson(req);
    if (!isAdmin(req, body)) {
      return sendJson(res, 401, {
        ok: false,
        error: 'كلمة مرور الإدارة غير صحيحة أو غير مضبوطة.'
      });
    }

    const action = String(body.action || '').trim();
    const store = await loadSourcesStore();

    if (action === 'add_text') {
      const content = limitText(body.content, getSourceLimit());
      if (!content || content.length < 20) {
        return sendJson(res, 400, { ok: false, error: 'النص المستخرج من الملف فارغ أو قصير جداً.' });
      }

      const type = ['pdf', 'txt'].includes(body.type) ? body.type : 'txt';
      const now = new Date().toISOString();
      const source = {
        id: makeId(type),
        type,
        name: cleanText(body.name || (type === 'pdf' ? 'ملف PDF' : 'ملف نصي')).slice(0, 180),
        size: cleanText(body.size || '').slice(0, 80),
        content,
        createdAt: now,
        updatedAt: now
      };

      store.sources.unshift(source);
      const saved = await saveSourcesStore(store);
      return sendJson(res, 200, {
        ok: true,
        updatedAt: saved.updatedAt,
        source: publicSource(source),
        sources: saved.sources.map(publicSource)
      });
    }

    if (action === 'add_url') {
      const url = safeUrl(body.url);
      const content = limitText(await fetchUrlText(url), getSourceLimit());
      if (!content || content.length < 50) {
        return sendJson(res, 400, { ok: false, error: 'لم أستطع استخراج نص كافٍ من الرابط.' });
      }

      const now = new Date().toISOString();
      const source = {
        id: makeId('url'),
        type: 'url',
        name: cleanText(body.name || url).slice(0, 180),
        url,
        size: `${content.length.toLocaleString('en-US')} chars`,
        content,
        createdAt: now,
        updatedAt: now
      };

      store.sources.unshift(source);
      const saved = await saveSourcesStore(store);
      return sendJson(res, 200, {
        ok: true,
        updatedAt: saved.updatedAt,
        source: publicSource(source),
        sources: saved.sources.map(publicSource)
      });
    }

    if (action === 'delete') {
      const id = String(body.id || '');
      const before = store.sources.length;
      store.sources = store.sources.filter((source) => source.id !== id);
      if (store.sources.length === before) {
        return sendJson(res, 404, { ok: false, error: 'المصدر غير موجود.' });
      }
      const saved = await saveSourcesStore(store);
      return sendJson(res, 200, {
        ok: true,
        updatedAt: saved.updatedAt,
        sources: saved.sources.map(publicSource)
      });
    }

    if (action === 'clear') {
      store.sources = [];
      const saved = await saveSourcesStore(store);
      return sendJson(res, 200, {
        ok: true,
        updatedAt: saved.updatedAt,
        sources: []
      });
    }

    return sendJson(res, 400, { ok: false, error: 'إجراء غير معروف.' });
  } catch (error) {
    const statusCode = error.statusCode || error.status || 500;
    return sendJson(res, statusCode, {
      ok: false,
      error: error.message || 'حدث خطأ غير متوقع.'
    });
  }
}
