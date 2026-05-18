const VERSION = '1.0.3';
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

          // 直接回應收到的訊息內容（測試用）
          const debugText = `收到：${JSON.stringify(userMessage)}\n長度：${userMessage.length}\n首字元：${userMessage.charCodeAt(0)}`;
          await replyToLine(replyToken, debugText, env.LINE_CHANNEL_ACCESS_TOKEN);
          continue;
        }
      }
    } catch (err) {
      console.error('Error:', err);
    }

    return new Response('OK', { status: 200 });
  }
};

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
