import { loadSourcesStore } from '../lib/store.js';
import { hasPublicAccess, readJson, sendJson, tokenize, cleanText, normalizeArabic, publicSource } from '../lib/http.js';

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_MAX_CONTEXT_CHARS = 36000;
const CHUNK_SIZE = 2400;
const CHUNK_OVERLAP = 650;
const DEFAULT_MAX_CHUNKS = 12;
const NEIGHBOR_CHUNKS = 1;

const ARTICLE_WORDS = new Map([
  [1, 'الاولي'], [2, 'الثانيه'], [3, 'الثالثه'], [4, 'الرابعه'], [5, 'الخامسه'],
  [6, 'السادسه'], [7, 'السابعه'], [8, 'الثامنه'], [9, 'التاسعه'], [10, 'العاشره'],
  [11, 'الحاديه عشره'], [12, 'الثانيه عشره'], [13, 'الثالثه عشره'], [14, 'الرابعه عشره'], [15, 'الخامسه عشره'],
  [16, 'السادسه عشره'], [17, 'السابعه عشره'], [18, 'الثامنه عشره'], [19, 'التاسعه عشره'], [20, 'العشرون'],
  [21, 'الحاديه والعشرون'], [22, 'الثانيه والعشرون'], [23, 'الثالثه والعشرون'], [24, 'الرابعه والعشرون'], [25, 'الخامسه والعشرون'],
  [26, 'السادسه والعشرون'], [27, 'السابعه والعشرون'], [28, 'الثامنه والعشرون'], [29, 'التاسعه والعشرون'], [30, 'الثلاثون'],
  [31, 'الحاديه والثلاثون'], [32, 'الثانيه والثلاثون'], [33, 'الثالثه والثلاثون'], [34, 'الرابعه والثلاثون'], [35, 'الخامسه والثلاثون'],
  [36, 'السادسه والثلاثون'], [37, 'السابعه والثلاثون'], [38, 'الثامنه والثلاثون'], [39, 'التاسعه والثلاثون'], [40, 'الاربعون'],
  [50, 'الخمسون'], [60, 'الستون'], [70, 'السبعون'], [80, 'الثمانون'], [90, 'التسعون'], [100, 'المائه']
]);

const LEGAL_SYNONYMS = new Map([
  ['ورثه', ['ورثته', 'الورثه', 'وريث', 'ورث']],
  ['ورثته', ['ورثه', 'الورثه', 'وريث', 'ورث']],
  ['مستحقه', ['مستحقات', 'مستحق', 'استحقاق', 'المستحقه']],
  ['المستحقه', ['مستحقه', 'مستحقات', 'مستحق', 'استحقاق']],
  ['مبالغ', ['المبالغ', 'مبلغ']],
  ['المبالغ', ['مبالغ', 'مبلغ']],
  ['ديون', ['ديونا', 'دين']],
  ['ديونا', ['ديون', 'دين']],
  ['ممتازه', ['امتياز', 'ممتاز', 'ممتازه']],
  ['العامل', ['للعامل', 'عامله', 'عمال', 'العمال']],
  ['للعامل', ['العامل', 'عامله', 'عمال', 'العمال']],
  ['افلاس', ['الافلاس', 'تصفية', 'تصفيه']],
  ['تصفيه', ['تصفية', 'افلاس', 'الافلاس']]
]);

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
    const lastBreak = Math.max(chunk.lastIndexOf('\n\n'), chunk.lastIndexOf('\n[صفحة'));
    if (lastBreak > size * 0.45 && end < cleaned.length) {
      chunk = chunk.slice(0, lastBreak);
    }
    chunks.push(chunk.trim());
    if (end >= cleaned.length) break;
    start += Math.max(1, chunk.length - overlap);
  }
  return chunks.filter(Boolean);
}

function reverseArabicWords(input) {
  return String(input || '').replace(/[\u0600-\u06FF]{3,}/g, (word) => [...word].reverse().join(''));
}

function compact(text) {
  return normalizeArabic(text).replace(/\s+/g, '');
}

function stripArabicAffixes(token) {
  let value = normalizeArabic(token);
  if (!value || value.length <= 2) return value;
  value = value.replace(/^(وال|بال|كال|فال|لل|ال|و|ف|ب|ك|ل)/, '');
  value = value.replace(/(هما|كما|كم|كن|نا|ها|هم|هن|ه|ة|ات|ون|ين)$/u, '');
  return value.length >= 3 ? value : normalizeArabic(token);
}

function addKeyword(set, value) {
  const normalized = normalizeArabic(value);
  if (!normalized || normalized.length < 2) return;
  set.add(normalized);
  const stem = stripArabicAffixes(normalized);
  if (stem && stem.length >= 3) set.add(stem);
  const noSpaces = normalized.replace(/\s+/g, '');
  if (noSpaces.length >= 4) set.add(noSpaces);
}

function expandArticleNumbers(question, set) {
  const normalized = normalizeArabic(question);
  const articleRequested = /\b(ماده|الماده|المواد)\b/.test(normalized) || /\bم\s*\d+\b/i.test(String(question));
  const numbers = [...new Set([...normalized.matchAll(/\b\d{1,3}\b/g)].map((match) => Number(match[0])))]
    .filter((number) => number > 0 && number <= 300);
  for (const number of numbers) {
    addKeyword(set, String(number));
    const words = ARTICLE_WORDS.get(number);
    if (words) {
      addKeyword(set, words);
      addKeyword(set, `الماده ${words}`);
      addKeyword(set, reverseArabicWords(`المادة ${words}`));
      if (articleRequested) addKeyword(set, `ةداملا ${reverseArabicWords(words)}`);
    }
  }
}

