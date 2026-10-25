import axios from 'axios';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Transform } from 'node:stream';

const API_BASE = 'https://downloader-prooo.vercel.app';
const API_JSON_LIMIT = 512 * 1024;
const MAX_MEDIA_BYTES = 45 * 1024 * 1024;
const API_ATTEMPTS = 3;
const DIRECT_MEDIA_EXTENSIONS = new Set([
  'mp4',
  'm4v',
  'mov',
  'webm',
  'mp3',
  'm4a',
  'aac',
  'ogg',
  'wav',
  'flac',
  'jpg',
  'jpeg',
  'png'
]);

const PLATFORM_DOMAINS = new Map([
  ['youtube.com', 'youtube'],
  ['youtu.be', 'youtube'],
  ['tiktok.com', 'tiktok'],
  ['instagram.com', 'instagram'],
  ['facebook.com', 'facebook'],
  ['fb.watch', 'facebook'],
  ['x.com', 'twitter'],
  ['twitter.com', 'twitter'],
  ['douyin.com', 'douyin'],
  ['xiaohongshu.com', 'xiaohongshu'],
  ['xhslink.com', 'xiaohongshu'],
  ['snackvideo.com', 'snackvideo'],
  ['cocofun.com', 'cocofun'],
  ['capcut.com', 'capcut'],
  ['pinterest.com', 'pinterest'],
  ['pin.it', 'pinterest'],
  ['spotify.com', 'spotify'],
  ['soundcloud.com', 'soundcloud'],
  ['mediafire.com', 'mediafire'],
  ['drive.google.com', 'gdrive'],
  ['docs.google.com', 'gdrive']
]);

const URL_FIELDS = new Set([
  'url',
  'downloadurl',
  'mediaurl',
  'videourl',
  'audiourl',
  'fileurl',
  'link',
  'src',
  'mp4',
  'mp3',
  'normalvideo',
  'hd',
  'sd'
]);

const CONTAINER_FIELDS = new Set([
  'data',
  'result',
  'media',
  'video',
  'videos',
  'audio',
  'files',
  'downloads',
  'download',
  'formats',
  'links',
  'items',
  'sources',
  'results'
]);

export const meta = {
  name: 'alldl',
  version: '1.0.0',
  aliases: [],
  description: 'Download supported media links and send the media here.',
  author: 'SIFAT',
  prefix: 'both',
  category: 'media',
  type: 'anyone',
  cooldown: 5,
  guide: ['<media URL> - Download supported media and send it here.']
};

function isPublicIpv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [a, b, c] = parts;
  if (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0 && c === 113)
  ) {
    return false;
  }

  return true;
}

function isPublicAddress(address) {
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family !== 6) return false;

  const normalized = address.toLowerCase();
  if (normalized.startsWith('::ffff:')) {
    const mappedIpv4 = normalized.slice(7);
    if (isIP(mappedIpv4) === 4) return isPublicIpv4(mappedIpv4);
  }
  if (normalized === '::' || normalized === '::1') return false;
  if (/^(fc|fd|fe[89ab]|ff)/.test(normalized)) return false;
  if (!/^[23]/.test(normalized) || normalized.startsWith('2001:db8:')) return false;
  return true;
}

export async function validatePublicHttpsUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('That does not look like a valid media URL.');
  }

  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    (parsed.port && parsed.port !== '443')
  ) {
    throw new Error('Only public HTTPS media links are supported.');
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (
    !hostname ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.test')
  ) {
    throw new Error('Only public HTTPS media links are supported.');
  }

  let addresses;
  try {
    addresses = isIP(hostname)
      ? [{ address: hostname }]
      : await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error('Could not verify that the media link uses a public host.');
  }

  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error('Only links hosted on public internet addresses are supported.');
  }

  return parsed;
}

export function getPlatformForUrl(value) {
  const hostname = value.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  for (const [domain, platform] of PLATFORM_DOMAINS) {
    if (hostname === domain || hostname.endsWith(`.${domain}`)) return platform;
  }
  return 'aio';
}

function getExtension(value) {
  try {
    return new URL(value).pathname.toLowerCase().match(/\.([a-z0-9]{2,5})$/)?.[1] ?? '';
  } catch {
    return '';
  }
}

