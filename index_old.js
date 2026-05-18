export default {
  async fetch(request, env) {
    // 只處理 POST 請求（LINE Webhook）
    if (request.method !== 'POST') {
      return new Response('OK', { status: 200 });
    }

    try {
      const body = await request.json();
      const events = body.events || [];

      for (const event of events) {
        if (event.type === 'message' && event.message.type === 'text') {
          const userMessage = event.message.text;
          const replyToken = event.replyToken;

          // 翻譯成目標語言
          const results = await translateAll(userMessage, env);

          // 組合成回覆文字
          const replyText = results.join('\n');

          // 回傳給 LINE
          await replyToLine(replyToken, replyText, env.LINE_CHANNEL_ACCESS_TOKEN);
        }
      }
    } catch (err) {
      console.error('Error:', err);
    }

    return new Response('OK', { status: 200 });
  }
};

// 翻譯成中文、英文、印尼文
async function translateAll(text, env) {
  const sourceLang = await detectLang(text);
  const targetLangs = getTargetLangs(sourceLang);

  // 同時翻譯三個語言
  const translations = await Promise.all(
    targetLangs.map(lang => translateTo(text, lang, env))
  );

  return translations;
}

// 簡單語言偵測
async function detectLang(text) {
  // 中文：包含中文字符
  const chineseRegex = /[\u4e00-\u9fff]/;
  // 印尼文：常見單詞
  const indonesianWords = [
    'yang', 'dan', 'di', 'ke', 'dari', 'ini', 'itu',
    'untuk', 'dengan', 'ada', 'tidak', 'akan', 'sudah',
    'saya', 'kamu', 'dia', 'beli', 'apa', 'siapa', 'bagaimana'
  ];
  const lowerText = text.toLowerCase();

  if (chineseRegex.test(text)) return 'zh';
  if (indonesianWords.some(word => lowerText.includes(word))) return 'id';
  return 'en';
}

// 根據來源語言決定目標語言（避開自己）
function getTargetLangs(sourceLang) {
  const all = ['en', 'zh', 'id'];
  return all.filter(lang => lang !== sourceLang);
}

// Google Translate API 翻譯
async function translateTo(text, targetLang, env) {
  const langConfig = {
    'zh': { name: '中文', flag: '🇹🇼' },
    'en': { name: 'English', flag: '🇺🇸' },
    'id': { name: 'Indonesia', flag: '🇮🇩' }
  };

  const sourceLang = await detectLang(text);

  const url = `https://translation.googleapis.com/language/translate/v2?key=${env.GOOGLE_TRANSLATE_KEY}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      q: text,
      target: targetLang,
      source: sourceLang
    })
  });

  const data = await response.json();
  const translated = data.data.translations[0].translatedText;
  const config = langConfig[targetLang];

  return `${config.flag} ${config.name}:\n${translated}`;
}

// 回覆 LINE
async function replyToLine(replyToken, text, accessToken) {
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      replyToken: replyToken,
      messages: [{ type: 'text', text: text }]
    })
  });
}