function buildQuestionKeywords(question) {
  const set = new Set();
  for (const token of tokenize(question)) addKeyword(set, token);
  const normalized = normalizeArabic(question);
  const words = normalized.split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length - 1; i++) {
    const phrase = `${words[i]} ${words[i + 1]}`;
    if (phrase.length >= 7) addKeyword(set, phrase);
  }
  for (const word of words) {
    const stem = stripArabicAffixes(word);
    if (LEGAL_SYNONYMS.has(word)) LEGAL_SYNONYMS.get(word).forEach((item) => addKeyword(set, item));
    if (LEGAL_SYNONYMS.has(stem)) LEGAL_SYNONYMS.get(stem).forEach((item) => addKeyword(set, item));
  }
  expandArticleNumbers(question, set);
  return [...set].filter((value) => value.length >= 2);
}

function buildCandidates(sources) {
  const candidates = [];
  for (const source of sources) {
    const chunks = chunkText(source.content || '');
    chunks.forEach((text, index) => {
      const raw = `${source.name || ''} ${source.url || ''} ${text}`;
      const normalized = normalizeArabic(raw);
      const reversedNormalized = normalizeArabic(reverseArabicWords(raw));
      const searchable = `${normalized} ${reversedNormalized}`;
      candidates.push({
        source,
        index,
        text,
        normalized: searchable,
        compact: searchable.replace(/\s+/g, '')
      });
    });
  }
  return candidates;
}

function scoreCandidate(candidate, keywords, normalizedQuestion, compactQuestion) {
  if (!keywords.length) return 0;
  let score = 0;
  const normalized = candidate.normalized;
  const compactText = candidate.compact;

  for (const keyword of keywords) {
    const keyCompact = keyword.replace(/\s+/g, '');
    if (normalized.includes(keyword)) score += keyword.length >= 6 ? 3 : 1;
    if (keyCompact.length >= 5 && compactText.includes(keyCompact)) score += 3;
  }

  const questionWords = normalizedQuestion.split(/\s+/).filter((word) => word.length >= 4).slice(0, 12);
  for (let i = 0; i < questionWords.length - 1; i++) {
    const phrase = `${questionWords[i]} ${questionWords[i + 1]}`;
    const phraseCompact = phrase.replace(/\s+/g, '');
    if (normalized.includes(phrase)) score += 5;
    if (phraseCompact.length >= 7 && compactText.includes(phraseCompact)) score += 5;
  }

  if (compactQuestion.length >= 10 && compactText.includes(compactQuestion.slice(0, Math.min(36, compactQuestion.length)))) {
    score += 10;
  }

  if (normalizeArabic(candidate.source.name || '').split(' ').some((word) => keywords.includes(word))) score += 3;
  return score;
}

function selectWithNeighbors(scored, maxChunks) {
  const selectedMap = new Map();
  const candidatesBySource = new Map();
  for (const item of scored) {
    const sourceKey = item.source.id;
    if (!candidatesBySource.has(sourceKey)) candidatesBySource.set(sourceKey, new Map());
    candidatesBySource.get(sourceKey).set(item.index, item);
  }

  for (const item of scored) {
    if (item.score <= 0 && selectedMap.size) continue;
    const key = `${item.source.id}:${item.index}`;
    selectedMap.set(key, item);
    const sourceChunks = candidatesBySource.get(item.source.id);
    for (let offset = 1; offset <= NEIGHBOR_CHUNKS; offset++) {
      const before = sourceChunks.get(item.index - offset);
      const after = sourceChunks.get(item.index + offset);
      if (before) selectedMap.set(`${before.source.id}:${before.index}`, before);
      if (after) selectedMap.set(`${after.source.id}:${after.index}`, after);
    }
    if (selectedMap.size >= maxChunks) break;
  }

  return [...selectedMap.values()]
    .sort((a, b) => b.score - a.score || String(a.source.name || '').localeCompare(String(b.source.name || ''), 'ar') || a.index - b.index)
    .slice(0, maxChunks);
}

function retrieveContext(sources, question) {
  const candidates = buildCandidates(sources);
  const normalizedQuestion = normalizeArabic(question);
  const compactQuestion = compact(question);
  const keywords = buildQuestionKeywords(question);
  const maxContextChars = numberEnv('MAX_CONTEXT_CHARS', DEFAULT_MAX_CONTEXT_CHARS);
  const maxChunks = numberEnv('MAX_RETRIEVED_CHUNKS', DEFAULT_MAX_CHUNKS);

  const scored = candidates
    .map((candidate) => ({
      ...candidate,
      score: scoreCandidate(candidate, keywords, normalizedQuestion, compactQuestion)
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const best = scored.some((item) => item.score > 0)
    ? selectWithNeighbors(scored, maxChunks)
    : scored.slice(0, Math.min(5, scored.length));

  const snippets = [];
  let usedChars = 0;
  for (const item of best) {
    const label = item.source.type === 'url' ? item.source.url : (item.source.displayName || item.source.name);
    const block = `[#${snippets.length + 1}] المصدر: ${label}\nنوع المصدر: ${item.source.type}\nدرجة المطابقة: ${item.score}\nالمقتطف:\n${item.text}`;
    if (usedChars + block.length > maxContextChars && snippets.length) break;
    snippets.push(block);
    usedChars += block.length;
  }

  const usedSourcesById = new Map();
  best.forEach((item) => {
    const key = item.source.groupId || item.source.id;
    if (!usedSourcesById.has(key)) usedSourcesById.set(key, publicSource(item.source));
  });

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
7. إذا كانت بعض الكلمات في المقتطفات مقلوبة بسبب استخراج PDF عربي، فافهمها من سياقها ولا تعتبر ذلك عدم وجود للمعلومة.

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
        max_tokens: numberEnv('ANTHROPIC_MAX_TOKENS', 1800),
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