export function getMediaKind(value, mimeType = '') {
  const mime = String(mimeType).toLowerCase();
  const extension = getExtension(value);
  if (mime.startsWith('video/') || ['mp4', 'm4v', 'mov', 'webm'].includes(extension)) return 'video';
  if (mime.startsWith('audio/') || ['mp3', 'm4a', 'aac', 'ogg', 'wav', 'flac'].includes(extension)) return 'audio';
  if (
    mime.startsWith('image/') &&
    ['image/jpeg', 'image/png'].includes(mime)
  ) return 'photo';
  if (['jpg', 'jpeg', 'png'].includes(extension)) return 'photo';
  return 'document';
}

export function isDownloaderLink(value) {
  const candidate = extractUrl(value);
  if (!candidate) return false;
  try {
    const parsed = new URL(candidate);
    return getPlatformForUrl(parsed) !== 'aio' ||
      DIRECT_MEDIA_EXTENSIONS.has(getExtension(parsed.href));
  } catch {
    return false;
  }
}

function sendUrl(response, url, mimeType = '') {
  const kind = getMediaKind(url, mimeType);
  if (kind === 'video') return response.video(url, { supports_streaming: true });
  if (kind === 'audio') return response.audio(url);
  if (kind === 'photo') return response.photo(url);
  return response.document(url);
}

function getCandidateScore(candidate) {
  const kind = getMediaKind(candidate.url, candidate.mimeType);
  const kindScore = kind === 'video' ? 3 : kind === 'audio' ? 2 : kind === 'photo' ? 1 : 0;
  const qualityText = `${candidate.quality ?? ''} ${candidate.resolution ?? ''}`;
  const quality = Number(qualityText.match(/\d{2,4}/)?.[0] ?? 0);
  return kindScore * 10000 + quality;
}

function metadataForField(field, metadata) {
  const normalizedField = String(field).toLowerCase().replace(/[_-]/g, '');
  if (normalizedField === 'mp4' || ['normalvideo', 'hd', 'sd'].includes(normalizedField)) {
    return {
      ...metadata,
      mimeType: metadata.mimeType || 'video/mp4',
      quality: metadata.quality || (normalizedField === 'hd' ? '1080' : '720')
    };
  }
  if (normalizedField === 'mp3') {
    return { ...metadata, mimeType: metadata.mimeType || 'audio/mpeg' };
  }
  return metadata;
}

export function extractMediaUrls(payload) {
  const candidates = [];
  const seen = new Set();

  const addCandidate = (value, metadata = {}) => {
    if (typeof value !== 'string') return;
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      return;
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || seen.has(parsed.href)) return;
    seen.add(parsed.href);
    candidates.push({
      url: parsed.href,
      mimeType: metadata.mimeType ?? metadata.mime_type ?? metadata.type ?? '',
      quality: metadata.quality ?? '',
      resolution: metadata.resolution ?? metadata.height ?? ''
    });
  };

  const visit = (value, field = '', depth = 0, metadata = {}) => {
    if (depth > 7 || value === null || value === undefined) return;
    const normalizedField = String(field).toLowerCase().replace(/[_-]/g, '');

    if (typeof value === 'string') {
      if (URL_FIELDS.has(normalizedField) || CONTAINER_FIELDS.has(normalizedField) || depth === 0) {
        addCandidate(value, metadata);
      }
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) visit(item, field, depth + 1, metadata);
      return;
    }

    if (typeof value !== 'object') return;
    const itemMetadata = {
      ...metadata,
      mimeType: value.mimeType ?? value.mime_type ?? value.contentType ?? value.type ?? metadata.mimeType,
      quality: value.quality ?? metadata.quality,
      resolution: value.resolution ?? value.height ?? metadata.resolution
    };

    for (const [key, nested] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase().replace(/[_-]/g, '');
      if (URL_FIELDS.has(normalizedKey)) {
        addCandidate(nested, metadataForField(normalizedKey, itemMetadata));
      } else if (CONTAINER_FIELDS.has(normalizedKey)) {
        visit(nested, normalizedKey, depth + 1, itemMetadata);
      }
    }
  };

  visit(payload);
  return candidates.sort((a, b) => getCandidateScore(b) - getCandidateScore(a));
}

