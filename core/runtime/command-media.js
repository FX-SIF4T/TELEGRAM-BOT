const MEDIA_CAPTION_LIMIT = 1024;
const mediaPositions = new Map();

function splitCaption(caption) {
  if (caption.length <= MEDIA_CAPTION_LIMIT) {
    return { caption, remainder: '' };
  }

  const lineBreak = caption.lastIndexOf('\n', MEDIA_CAPTION_LIMIT);
  const splitAt = lineBreak > 0 ? lineBreak : MEDIA_CAPTION_LIMIT;
  return {
    caption: caption.slice(0, splitAt),
    remainder: caption.slice(splitAt).replace(/^\n/, '')
  };
}

export async function sendRotatingMedia({ response, urls, caption, method, key }) {
  if (!Array.isArray(urls) || urls.length === 0 || typeof response?.[method] !== 'function') {
    return response.reply(caption);
  }

  const start = mediaPositions.get(key) ?? 0;
  mediaPositions.set(key, (start + 1) % urls.length);
  const orderedUrls = [...urls.slice(start), ...urls.slice(0, start)];
  const text = String(caption ?? '');
  const parts = splitCaption(text);

  for (const url of orderedUrls) {
    let sent;
    try {
      sent = await response[method](url, { caption: parts.caption });
    } catch (error) {
      const detail = error?.code ?? error?.response?.statusCode ?? 'unavailable';
      console.warn(`Could not attach ${key} media: ${detail}`);
      continue;
    }

    if (parts.remainder) {
      try {
        await response.reply(parts.remainder, {
          reply_to_message_id: sent.message_id
        });
      } catch (error) {
        console.warn(`Could not send the remaining ${key} text: ${error?.code ?? 'unavailable'}`);
      }
    }
    return sent;
  }

  return response.reply(text);
}
