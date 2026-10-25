import moment from 'moment-timezone';
import { createCanvas, loadImage } from 'canvas';
import { claimDailyReward } from '../../core/runtime/storage.js';

const TIME_ZONE = 'Asia/Dhaka';
const CLAIM_LIMIT = 5;
const BASE_REWARD = Object.freeze({ coin: 500, exp: 50 });
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

export const meta = {
  name: 'daily',
  version: '1.0.0',
  author: 'S1F4T',
  description: 'Receive daily rewards with only image interface',
  prefix: 'both',
  category: 'game',
  role: 'normaluser',
  cooldown: 5,
  guide: ['Claim your daily reward']
};

export function getDailyReward(dayIndex, baseReward = BASE_REWARD) {
  if (!Number.isInteger(dayIndex) || dayIndex < 1 || dayIndex > 7) {
    throw new RangeError('dayIndex must be between 1 and 7.');
  }
  const multiplier = 1.2 ** (dayIndex - 1);
  return {
    coins: Math.floor(baseReward.coin * multiplier),
    experience: Math.floor(baseReward.exp * multiplier)
  };
}

function getUserName(user) {
  return [user?.first_name, user?.last_name].filter(Boolean).join(' ').toUpperCase() ||
    (user?.username ? `@${user.username}`.toUpperCase() : 'USER');
}

function roundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

async function readTelegramAvatar(bot, userId) {
  if (
    typeof bot?.getUserProfilePhotos !== 'function' ||
    typeof bot?.getFileStream !== 'function'
  ) {
    return null;
  }

  try {
    const profile = await bot.getUserProfilePhotos(userId, { limit: 1 });
    const photoSizes = profile?.photos?.[0] ?? [];
    const photo = photoSizes.reduce((largest, candidate) => {
      const candidateSize = Number(candidate.file_size ?? candidate.width * candidate.height ?? 0);
      const largestSize = Number(largest?.file_size ?? largest?.width * largest?.height ?? 0);
      return candidateSize > largestSize ? candidate : largest;
    }, null);
    if (!photo?.file_id) return null;

    const stream = bot.getFileStream(photo.file_id);
    const chunks = [];
    let totalBytes = 0;
    for await (const chunk of stream) {
      const data = Buffer.from(chunk);
      totalBytes += data.length;
      if (totalBytes > AVATAR_MAX_BYTES) {
        stream.destroy?.();
        throw new Error('Telegram profile photo is too large.');
      }
      chunks.push(data);
    }
    return chunks.length ? Buffer.concat(chunks) : null;
  } catch {
    console.warn('daily: Telegram profile photo unavailable; using initials avatar.');
    return null;
  }
}

