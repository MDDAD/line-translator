const VERSION = '2.1.0';
const BUILD_DATE = new Date().toISOString().split('T')[0];

// 支援的語言設定（英文固定，其他可多選）
const LANG_CONFIG = {
  'en': { name: '英文', flag: '🇺🇸', googleCode: 'en', nativeName: 'English' },
  'zh': { name: '中文', flag: '🇹🇼', googleCode: 'zh-TW', nativeName: '中文' },
  'ja': { name: '日文', flag: '🇯🇵', googleCode: 'ja', nativeName: '日本語' },
  'ko': { name: '韓文', flag: '🇰🇷', googleCode: 'ko', nativeName: '한국어' },
  'id': { name: '印尼文', flag: '🇮🇩', googleCode: 'id', nativeName: 'Bahasa Indonesia' },
  'th': { name: '泰文', flag: '🇹🇭', googleCode: 'th', nativeName: 'ภาษาไทย' },
  'vi': { name: '越南文', flag: '🇻🇳', googleCode: 'vi', nativeName: 'Tiếng Việt' },
  'ms': { name: '馬來文', flag: '🇲🇾', googleCode: 'ms', nativeName: 'Bahasa Melayu' },
  'es': { name: '西班牙文', flag: '🇪🇸', googleCode: 'es', nativeName: 'Español' },
};

const ALL_LANGS = Object.keys(LANG_CONFIG);
const OPTIONAL_LANGS = ALL_LANGS.filter(l => l !== 'en'); // 英文固定，其餘可選

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
          const userMessage = event.message.text.trim();
          const replyToken = event.replyToken;
          const userId = event.source?.userId || '';

          // 指令處理
          if (userMessage.startsWith('/')) {
            const cmd = userMessage.toLowerCase();
            if (cmd === '/version' || cmd === '/版本') {
              await replyToLine(replyToken, `🤖 LINE 翻譯機器人\n版本：v${VERSION}\n建置日期：${BUILD_DATE}\n\n支援語言：${ALL_LANGS.map(l => LANG_CONFIG[l].flag).join(' ')}\n\n傳送任何文字，機器人會翻譯成你設定的目標語言`, env.LINE_CHANNEL_ACCESS_TOKEN);
            } else if (cmd === '/setting' || cmd === '/設定') {
              await handleSettingCommand(replyToken, userId, env);
            } else {
              await replyToLine(replyToken, `未知指令：${userMessage}\n\n可用指令：\n/version - 查看版本\n/setting - 更改語言設定`, env.LINE_CHANNEL_ACCESS_TOKEN);
            }
            continue;
          }

          // 處理「設定語言:xx」按鈕回傳
          if (userMessage.startsWith('設定語言:')) {
            const langCode = userMessage.replace('設定語言:', '').trim();
            if (LANG_CONFIG[langCode] && langCode !== 'en') {
              const result = await handleLanguageSetup(userId, langCode, env);
              await replyToLine(replyToken, result.message, env.LINE_CHANNEL_ACCESS_TOKEN);
            } else if (langCode === 'en') {
              await replyToLine(replyToken, '🇺🇸 英文是固定語言，無法移除。', env.LINE_CHANNEL_ACCESS_TOKEN);
            } else {
              await replyToLine(replyToken, '未知的語言選項。', env.LINE_CHANNEL_ACCESS_TOKEN);
            }
            continue;
          }

          // 一般訊息：檢查用戶偏好，翻譯
          await handleTranslate(replyToken, userId, userMessage, env);
        }
      }
    } catch (err) {
      console.error('Error:', err);
    }

    return new Response('OK', { status: 200 });
  }
};

