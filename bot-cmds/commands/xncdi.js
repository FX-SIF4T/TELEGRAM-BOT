import axios from 'axios';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import canvas from 'canvas';
import { validatePublicHttpsUrl } from './alldl.js';
import {
  canAccessCommand,
  getUserAccessRole,
  isAnonymousGroupSender,
  isTelegramGroupAdmin
} from '../../core/runtime/access.js';

const { createCanvas, loadImage } = canvas;
const BASE = 'https://xncdi.vercel.app';
const TMP_DIR = path.join(os.tmpdir(), 'esha-xncdi');
fs.ensureDirSync(TMP_DIR);

const truncate = (value = '', max = 50) => {
  const text = String(value ?? '');
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
};

const QUALITY_COLOR = (quality = '') =>
  quality.includes('1080') ? '#1e7aff' :
    quality.includes('720') ? '#22bb55' :
      quality.includes('480') ? '#e6a800' : '#888888';

const THUMB_GRADIENTS = [
  ['#3d0c0c', '#7a1a1a'],
  ['#0c1e3d', '#1a3a7a'],
  ['#0c3d1a', '#1a7a35'],
  ['#2a0c3d', '#501a7a'],
  ['#3d2a0c', '#7a551a'],
  ['#0c3d3d', '#1a7070'],
  ['#3d3d0c', '#7a7a1a'],
  ['#1a0c3d', '#351a7a']
];

async function react(bot, msg, emoji) {
  if (typeof bot?.setMessageReaction !== 'function' || !msg?.message_id) return;
  try {
    await bot.setMessageReaction(msg.chat.id, msg.message_id, {
      reaction: [{ type: 'emoji', emoji }]
    });
  } catch {}
}

async function fetchRetry(url, params = {}, timeout = 20000) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await axios.get(url, { params, timeout });
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
  throw new Error('The video service is temporarily unavailable.');
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const words = String(text ?? '').split(' ');
  let line = '';
  let linesDrawn = 0;
  for (const word of words) {
    const next = line + (line ? ' ' : '') + word;
    if (ctx.measureText(next).width > maxWidth && line) {
      if (linesDrawn >= maxLines - 1) {
        ctx.fillText(line.trimEnd() + '…', x, y);
        return;
      }
      ctx.fillText(line, x, y);
      y += lineHeight;
      linesDrawn++;
      line = word;
    } else {
      line = next;
    }
  }
  if (line && linesDrawn < maxLines) ctx.fillText(line, x, y);
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

