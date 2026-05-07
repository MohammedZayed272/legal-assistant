import { get, put } from '@vercel/blob';

const STORE_PATH = process.env.SOURCES_BLOB_PATH || 'legal-assistant/sources.json';

const EMPTY_STORE = () => ({
  version: 1,
  updatedAt: null,
  sources: []
});

async function streamToText(stream) {
  if (!stream) return '';
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    output += decoder.decode(value, { stream: true });
  }
  output += decoder.decode();
  return output;
}

function isNotFoundError(error) {
  const msg = String(error?.message || '').toLowerCase();
  return error?.status === 404 || error?.statusCode === 404 || msg.includes('not found') || msg.includes('404');
}

export async function loadSourcesStore() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return EMPTY_STORE();

  try {
    const result = await get(STORE_PATH, { access: 'private' });
    const text = await streamToText(result?.stream);
    if (!text) return EMPTY_STORE();
    const parsed = JSON.parse(text);
    return {
      version: parsed.version || 1,
      updatedAt: parsed.updatedAt || null,
      sources: Array.isArray(parsed.sources) ? parsed.sources : []
    };
  } catch (error) {
    if (isNotFoundError(error)) return EMPTY_STORE();
    throw error;
  }
}

export async function saveSourcesStore(store) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error('BLOB_READ_WRITE_TOKEN غير موجود. أنشئ Vercel Blob واربطه بالمشروع.');
  }

  const nextStore = {
    version: 1,
    updatedAt: new Date().toISOString(),
    sources: Array.isArray(store.sources) ? store.sources : []
  };

  await put(STORE_PATH, JSON.stringify(nextStore), {
    access: 'private',
    contentType: 'application/json; charset=utf-8',
    allowOverwrite: true,
    cacheControlMaxAge: 60
  });

  return nextStore;
}
