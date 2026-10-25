import { createCanvas } from 'canvas';

export const meta = {
  name: 'up',
  aliases: [],
  version: '1.0.0',
  author: 'ShawnDesu',
  description: 'Shows the bot uptime on a status card.',
  prefix: 'both',
  guide: [''],
  cooldown: 5,
  type: 'anyone',
  category: 'system'
};

function formatUptime(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;

  return `${days}d ${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m ${String(remainder).padStart(2, '0')}s`;
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

function drawMetric(context, x, label, value, valueColor = '#f8fafc') {
  roundedRect(context, x, 530, 352, 112, 22);
  context.fillStyle = 'rgba(9, 24, 43, 0.86)';
  context.fill();
  context.strokeStyle = 'rgba(103, 232, 249, 0.22)';
  context.lineWidth = 2;
  context.stroke();

  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  context.font = 'small-caps 700 23px "DejaVu Sans", sans-serif';
  context.fillStyle = '#8ba4bd';
  context.fillText(label, x + 26, 570);

  context.font = '700 30px "DejaVu Sans", sans-serif';
  context.fillStyle = valueColor;
  context.fillText(value, x + 26, 615);
}

function createUptimeCard(uptime, memoryMb) {
  const canvas = createCanvas(1280, 700);
  const context = canvas.getContext('2d');

  const background = context.createLinearGradient(0, 0, 1280, 700);
  background.addColorStop(0, '#07111f');
  background.addColorStop(0.55, '#102943');
  background.addColorStop(1, '#07111f');
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.fillStyle = 'rgba(34, 211, 238, 0.08)';
  context.beginPath();
  context.arc(1120, 70, 230, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = 'rgba(59, 130, 246, 0.08)';
  context.beginPath();
  context.arc(120, 660, 250, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = 'rgba(103, 232, 249, 0.18)';
  context.lineWidth = 2;
  roundedRect(context, 38, 38, 1204, 624, 30);
  context.stroke();

  context.textBaseline = 'alphabetic';
  context.textAlign = 'left';
  context.font = 'small-caps 700 48px "DejaVu Sans", sans-serif';
  context.fillStyle = '#f8fafc';
  context.shadowColor = 'rgba(34, 211, 238, 0.65)';
  context.shadowBlur = 16;
  context.fillText('ᴇꜱʜᴀ ʙᴏᴛ', 86, 112);
  context.shadowBlur = 0;

  context.textAlign = 'right';
  context.font = 'small-caps 700 25px "DejaVu Sans", sans-serif';
  context.fillStyle = '#67e8f9';
  context.fillText('ꜱʏꜱᴛᴇᴍ ꜱᴛᴀᴛᴜꜱ', 1194, 106);

  context.strokeStyle = 'rgba(103, 232, 249, 0.35)';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(86, 145);
  context.lineTo(1194, 145);
  context.stroke();

  roundedRect(context, 80, 178, 1120, 314, 26);
  context.fillStyle = 'rgba(4, 15, 29, 0.72)';
  context.fill();

  context.textAlign = 'left';
  context.font = 'small-caps 700 32px "DejaVu Sans", sans-serif';
  context.fillStyle = '#8ba4bd';
  context.fillText('ᴜᴘᴛɪᴍᴇ', 118, 250);

  let uptimeFontSize = 88;
  context.font = `700 ${uptimeFontSize}px "DejaVu Sans", sans-serif`;
  while (context.measureText(uptime).width > 1040 && uptimeFontSize > 56) {
    uptimeFontSize -= 4;
    context.font = `700 ${uptimeFontSize}px "DejaVu Sans", sans-serif`;
  }
  context.fillStyle = '#f8fafc';
  context.shadowColor = 'rgba(34, 211, 238, 0.5)';
  context.shadowBlur = 22;
  context.fillText(uptime, 118, 365);
  context.shadowBlur = 0;

  context.font = 'small-caps 700 24px "DejaVu Sans", sans-serif';
  context.fillStyle = '#67e8f9';
  context.fillText('ʀᴜɴɴɪɴɢ ꜱɪɴᴄᴇ ᴘʀᴏᴄᴇꜱꜱ ꜱᴛᴀʀᴛ', 120, 430);

  drawMetric(context, 80, 'ꜱᴛᴀᴛᴜꜱ', 'ONLINE', '#4ade80');
  drawMetric(context, 464, 'ᴍᴇᴍᴏʀʏ', `${memoryMb} MB`);
  drawMetric(context, 848, 'ʀᴜɴᴛɪᴍᴇ', process.version);

  return canvas.toBuffer('image/png');
}

export async function onStart({ response }) {
  const uptime = formatUptime(process.uptime());
  const memoryMb = Math.round(process.memoryUsage().rss / (1024 * 1024));
  const caption =
    `ᴇꜱʜᴀ ʙᴏᴛ · ᴜᴘᴛɪᴍᴇ ${uptime}\n` +
    `ᴍᴇᴍᴏʀʏ ${memoryMb} ᴍʙ · ꜱᴛᴀᴛᴜꜱ ᴏɴʟɪɴᴇ`;

  try {
    const card = createUptimeCard(uptime, memoryMb);
    await response.photo(card, { caption });
  } catch (error) {
    console.error(`Could not send uptime card (${error?.name || 'Error'}).`);
    await response.reply(caption);
  }
}