async function makeXncdiCard(results, query, isTrending) {
  if (!createCanvas) return null;

  const cols = 4;
  const rows = Math.ceil(Math.min(results.length, 8) / cols);
  const thumbWidth = 192;
  const thumbHeight = 108;
  const infoHeight = 52;
  const gap = 6;
  const padX = 12;
  const padY = 12;
  const headerHeight = 58;
  const footerHeight = 36;
  const width = padX * 2 + cols * thumbWidth + (cols - 1) * gap;
  const height = headerHeight + padY + rows * (thumbHeight + infoHeight + gap) -
    gap + padY + footerHeight;

  const image = createCanvas(width, height);
  const ctx = image.getContext('2d');
  ctx.antialias = 'subpixel';
  ctx.fillStyle = '#111111';
  ctx.fillRect(0, 0, width, height);

  const headerGradient = ctx.createLinearGradient(0, 0, width, headerHeight);
  headerGradient.addColorStop(0, '#c0170f');
  headerGradient.addColorStop(1, '#8c0f09');
  ctx.fillStyle = headerGradient;
  ctx.fillRect(0, 0, width, headerHeight);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 28px sans-serif';
  ctx.fillText('XNXX', padX, 38);

  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.fillRect(74, 16, 2, 28);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '14px sans-serif';
  ctx.fillText(
    isTrending ? `🔥 Trending${query ? ' — ' + query : ''}` : `🔍 ${truncate(query, 38)}`,
    84,
    36
  );

  const countLabel = `${results.length} videos`;
  const countWidth = ctx.measureText(countLabel).width + 16;
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  roundRect(ctx, width - padX - countWidth, 17, countWidth, 22, 11);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 11px sans-serif';
  ctx.fillText(countLabel, width - padX - countWidth + 8, 32);

  const dotColors = ['#ff5f56', '#ffbd2e', '#27c93f'];
  for (let index = 0; index < 3; index++) {
    ctx.fillStyle = dotColors[index];
    ctx.beginPath();
    ctx.arc(padX + index * 18, headerHeight - 10, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let index = 0; index < Math.min(results.length, 8); index++) {
    const result = results[index];
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = padX + col * (thumbWidth + gap);
    const y = headerHeight + padY + row * (thumbHeight + infoHeight + gap);
    const [gradientStart, gradientEnd] = THUMB_GRADIENTS[index % THUMB_GRADIENTS.length];
    const thumbGradient = ctx.createLinearGradient(x, y, x + thumbWidth, y + thumbHeight);
    thumbGradient.addColorStop(0, gradientStart);
    thumbGradient.addColorStop(1, gradientEnd);
    ctx.fillStyle = thumbGradient;
    roundRect(ctx, x, y, thumbWidth, thumbHeight, 4);
    ctx.fill();

    const thumbUrl = result.thumbnail || result.thumb || result.image || result.cover || null;
    if (thumbUrl && loadImage) {
      try {
        const safeThumbUrl = await validatePublicHttpsUrl(thumbUrl);
        const thumb = await loadImage(safeThumbUrl.href);
        ctx.save();
        roundRect(ctx, x, y, thumbWidth, thumbHeight, 4);
        ctx.clip();
        ctx.drawImage(thumb, x, y, thumbWidth, thumbHeight);
        ctx.restore();
      } catch {}
    }

    const vignette = ctx.createLinearGradient(x, y, x, y + thumbHeight);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(0.6, 'rgba(0,0,0,0.15)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.65)');
    ctx.fillStyle = vignette;
    roundRect(ctx, x, y, thumbWidth, thumbHeight, 4);
    ctx.fill();

    const centerX = x + thumbWidth / 2;
    const centerY = y + thumbHeight / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.arc(centerX, centerY, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(centerX - 7, centerY - 10);
    ctx.lineTo(centerX - 7, centerY + 10);
    ctx.lineTo(centerX + 12, centerY);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#c0170f';
    roundRect(ctx, x + 5, y + 5, 24, 20, 3);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(index + 1), x + 17, y + 19);
    ctx.textAlign = 'left';

    const duration = result.duration || '';
    if (duration) {
      const durationWidth = ctx.measureText(duration).width + 10;
      ctx.fillStyle = 'rgba(0,0,0,0.82)';
      roundRect(ctx, x + thumbWidth - durationWidth - 5, y + thumbHeight - 22, durationWidth, 17, 3);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText(duration, x + thumbWidth - durationWidth - 1, y + thumbHeight - 9);
    }

    const quality = result.quality || '';
    if (quality) {
      const qualityWidth = ctx.measureText(quality).width + 10;
      ctx.fillStyle = QUALITY_COLOR(quality);
      roundRect(ctx, x + 5, y + thumbHeight - 22, qualityWidth, 17, 3);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px sans-serif';
      ctx.fillText(quality, x + 9, y + thumbHeight - 9);
    }

    ctx.fillStyle = '#1c1c1c';
    ctx.fillRect(x, y + thumbHeight, thumbWidth, infoHeight);
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(x, y + thumbHeight + infoHeight - 1, thumbWidth, 1);
    ctx.fillStyle = '#e8e8e8';
    ctx.font = '12px sans-serif';
    wrapText(ctx, result.title || '─', x + 5, y + thumbHeight + 15, thumbWidth - 10, 15, 2);
    ctx.fillStyle = '#777777';
    ctx.font = '10px sans-serif';
    ctx.fillText(
      [result.views ? `👁 ${result.views}` : '', result.rating ? `⭐ ${result.rating}` : '']
        .filter(Boolean).join('  '),
      x + 5,
      y + thumbHeight + 46
    );
  }

  const footerGradient = ctx.createLinearGradient(0, height - footerHeight, width, height);
  footerGradient.addColorStop(0, '#8c0f09');
  footerGradient.addColorStop(1, '#c0170f');
  ctx.fillStyle = footerGradient;
  ctx.fillRect(0, height - footerHeight, width, footerHeight);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 13px sans-serif';
  ctx.fillText('⬆ Reply 1–8 to stream', padX, height - footerHeight + 23);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('xncdi', width - padX, height - footerHeight + 23);
  ctx.textAlign = 'left';
  return image;
}

function buildTextResults(results, query, isTrending) {
  return `🔞 ${isTrending ? 'Trending' : `"${truncate(query, 30)}"`}\n` +
    `━━━━━━━━━━━━━━━━\n\n` +
    results.map((result, index) =>
      `[${index + 1}] ${truncate(result.title)}\n    ⏱ ${result.duration || '?'} │ 👁 ${result.views || '?'} │ ${result.quality || '?'}`
    ).join('\n\n') +
    `\n\n━━━━━━━━━━━━━━━━\n◈ ʀᴇᴘʟʏ 1-${results.length} ᴛᴏ ꜱᴛʀᴇᴀᴍ`;
}

function cleanupLater(filePath) {
  const timer = setTimeout(() => fs.remove(filePath).catch(() => {}), 30_000);
  timer.unref?.();
}

export const meta = {
  name: 'xncdi',
  aliases: ['xvideo', 'xnxx', 'xv'],
  version: '6.0.0',
  author: 'SIFAT',
  description: 'Search & stream 18+ videos from xncdi',
  prefix: 'both',
  category: '18+',
  role: 'admin',
  cooldown: 15,
  guide: ['[keyword]', 'trending [category]']
};

export async function onStart({ args = [], msg, bot, response, commandName }) {
  const senderId = msg?.from?.id;
  if (!args[0]) {
    await react(bot, msg, '❌');
    return response.reply(
      '🔞 xɴᴄᴅɪ — ᴜꜱᴀɢᴇ\n' +
      '━━━━━━━━━━━━━━━━\n' +
      '◈ .xncdi [keyword]\n' +
      '◈ .xncdi trending\n' +
      '◈ .xncdi trending bangla\n' +
      '◈ .xncdi trending hentai'
    );
  }

  const isTrending = String(args[0]).toLowerCase() === 'trending';
  const query = isTrending
    ? args.slice(1).join(' ').trim()
    : args.join(' ').trim();
  await react(bot, msg, '🔍');

  try {
    let results;
    if (isTrending) {
      const { data } = await fetchRetry(`${BASE}/trending`, query ? { category: query } : {});
      results = (data.results || data || []).slice(0, 8);
    } else {
      const { data } = await fetchRetry(`${BASE}/search`, { q: query, page: 1, sort: 'relevance' });
      results = (data.results || []).slice(0, 8);
    }

    if (!Array.isArray(results) || !results.length) {
      await react(bot, msg, '❌');
      return response.reply(`⌀ ɴᴏ ʀᴇꜱᴜʟᴛꜱ ꜰᴏʀ "${query || 'trending'}"`);
    }
    await react(bot, msg, '✅');

    let sent;
    const card = await makeXncdiCard(results, query, isTrending);
    if (card) {
      const imgPath = path.join(TMP_DIR, `xncdi_list_${Date.now()}_${process.pid}.jpg`);
      await fs.writeFile(imgPath, card.toBuffer('image/jpeg', { quality: 0.92 }));
      try {
        sent = await response.photo(fs.createReadStream(imgPath));
      } finally {
        cleanupLater(imgPath);
      }
    } else {
      sent = await response.reply(buildTextResults(results, query, isTrending));
    }

    if (sent?.message_id && senderId !== undefined && senderId !== null) {
      if (!(global.esha?.replies instanceof Map)) {
        if (global.esha && typeof global.esha === 'object') global.esha.replies = new Map();
      }
      if (global.esha?.replies instanceof Map) {
        global.esha.replies.set(sent.message_id, {
          meta,
          commandName: commandName || meta.name,
          messageId: sent.message_id,
          author: String(senderId),
          results
        });
      }
    }
  } catch (error) {
    await react(bot, msg, '❌');
    console.error('xncdi: search or result delivery failed:', error);
    return response.reply(`⌀ ꜰᴀɪʟᴇᴅ: ${error.message}`);
  }
}

export async function onReply({ msg, data = {}, bot, response }) {
  if (String(msg?.from?.id ?? '') !== String(data.author ?? '')) return;
  if (isAnonymousGroupSender({ senderChat: msg?.sender_chat, chatType: msg?.chat?.type })) return;

  const isGroup = ['group', 'supergroup'].includes(msg?.chat?.type);
  const telegramAdmin = isGroup
    ? await isTelegramGroupAdmin(bot, msg.chat.id, msg.from?.id)
    : false;
  const role = getUserAccessRole({
    userId: msg?.from?.id,
    username: msg?.from?.username,
    settings: global.settings ?? {},
    vip: global.vip ?? {},
    isTelegramGroupAdmin: telegramAdmin
  });
  if (!canAccessCommand(role, meta)) return;

  const rawSelection = String(msg?.text ?? '').trim();
  const number = Number.parseInt(rawSelection, 10);
  if (!Number.isInteger(number) || number < 1 || number > data.results.length) {
    return response.reply(`⌀ ᴇɴᴛᴇʀ 1–${data.results.length}`);
  }

  await react(bot, msg, '📥');
  try {
    if (data.messageId) await bot.deleteMessage(msg.chat.id, data.messageId);
  } catch {}
  global.esha?.replies?.delete(data.messageId);

  const selected = data.results[number - 1];
  let temporaryPath;
  try {
    const { data: sourceData } = await fetchRetry(
      `${BASE}/video-source`,
      { url: selected.url },
      35000
    );
    const streamUrl = sourceData.best || sourceData.hq || sourceData.lq ||
      Object.values(sourceData.qualities || {})[0] || null;
    if (!streamUrl) {
      await react(bot, msg, '❌');
      return response.reply('⌀ ɴᴏ ꜱᴛʀᴇᴀᴍ ᴜʀʟ ꜰᴏᴜɴᴅ');
    }

    const safeStreamUrl = await validatePublicHttpsUrl(streamUrl);
    temporaryPath = path.join(TMP_DIR, `xncdi_${Date.now()}_${process.pid}.mp4`);
    const writer = fs.createWriteStream(temporaryPath);
    const streamResponse = await axios({
      method: 'get',
      url: safeStreamUrl.href,
      responseType: 'stream',
      timeout: 120000
    });
    await new Promise((resolve, reject) => {
      streamResponse.data.pipe(writer);
      writer.on('finish', resolve);
      writer.on('error', reject);
      streamResponse.data.on('error', reject);
    });

    const fileStats = await fs.stat(temporaryPath);
    if (fileStats.size < 1024) {
      await fs.remove(temporaryPath);
      await react(bot, msg, '❌');
      return response.reply('⌀ ᴇᴍᴘᴛʏ ꜰɪʟᴇ — ʀᴇᴛʀʏ');
    }

    await react(bot, msg, '✅');
    await response.video(fs.createReadStream(temporaryPath));
    cleanupLater(temporaryPath);
  } catch (error) {
    if (temporaryPath) await fs.remove(temporaryPath).catch(() => {});
    await react(bot, msg, '❌');
    console.error('xncdi: stream delivery failed:', error);
    return response.reply(`⌀ ꜱᴛʀᴇᴀᴍ ꜰᴀɪʟᴇᴅ: ${error.message}`);
  }
}