// ---------------------------------------------------------------
// 翻譯處理
// ---------------------------------------------------------------
async function handleTranslate(replyToken, userId, text, env) {
  const prefKey = `pref:${userId}`;
  const rawPref = await env.TRANSLATOR_KV.get(prefKey);

  let targetLangs;

  if (!rawPref) {
    // 第一次使用：引導設定
    await replyWithLanguageSetup(replyToken, userId, env);
    return;
  }

  try {
    const pref = JSON.parse(rawPref);
    targetLangs = [...(pref.langs || [])];
  } catch {
    await replyWithLanguageSetup(replyToken, userId, env);
    return;
  }

  // 英文固定加入（如果還沒有）
  if (!targetLangs.includes('en')) {
    targetLangs.unshift('en');
  }

  // 移除來源語言（避免翻譯成自己）
  const sourceLang = detectLang(text);
  targetLangs = targetLangs.filter(l => l !== sourceLang);

  if (targetLangs.length === 0) {
    await replyToLine(replyToken, '沒有可翻譯的目標語言（你設定的語言與來源相同）', env.LINE_CHANNEL_ACCESS_TOKEN);
    return;
  }

  const results = await translateAll(text, sourceLang, targetLangs, env);
  const replyText = results.join('\n');
  await replyToLine(replyToken, replyText, env.LINE_CHANNEL_ACCESS_TOKEN);
}

// ---------------------------------------------------------------
// 首次設定：Quick Reply 語言選擇
// ---------------------------------------------------------------
async function replyWithLanguageSetup(replyToken, userId, env) {
  const introText = `👋 歡迎使用 LINE 翻譯機器人！

請選擇你想翻譯成的目標語言（可多選，最多選 8 個）。

🇹🇬 英文為固定語言，一定會翻譯。

請用下方 Quick Reply 選擇其他語言：`;

  const quickReplyItems = OPTIONAL_LANGS.map(langCode => ({
    type: 'action',
    action: {
      type: 'message',
      label: `${LANG_CONFIG[langCode].flag} ${LANG_CONFIG[langCode].name}`,
      text: `設定語言:${langCode}`
    }
  }));

  await replyToLineWithQuickReply(replyToken, introText, quickReplyItems, env.LINE_CHANNEL_ACCESS_TOKEN);
}

// ---------------------------------------------------------------
// /setting 指令
// ---------------------------------------------------------------
async function handleSettingCommand(replyToken, userId, env) {
  const prefKey = `pref:${userId}`;
  const rawPref = await env.TRANSLATOR_KV.get(prefKey);

  let currentLangs = [];
  if (rawPref) {
    try {
      const pref = JSON.parse(rawPref);
      currentLangs = pref.langs || [];
    } catch {}
  }

  const enIncluded = currentLangs.includes('en');
  const selectedLangs = currentLangs.filter(l => l !== 'en');

  const header = enIncluded
    ? `⚙️ 目前設定\n🇺🇸 英文（固定）\n${selectedLangs.map(l => `${LANG_CONFIG[l].flag} ${LANG_CONFIG[l].name}`).join('\n') || '（無其他語言）'}`
    : `⚙️ 目前設定\n（尚未設定任何語言）`;

  const quickReplyItems = OPTIONAL_LANGS.map(langCode => ({
    type: 'action',
    action: {
      type: 'message',
      label: `${LANG_CONFIG[langCode].flag} ${LANG_CONFIG[langCode].name}`,
      text: `設定語言:${langCode}`
    }
  }));

  await replyToLineWithQuickReply(
    replyToken,
    `${header}\n\n請用下方 Quick Reply 選擇或變更語言：`,
    quickReplyItems,
    env.LINE_CHANNEL_ACCESS_TOKEN
  );
}

// ---------------------------------------------------------------
// 處理「設定語言:xx」訊息
// ---------------------------------------------------------------
async function handleLanguageSetup(userId, langCode, env) {
  const prefKey = `pref:${userId}`;
  const rawPref = await env.TRANSLATOR_KV.get(prefKey);

  let currentLangs = [];
  if (rawPref) {
    try {
      const pref = JSON.parse(rawPref);
      currentLangs = pref.langs || [];
    } catch {}
  }

  // 移除英文（固定，不存在偏好清單）
  currentLangs = currentLangs.filter(l => l !== 'en');

  // 切換該語言（有就移除，沒有就加入）
  if (currentLangs.includes(langCode)) {
    currentLangs = currentLangs.filter(l => l !== langCode);
  } else {
    if (currentLangs.length >= 8) {
      return { success: false, message: `最多只能選 8 個語言（不含英文）。` };
    }
    currentLangs.push(langCode);
  }

  await env.TRANSLATOR_KV.put(prefKey, JSON.stringify({ langs: currentLangs }));

  const selected = currentLangs.map(l => `${LANG_CONFIG[l].flag} ${LANG_CONFIG[l].name}`).join('、') || '無';
  return {
    success: true,
    message: `✅ 設定已儲存\n\n🇺🇸 英文（固定）\n${currentLangs.map(l => `${LANG_CONFIG[l].flag} ${LANG_CONFIG[l].name}`).join('\n')}\n\n傳送任何文字即可翻譯。輸入 /setting 更改設定。`
  };
}

