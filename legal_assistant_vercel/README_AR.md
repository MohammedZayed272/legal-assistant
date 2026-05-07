# المساعد القانوني — نسخة Vercel مع تخزين دائم

هذه النسخة تعالج مشكلتين في الملف الأصلي:

1. الملفات والروابط لم تعد محفوظة في `localStorage` داخل جهاز كل مستخدم، بل تحفظ مركزياً في Vercel Blob.
2. مفتاح Claude API لم يعد يظهر في الواجهة، بل يوضع في Environment Variables داخل Vercel ويستخدم من `/api/chat`.

## بنية المشروع

```text
index.html              واجهة المستخدم المحسنة للجوال والكمبيوتر
api/chat.js             يستقبل السؤال ويتصل بـ Claude من السيرفر
api/sources.js          إدارة إضافة/حذف/قراءة المصادر
lib/http.js             أدوات مساعدة للطلبات والتنظيف
lib/store.js            قراءة/كتابة ملف sources.json في Vercel Blob
package.json            اعتماد @vercel/blob
vercel.json             إعداد مدة تنفيذ الدوال
.env.example            أسماء المتغيرات المطلوبة
original_index.html     نسخة احتياطية من الملف الذي أرسلته
```

## خطوات التركيب على Vercel

### 1) ارفع الملفات

ارفع هذا المجلد إلى GitHub أو اسحب الملفات في مشروع Vercel.

### 2) أنشئ Vercel Blob

من لوحة Vercel:

Project → Storage → Create Database → Blob → Private أو Public

بعد الإنشاء سيضيف Vercel المتغير التالي تلقائياً غالباً:

```env
BLOB_READ_WRITE_TOKEN=...
```

### 3) أضف متغيرات البيئة

من:

Project → Settings → Environment Variables

أضف:

```env
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxx
ANTHROPIC_MODEL=claude-haiku-4-5-20251001
ADMIN_PASSWORD=اكتب-كلمة-مرور-قوية
```

اختياري إذا أردت حماية الرابط برمز دخول للزوار:

```env
PUBLIC_ACCESS_CODE=1234
```

اختياري لتحديد حجم النص المحفوظ من كل مصدر:

```env
SOURCE_CHAR_LIMIT=120000
```

### 4) أعد النشر

بعد إضافة المتغيرات، اعمل Redeploy للمشروع.

### 5) ارفع المصادر مرة واحدة

افتح الرابط، افتح القائمة الجانبية، أدخل كلمة مرور الإدارة، ثم ارفع ملفات PDF/TXT أو أضف الروابط.

بعد ذلك أي شخص تفتح له الرابط سيجد نفس المصادر ولن يحتاج API key.

## ملاحظات مهمة

- لا تشارك `ADMIN_PASSWORD` مع العملاء.
- لا تضع مفتاح Claude داخل `index.html` أبداً.
- هذه النسخة تحفظ النص المستخرج من الملفات، وليس نسخة PDF الأصلية.
- ملفات PDF الممسوحة ضوئياً كصور تحتاج OCR قبل الرفع أو نسخة PDF قابلة للنسخ.
- عند رفع ملفات كثيرة جداً، المساعد يسترجع مقتطفات مرتبطة بالسؤال بدلاً من إرسال كل النص إلى Claude لتقليل التكلفة وحجم السياق.
- إذا كان لديك عدد كبير جداً من الأنظمة واللوائح، فالمرحلة التالية الأفضل هي قاعدة Vector/RAG مثل Upstash Vector أو Pinecone بدلاً من ملف JSON واحد.
