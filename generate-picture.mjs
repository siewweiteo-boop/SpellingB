import { createHash, timingSafeEqual } from 'node:crypto';

const json = (body, status = 200) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});

function sameCode(actual, expected) {
  const hash = value => createHash('sha256').update(value).digest();
  return timingSafeEqual(hash(actual), hash(expected));
}

export async function POST(request) {
  if (!process.env.OPENAI_API_KEY || !process.env.SPELLINGB_PARENT_CODE) {
    return json({ error: 'The image service has not been configured yet.' }, 503);
  }
  if (Number(request.headers.get('content-length') || 0) > 1024) {
    return json({ error: 'Request is too large.' }, 413);
  }
  const code = request.headers.get('x-parent-code') || '';
  if (!sameCode(code, process.env.SPELLINGB_PARENT_CODE)) {
    return json({ error: 'Incorrect parent code.' }, 401);
  }
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid request.' }, 400); }
  const word = typeof body?.word === 'string' ? body.word.trim().normalize('NFC') : '';
  const language = body?.language;
  if (word.length < 1 || word.length > 40 || !/^[\p{L}\p{M}\s'’\-]+$/u.test(word) || !['english', 'chinese'].includes(language)) {
    return json({ error: 'Use one English or Chinese word or short phrase (up to 40 characters).' }, 400);
  }
  // The model paints a memory scene. The browser renders the exact word separately.
  const prompt = language === 'chinese'
    ? `Create a square, cheerful, child-friendly illustrated mnemonic for learning the Chinese word ${JSON.stringify(word)}. Show its real-world meaning as one clear visual scene. If natural, use objects or shapes that help a child remember the visible parts of its characters. Do not depict a child. Do not draw ANY letters, Chinese characters, pinyin, numbers, labels, writing, or stroke-order arrows: the learning app displays the exact characters separately. Simple composition, high contrast, warm color, plain background.`
    : `Create a square, cheerful, child-friendly illustrated mnemonic for learning to spell the English word ${JSON.stringify(word)}. Show the word's meaning in one memorable, concrete visual scene with a playful detail a parent can describe aloud. Do not depict a child. Do not draw ANY text, letters, numbers, labels, writing, or spelling: the learning app displays the exact word separately. Simple composition, high contrast, warm color, plain background.`;
  try {
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-image-2.5-flare', prompt, size: '1024x1024', quality: 'low', output_format: 'webp', n: 1 }),
      signal: AbortSignal.timeout(90000),
    });
    if (!response.ok) {
      // Do not reveal provider diagnostics, account information, or the secret to the browser.
      return json({ error: response.status === 429 ? 'Image limit reached. Try again later.' : 'Picture generation failed. Check the API account and try again.' }, 502);
    }
    const result = await response.json();
    const image = result?.data?.[0]?.b64_json;
    if (typeof image !== 'string' || !image.length) return json({ error: 'No picture was returned.' }, 502);
    return json({ image: `data:image/webp;base64,${image}` });
  } catch {
    return json({ error: 'Picture generation timed out. Try again.' }, 504);
  }
}