export async function renderDailyCard({ userName, claimCount, coins, experience, avatarBuffer }) {
  const width = 1200;
  const height = 675;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  const background = context.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, '#0b132b');
  background.addColorStop(0.55, '#123b5d');
  background.addColorStop(1, '#0d5a50');
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  context.fillStyle = 'rgba(91, 219, 199, 0.08)';
  for (let index = 0; index < 8; index += 1) {
    context.beginPath();
    context.arc(90 + index * 170, 40 + (index % 2) * 580, 90, 0, Math.PI * 2);
    context.fill();
  }

  roundedRect(context, 44, 40, 1112, 595, 34);
  context.fillStyle = 'rgba(5, 15, 32, 0.78)';
  context.fill();
  context.strokeStyle = 'rgba(136, 255, 220, 0.25)';
  context.lineWidth = 2;
  context.stroke();

  context.textAlign = 'left';
  context.textBaseline = 'middle';
  context.font = '700 25px "DejaVu Sans", sans-serif';
  context.fillStyle = '#77f2d0';
  context.fillText('ESHA  •  DAILY REWARD', 88, 100);

  roundedRect(context, 900, 72, 205, 56, 28);
  context.fillStyle = 'rgba(111, 242, 208, 0.14)';
  context.fill();
  context.font = '700 19px "DejaVu Sans", sans-serif';
  context.textAlign = 'center';
  context.fillStyle = '#a4ffe8';
  context.fillText(`CLAIM ${claimCount}/${CLAIM_LIMIT}`, 1002, 100);

  let avatar = null;
  if (avatarBuffer) {
    try {
      avatar = await loadImage(avatarBuffer);
    } catch {
      avatar = null;
    }
  }

  const avatarX = 215;
  const avatarY = 355;
  const avatarRadius = 112;
  context.save();
  context.beginPath();
  context.arc(avatarX, avatarY, avatarRadius, 0, Math.PI * 2);
  context.clip();
  if (avatar) {
    const scale = Math.max((avatarRadius * 2) / avatar.width, (avatarRadius * 2) / avatar.height);
    const drawWidth = avatar.width * scale;
    const drawHeight = avatar.height * scale;
    context.drawImage(
      avatar,
      avatarX - drawWidth / 2,
      avatarY - drawHeight / 2,
      drawWidth,
      drawHeight
    );
  } else {
    const initials = userName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('') || 'U';
    const avatarGradient = context.createLinearGradient(avatarX - 100, avatarY - 100, avatarX + 100, avatarY + 100);
    avatarGradient.addColorStop(0, '#37d6bd');
    avatarGradient.addColorStop(1, '#4078f2');
    context.fillStyle = avatarGradient;
    context.fillRect(avatarX - avatarRadius, avatarY - avatarRadius, avatarRadius * 2, avatarRadius * 2);
    context.font = '700 82px "DejaVu Sans", sans-serif';
    context.textAlign = 'center';
    context.fillStyle = '#ffffff';
    context.fillText(initials, avatarX, avatarY + 4);
  }
  context.restore();
  context.beginPath();
  context.arc(avatarX, avatarY, avatarRadius + 5, 0, Math.PI * 2);
  context.strokeStyle = '#77f2d0';
  context.lineWidth = 7;
  context.stroke();

  context.textAlign = 'left';
  context.font = '700 40px "DejaVu Sans", sans-serif';
  context.fillStyle = '#ffffff';
  context.fillText(userName, 385, 260, 690);
  context.font = '400 20px "DejaVu Sans", sans-serif';
  context.fillStyle = '#a9c3d8';
  context.fillText('YOUR DAILY REWARD IS READY', 388, 306);

  const rewardCards = [
    { x: 385, label: 'COINS', value: `+${coins.toLocaleString()}`, color: '#ffd166' },
    { x: 740, label: 'EXPERIENCE', value: `+${experience.toLocaleString()}`, color: '#75e6da' }
  ];
  for (const reward of rewardCards) {
    roundedRect(context, reward.x, 360, 320, 150, 22);
    context.fillStyle = 'rgba(14, 36, 57, 0.92)';
    context.fill();
    context.strokeStyle = 'rgba(136, 255, 220, 0.18)';
    context.lineWidth = 2;
    context.stroke();
    context.textAlign = 'left';
    context.font = '700 17px "DejaVu Sans", sans-serif';
    context.fillStyle = '#a9c3d8';
    context.fillText(reward.label, reward.x + 26, 397);
    context.font = '700 38px "DejaVu Sans", sans-serif';
    context.fillStyle = reward.color;
    context.fillText(reward.value, reward.x + 26, 456, 265);
  }

  context.textAlign = 'left';
  context.font = '400 16px "DejaVu Sans", sans-serif';
  context.fillStyle = '#86a7bd';
  context.fillText('Come back tomorrow to keep your rewards growing.', 88, 585);
  return canvas.toBuffer('image/png');
}

function formatRewardMessage({ claimCount, coins, experience }) {
  return `✅ Daily reward claimed (${claimCount}/${CLAIM_LIMIT})!\n` +
    `💰 +${coins} coins\n` +
    `⭐ +${experience} EXP`;
}

export async function onStart({ bot, msg, response }) {
  const userId = msg?.from?.id;
  if (userId === undefined || userId === null) {
    return response.reply('⚠️ Could not identify your Telegram account.');
  }

  const now = moment.tz(TIME_ZONE);
  const dateTime = now.format('DD/MM/YYYY');
  const weekday = now.day();
  const dayIndex = weekday === 0 ? 7 : weekday;
  const { coins, experience } = getDailyReward(dayIndex);

  let claim;
  try {
    claim = await claimDailyReward(userId, {
      claimDate: dateTime,
      maxClaims: CLAIM_LIMIT,
      coins,
      experience
    });
  } catch (error) {
    console.error('daily: could not claim reward:', error);
    return response.reply('⚠️ Daily reward is temporarily unavailable.');
  }

  if (!claim.ok && claim.reason === 'limit') {
    return response.reply('🚫 𝗔𝗖𝗖𝗘𝗦𝗦 𝗗𝗘𝗡𝗜𝗘𝗗: 𝟱/𝟱 𝗟𝗶𝗺𝗶𝘁 𝗥𝗲𝗮𝗰𝗵𝗲𝗱!');
  }
  if (!claim.ok) {
    return response.reply('⚠️ Daily reward is temporarily unavailable.');
  }

  const userName = getUserName(msg.from);
  const rewardMessage = formatRewardMessage({
    claimCount: claim.count,
    coins,
    experience
  });

  try {
    const avatarBuffer = await readTelegramAvatar(bot, userId);
    const card = await renderDailyCard({
      userName,
      claimCount: claim.count,
      coins,
      experience,
      avatarBuffer
    });
    return await response.photo(card, { caption: rewardMessage });
  } catch (error) {
    console.error('daily: reward card could not be generated:', error?.message ?? 'Unknown error.');
    return response.reply(rewardMessage);
  }
}