// ---------------------------------------------------------------
// 翻譯核心
// ---------------------------------------------------------------
async function translateAll(text, sourceLang, targetLangs, env) {
  const translations = await Promise.all(
    targetLangs.map(lang => translateTo(text, sourceLang, lang, env))
  );
  return translations;
}

function detectLang(text) {
  const chineseRegex = /[\u4e00-\u9fff]/;
  const indonesianWords = ['yang', 'dan', 'di', 'ke', 'dari', 'ini', 'itu', 'untuk', 'dengan', 'ada', 'tidak', 'akan', 'sudah', 'saya', 'kamu', 'dia'];
  const japaneseWords = ['です', 'ます', 'した', 'して', 'これ', 'それ', 'あなた', '、私', 'は', 'が', 'の', 'に', 'を', 'は', 'て', 'か', 'も', 'と'];
  const koreanChars = /[\uAC00-\uD7AF]/;
  const thaiChars = /[\u0E00-\u0E7F]/;
  const vietnameseWords = ['và', 'của', 'là', 'có', 'được', 'trong', 'này', 'không', 'tôi', 'bạn', 'anh', 'chị', 'em', 'một', 'với', 'cho'];
  const malayWords = ['yang', 'dan', 'di', 'ke', 'dari', 'ini', 'itu', 'untuk', 'dengan', 'ada', 'tidak', 'akan', 'sudah', 'saya', 'kamu', 'dia', 'akan', 'ada'];
  const spanishWords = ['que', 'de', 'en', 'y', 'es', 'el', 'la', 'los', 'las', 'un', 'una', 'del', 'al', 'con', 'por', 'para', 'como', 'pero', 'está', 'esta', 'soy', 'eres'];

  const lowerText = text.toLowerCase();

  if (chineseRegex.test(text)) return 'zh';
  if (japaneseWords.some(w => text.includes(w))) return 'ja';
  if (koreanChars.test(text)) return 'ko';
  if (thaiChars.test(text)) return 'th';
  if (spanishWords.some(w => lowerText.includes(w))) return 'es';
  if (malayWords.some(w => lowerText.includes(w))) return 'ms';
  if (vietnameseWords.some(w => lowerText.includes(w))) return 'vi';
  if (indonesianWords.some(w => lowerText.includes(w))) return 'id';
  return 'en';
}

async function translateTo(text, sourceLang, targetLang, env) {
  const config = LANG_CONFIG[targetLang];
  const googleSourceMap = { 'zh': 'zh-CN', 'ja': 'ja', 'ko': 'ko', 'id': 'id', 'th': 'th', 'vi': 'vi', 'ms': 'ms', 'es': 'es', 'en': 'en' };
  const googleSource = googleSourceMap[sourceLang] || sourceLang;

  const url = `https://translation.googleapis.com/language/translate/v2?key=${env.GOOGLE_TRANSLATE_KEY}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      q: text,
      target: config.googleCode,
      source: googleSource
    })
  });

  const data = await response.json();
  const translated = decodeHTMLEntities(data.data.translations[0].translatedText);

  return `${config.flag} ${translated}`;
}

function decodeHTMLEntities(text) {
  return text
    .replace(/'/g, "'")
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, '"')
    .replace(/'/g, "'")
    .replace(/&#x2F;/g, "/");
}

// ---------------------------------------------------------------
// LINE 回覆工具
// ---------------------------------------------------------------
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

async function replyToLineWithQuickReply(replyToken, text, quickReplyItems, accessToken) {
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      replyToken: replyToken,
      messages: [{
        type: 'text',
        text: text,
        quickReply: {
          items: quickReplyItems
        }
      }]
    })
  });
}