async function readJsonResponse(stream) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > API_JSON_LIMIT) {
      stream.destroy();
      throw new Error('Downloader API returned an unexpectedly large response.');
    }
    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) throw new Error('Downloader API returned an empty response.');
  try {
    return JSON.parse(text);
  } catch {
    const candidate = extractMediaUrls(text)[0];
    if (candidate) return { success: true, url: candidate.url };
    throw new Error('Downloader API returned an unreadable response.');
  }
}

function createLimitedStream(source) {
  let bytes = 0;
  const limiter = new Transform({
    transform(chunk, encoding, callback) {
      bytes += chunk.length;
      callback(
        bytes > MAX_MEDIA_BYTES
          ? new Error('The media is larger than Telegram can accept.')
          : null,
        chunk
      );
    }
  });
  source.on('error', (error) => limiter.destroy(error));
  return source.pipe(limiter);
}

async function sendStream(response, stream, mimeType, contentLength) {
  const size = Number(contentLength);
  if (Number.isFinite(size) && size > MAX_MEDIA_BYTES) {
    stream.destroy();
    throw new Error('The media is larger than Telegram can accept.');
  }

  const kind = getMediaKind('', mimeType);
  const limited = createLimitedStream(stream);
  if (kind === 'video') return response.video(limited, { filename: 'alldl.mp4', supports_streaming: true });
  if (kind === 'audio') return response.audio(limited, { filename: 'alldl-audio' });
  if (kind === 'photo') return response.photo(limited, { filename: 'alldl-image' });
  return response.document(limited, { filename: 'alldl-media' });
}

