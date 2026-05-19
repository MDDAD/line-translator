const VERSION = '2.0.2';
const BUILD_DATE = new Date().toISOString().split('T')[0];

export default {
  async fetch(request, env) {
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

          // 指令處理
          if (userMessage.startsWith('/')) {
            const cmd = userMessage.toLowerCase();
            if (cmd === '/version' || cmd === '/版本') {
              await replyToLine(replyToken, `🤖 LINE 翻譯機器人\n版本：v${VERSION}\n建置日期：${BUILD_DATE}\n\n支援語言：🇹🇬 中文（繁體）｜🇺🇸 English ｜🇮🇩 Indonesia\n\n使用方法：\n直接傳送任何文字，機器人會自動偵測語言並翻譯成其他兩種語言。`, env.LINE_CHANNEL_ACCESS_TOKEN);
            } else {
              await replyToLine(replyToken, `未知指令：${userMessage}\n\n可用指令：\n/version - 查看版本`, env.LINE_CHANNEL_ACCESS_TOKEN);
            }
            continue;
          }

          // 一般訊息，翻譯
          const results = await translateAll(userMessage, env);
          const replyText = results.join('\n');
          await replyToLine(replyToken, replyText, env.LINE_CHANNEL_ACCESS_TOKEN);
        }
      }
    } catch (err) {
      console.error('Error:', err);
    }

    return new Response('OK', { status: 200 });
  }
};

async function translateAll(text, env) {
  const sourceLang = detectLang(text);
  const targetLangs = getTargetLangs(sourceLang);

  const translations = await Promise.all(
    targetLangs.map(lang => translateTo(text, sourceLang, lang, env))
  );

  return translations;
}

function detectLang(text) {
  const chineseRegex = /[\u4e00-\u9fff]/;
  const indonesianWords = ['yang', 'dan', 'di', 'ke', 'dari', 'ini', 'itu', 'untuk', 'dengan', 'ada', 'tidak', 'akan', 'sudah', 'saya', 'kamu', 'dia'];
  const lowerText = text.toLowerCase();

  if (chineseRegex.test(text)) return 'zh';
  if (indonesianWords.some(word => lowerText.includes(word))) return 'id';
  return 'en';
}

function getTargetLangs(sourceLang) {
  return ['en', 'zh', 'id'].filter(lang => lang !== sourceLang);
}

async function translateTo(text, sourceLang, targetLang, env) {
  const flags = {
    'zh': '🇹🇼',
    'en': '🇺🇸',
    'id': '🇮🇩'
  };

  // Google Translate：zh-TW 是繁體，zh 是簡體
  const googleLangMap = {
    'zh': 'zh-TW',
    'en': 'en',
    'id': 'id'
  };

  const googleTarget = googleLangMap[targetLang];
  const url = `https://translation.googleapis.com/language/translate/v2?key=${env.GOOGLE_TRANSLATE_API_KEY}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      q: text,
      target: googleTarget,
      source: sourceLang === 'zh' ? 'zh-CN' : sourceLang
    })
  });

  const data = await response.json();
  const translated = decodeHTMLEntities(data.data.translations[0].translatedText);
  const flag = flags[targetLang];

  return `${flag} ${translated}`;
}

function decodeHTMLEntities(text) {
  return text
    .replace(/'/g, "'")
    .replace(/'/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, '"')
    .replace(/'/g, "'")
    .replace(/'/g, "'")
    .replace(/'/g, "'");
}

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