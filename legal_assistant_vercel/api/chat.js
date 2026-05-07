import { loadSourcesStore } from '../lib/store.js';
import { hasPublicAccess, readJson, sendJson, tokenize, cleanText, normalizeArabic, publicSource } from '../lib/http.js';

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_MAX_CONTEXT_CHARS = 24000;
const CHUNK_SIZE = 3000;
const CHUNK_OVERLAP = 450;
const MAX_CHUNKS = 8;

function numberEnv(name, fallback) {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function chunkText(text, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const cleaned = cleanText(text);
  if (!cleaned) return [];
  const chunks = [];
  let start = 0;
  while (start < cleaned.length) {
    const end = Math.min(start + size, cleaned.length);
    let chunk = cleaned.slice(start, end);
    const lastBreak = chunk.lastIndexOf('\n');
    if (lastBreak > size * 0.55 && end < cleaned.length) {
      chunk = chunk.slice(0, lastBreak);
    }
    chunks.push(chunk.trim());
    if (end >= cleaned.length) break;
    start += Math.max(1, chunk.length - overlap);
  }
  return chunks.filter(Boolean);
}

function buildCandidates(sources) {
  const candidates = [];
  for (const source of sources) {
    const chunks = chunkText(source.content || '');
    chunks.forEach((text, index) => {
      candidates.push({
        source,
        index,
        text,
        normalized: normalizeArabic(`${source.name || ''} ${source.url || ''} ${text}`)
      });
    });
  }
  return candidates;
}

function scoreCandidate(candidate, questionTokens, normalizedQuestion) {
  if (!questionTokens.length) return 0;
  let score = 0;
  const normalized = candidate.normalized;
  for (const token of questionTokens) {
    if (normalized.includes(token)) score += token.length >= 5 ? 2 : 1;
  }
  const importantPhrases = normalizedQuestion.split(' ').filter((word) => word.length >= 5).slice(0, 12);
  for (let i = 0; i < importantPhrases.length - 1; i++) {
    const phrase = `${importantPhrases[i]} ${importantPhrases[i + 1]}`;
    if (phrase.length > 8 && normalized.includes(phrase)) score += 4;
  }
  if (normalizeArabic(candidate.source.name || '').split(' ').some((word) => questionTokens.includes(word))) score += 3;
  return score;
}

function retrieveContext(sources, question) {
  const candidates = buildCandidates(sources);
  const normalizedQuestion = normalizeArabic(question);
  const questionTokens = [...new Set(tokenize(question))];
  const maxContextChars = numberEnv('MAX_CONTEXT_CHARS', DEFAULT_MAX_CONTEXT_CHARS);

  const scored = candidates
    .map((candidate) => ({
      ...candidate,
      score: scoreCandidate(candidate, questionTokens, normalizedQuestion)
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const best = scored.slice(0, MAX_CHUNKS);
  const fallback = scored.length ? scored.slice(0, Math.min(4, scored.length)) : [];
  const selected = best.some((item) => item.score > 0) ? best : fallback;

  const snippets = [];
  let usedChars = 0;
  for (const item of selected) {
    const label = item.source.type === 'url' ? item.source.url : item.source.name;
    const block = `[#${snippets.length + 1}] المصدر: ${label}\nنوع المصدر: ${item.source.type}\nالمقتطف:\n${item.text}`;
    if (usedChars + block.length > maxContextChars && snippets.length) break;
    snippets.push(block);
    usedChars += block.length;
  }

  const usedSourcesById = new Map();
  selected.forEach((item) => usedSourcesById.set(item.source.id, publicSource(item.source)));

  return {
    context: snippets.join('\n\n---\n\n'),
    usedSources: [...usedSourcesById.values()]
  };
}

function cleanHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .slice(-8)
    .filter((msg) => ['user', 'assistant'].includes(msg?.role) && typeof msg?.content === 'string')
    .map((msg) => ({
      role: msg.role,
      content: msg.content.slice(0, 3000)
    }));
}

function extractAnthropicText(data) {
  if (!Array.isArray(data?.content)) return '';
  return data.content
    .filter((part) => part?.type === 'text' || typeof part?.text === 'string')
    .map((part) => part.text || '')
    .join('\n')
    .trim();
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return sendJson(res, 405, { ok: false, error: 'الطريقة غير مدعومة.' });
    }

    const body = await readJson(req);
    if (!hasPublicAccess(req, body)) {
      return sendJson(res, 401, {
        ok: false,
        needAccessCode: true,
        error: 'رمز الدخول غير صحيح.'
      });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return sendJson(res, 500, {
        ok: false,
        error: 'ANTHROPIC_API_KEY غير موجود في Environment Variables داخل Vercel.'
      });
    }

    const question = cleanText(body.question || '').slice(0, 4000);
    if (!question) return sendJson(res, 400, { ok: false, error: 'اكتب السؤال أولاً.' });

    const store = await loadSourcesStore();
    const sources = store.sources.filter((source) => source.content && source.content.length > 20);
    if (!sources.length) {
      return sendJson(res, 400, { ok: false, error: 'لا توجد مصادر محفوظة حالياً.' });
    }

    const { context, usedSources } = retrieveContext(sources, question);
    if (!context) {
      return sendJson(res, 400, { ok: false, error: 'لم أجد نصاً صالحاً في المصادر المحفوظة.' });
    }

    const system = `أنت مساعد قانوني متخصص حصري لمكتب "نصر البركاتي للمحاماة والاستشارات القانونية".

قواعد صارمة:
1. أجب فقط وحصراً من المقتطفات القانونية المقدمة أدناه. لا تستخدم أي معلومات خارجية مطلقاً.
2. إذا لم يُذكر الموضوع في المقتطفات، قل بوضوح: "لا تتوفر معلومات عن هذا الموضوع في المصادر المرفوعة حالياً."
3. اذكر دائماً اسم المصدر، واذكر رقم المادة أو الباب أو الفقرة متى ظهر في النص.
4. لا تخترع مواد أو أحكاماً غير موجودة في المقتطفات.
5. اكتب بالعربية الفصحى وبأسلوب مهني مختصر.
6. عند وجود أكثر من رأي أو حالة في النص، فرّق بينها ولا تعمم.

المقتطفات المسترجعة من المصادر:
${context}`;

    const messages = cleanHistory(body.history).concat([{ role: 'user', content: question }]);

    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
        max_tokens: numberEnv('ANTHROPIC_MAX_TOKENS', 1600),
        system,
        messages
      })
    });

    const data = await anthropicResponse.json().catch(() => ({}));
    if (!anthropicResponse.ok) {
      return sendJson(res, anthropicResponse.status, {
        ok: false,
        error: data?.error?.message || 'حدث خطأ أثناء الاتصال بـ Claude API.'
      });
    }

    const answer = extractAnthropicText(data);
    if (!answer) {
      return sendJson(res, 502, { ok: false, error: 'لم يصل رد نصي من Claude API.' });
    }

    return sendJson(res, 200, {
      ok: true,
      answer,
      usedSources
    });
  } catch (error) {
    const statusCode = error.statusCode || error.status || 500;
    return sendJson(res, statusCode, {
      ok: false,
      error: error.message || 'حدث خطأ غير متوقع.'
    });
  }
}