function getApiErrorMessage(payload, status) {
  if (status === 502 || status === 503 || payload?.upstream?.status === false) {
    const upstreamStatus = payload?.upstream?.message?.match(/\b50[0-9]\b/)?.[0] ?? 'unavailable';
    return `Downloader API is temporarily unavailable (${upstreamStatus}). Please try again later.`;
  }
  const detail = payload?.data?.message ?? payload?.upstream?.message ?? payload?.message;
  if (typeof detail === 'string' && detail.trim()) {
    return `Downloader API: ${detail.trim().slice(0, 180)}`;
  }
  if (payload?.data?.status === false) {
    return 'Downloader API could not resolve this media link.';
  }
  return `Downloader API returned HTTP ${status}.`;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function downloadWithApi(sourceUrl, platform, response) {
  const apiUrl = new URL(`${API_BASE}/api/download/${platform}`);
  apiUrl.searchParams.set('url', sourceUrl);

  for (let attempt = 0; attempt < API_ATTEMPTS; attempt += 1) {
    const result = await axios.get(apiUrl.href, {
      timeout: 35000,
      maxRedirects: 0,
      responseType: 'stream',
      validateStatus: () => true,
      headers: { Accept: 'application/json,video/*,audio/*,image/*,application/octet-stream' }
    });

    const contentType = String(result.headers['content-type'] ?? '').split(';')[0].toLowerCase();
    const status = result.status;

    if (status >= 300 && status < 400) {
      const location = result.headers.location;
      result.data.destroy();
      if (!location) throw new Error('Downloader API returned an empty media redirect.');
      const mediaUrl = await validatePublicHttpsUrl(new URL(location, apiUrl).href);
      return sendUrl(response, mediaUrl.href);
    }

    if (status < 200 || status >= 300) {
      const payload = await readJsonResponse(result.data).catch(() => null);
      if (attempt < API_ATTEMPTS - 1 && (status === 502 || status === 503 || status === 504)) {
        await wait(600 * (attempt + 1));
        continue;
      }
      throw new Error(getApiErrorMessage(payload, status));
    }

    if (
      contentType.startsWith('video/') ||
      contentType.startsWith('audio/') ||
      contentType.startsWith('image/') ||
      contentType === 'application/octet-stream'
    ) {
      return sendStream(response, result.data, contentType, result.headers['content-length']);
    }

    const payload = await readJsonResponse(result.data);
    const media = extractMediaUrls(payload)[0];
    if (media && payload?.success !== false && payload?.data?.status !== false) {
      const mediaUrl = await validatePublicHttpsUrl(media.url);
      return sendUrl(response, mediaUrl.href, media.mimeType);
    }

    if (attempt < API_ATTEMPTS - 1) {
      await wait(600 * (attempt + 1));
      continue;
    }

    if (payload?.success === false || payload?.data?.status === false) {
      throw new Error(getApiErrorMessage(payload, status));
    }
    const fields = Object.keys(payload?.data ?? {}).join(', ') || 'none';
    console.warn(`Downloader API returned no media URL for ${platform}; response fields: ${fields}`);
    throw new Error('Downloader API could not provide media after 3 attempts. The link may be private or unsupported, or the provider may be temporarily failing.');
  }

  throw new Error('Downloader API is temporarily unavailable. Please try again later.');
}

function extractUrl(text) {
  const match = String(text ?? '').match(/https?:\/\/[^\s<>"')\]]+/i);
  return match?.[0]?.replace(/[.,!?;:]+$/, '') ?? null;
}

export function getInputLink(msg, args) {
  const argumentUrl = extractUrl(Array.isArray(args) ? args.join(' ') : '');
  if (argumentUrl) return { url: argumentUrl, targetMessage: msg };

  const currentText = msg.text ?? msg.caption ?? '';
  const currentUrl = extractUrl(currentText);
  if (currentUrl) return { url: currentUrl, targetMessage: msg };

  const replyMessage = msg.reply_to_message;
  const replyText = replyMessage?.text ?? replyMessage?.caption ?? '';
  const replyUrl = extractUrl(replyText);
  return replyUrl
    ? { url: replyUrl, targetMessage: replyMessage }
    : null;
}

async function setLinkReaction(bot, message, emoji) {
  if (typeof bot?.setMessageReaction !== 'function' || !message?.message_id) return;
  const candidates = [...new Set([emoji, '👍', '❤️', '🔥', '👎', '🎉'])];
  for (const candidate of candidates) {
    try {
      await bot.setMessageReaction(message.chat.id, message.message_id, {
        reaction: [{ type: 'emoji', emoji: candidate }]
      });
      return;
    } catch (error) {
      if (!String(error.message).includes('REACTION_INVALID')) {
        console.warn('Could not update downloader link reaction:', error.message);
        return;
      }
    }
  }
  console.warn('Could not update downloader link reaction: no allowed emoji reaction was accepted.');
}

async function startProgressAnimation(response) {
  const frames = ['◐', '◓', '◑', '◒'];
  const statusMessage = await response.reply('⬇️ Downloading media ◐');
  let active = true;
  let frame = 1;
  let timer;
  let pendingEdit = Promise.resolve();

  const animate = () => {
    if (!active) return;
    const text = `⬇️ Downloading media ${frames[frame % frames.length]}`;
    frame += 1;
    pendingEdit = pendingEdit
      .catch(() => {})
      .then(() => active ? response.editText(statusMessage, text) : undefined)
      .catch(() => {});
    timer = setTimeout(animate, 1400);
  };

  timer = setTimeout(animate, 1400);

  return async (finalText) => {
    active = false;
    clearTimeout(timer);
    await pendingEdit.catch(() => {});
    try {
      await response.editText(statusMessage, finalText);
    } catch (error) {
      console.warn('Could not update downloader status:', error.message);
    }
  };
}

export async function onStart({ bot, msg, args, response }) {
  const input = getInputLink(msg, args);
  if (!input) {
    return response.reply('Send a supported media URL with the command, or reply to a message containing one.');
  }

  let finishProgress;
  try {
    await setLinkReaction(bot, input.targetMessage, '⬇️');
    finishProgress = await startProgressAnimation(response);
    const source = await validatePublicHttpsUrl(input.url);
    const extension = getExtension(source.href);
    let sentMedia;
    if (DIRECT_MEDIA_EXTENSIONS.has(extension)) {
      sentMedia = await sendUrl(response, source.href);
    } else {
      const platform = getPlatformForUrl(source);
      sentMedia = await downloadWithApi(source.href, platform, response);
    }

    await setLinkReaction(bot, input.targetMessage, '✅');
    await finishProgress('✅ Download complete');
    return sentMedia;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The media could not be downloaded.';
    await setLinkReaction(bot, input.targetMessage, '❌');
    if (finishProgress) {
      await finishProgress(`❌ ${message}`);
      return;
    }
    return response.reply(`❌ ${message}`);
  }
}

export async function onChat({ bot, msg, response }) {
  if (!msg?.chat || msg.from?.is_bot) return true;
  const input = getInputLink(msg, []);
  if (!input || !isDownloaderLink(input.url)) return true;

  await onStart({ bot, msg, args: [input.url], response });
  return false;
}
