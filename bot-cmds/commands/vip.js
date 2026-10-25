import { readSettingsFile, writeSettingsFile } from '../../core/runtime/settings.js';

export const meta = {
  name: 'vip',
  version: '1.0.0',
  aliases: ['premium'],
  description: 'Manage VIP users and VIP access.',
  author: 'SIFAT',
  prefix: 'both',
  category: 'dev',
  role: 'developer',
  cooldown: 2,
  guide: [
    'on - enable VIP role access',
    'off - disable VIP role access',
    'status - show VIP access status',
    'add <uid> - add a VIP user',
    'remove <uid> - remove a VIP user',
    'list - list VIP users'
  ]
};

const getVipIds = (settings) => {
  if (!settings.vip || typeof settings.vip !== 'object' || Array.isArray(settings.vip)) {
    settings.vip = { uid: [] };
  }
  if (!Array.isArray(settings.vip.uid)) settings.vip.uid = [];
  settings.vip.uid = [...new Set(settings.vip.uid.map(String).filter((id) => /^\d{1,20}$/.test(id)))];
  return settings.vip.uid;
};

export async function onStart({ args = [], msg, response }) {
  let settings;
  try {
    settings = readSettingsFile();
  } catch (error) {
    console.error('Could not read bot settings:', error.message);
    return response.reply('⚠️ Bot settings are unavailable.');
  }

  const vipIds = getVipIds(settings);
  const action = String(args[0] ?? 'status').toLowerCase();

  if (action === 'status') {
    const enabled = settings.vip.enabled !== false;
    return response.reply(`⚙️ VIP access is currently ${enabled ? 'ENABLED' : 'DISABLED'}.`);
  }

  if (action === 'list') {
    return response.reply(
      vipIds.length
        ? `⭐ *VIP users:*\n\n${vipIds.map((id, index) => `${index + 1}. \`${id}\``).join('\n')}`
        : '⭐ No VIP users are configured.',
      { parse_mode: 'Markdown' }
    );
  }

  if (action === 'on' || action === 'off') {
    settings.vip.enabled = action === 'on';
    return persist(settings, response, action === 'on'
      ? '✅ VIP access enabled.'
      : '✅ VIP access disabled.');
  }

  if (action !== 'add' && action !== 'remove') {
    return response.reply(meta.guide.map((entry) => `.vip ${entry}`).join('\n'));
  }

  const rawTarget = msg?.reply_to_message?.from?.id ?? args[1];
  const targetId = rawTarget === undefined || rawTarget === null
    ? ''
    : String(rawTarget).trim();
  if (!/^\d{1,20}$/.test(targetId)) {
    return response.reply(`Use \`.vip ${action} <numeric uid>\` or reply to a user's message.`);
  }

  const exists = vipIds.includes(targetId);
  if (action === 'add' && exists) {
    return response.reply(`ℹ️ User \`${targetId}\` is already VIP.`, { parse_mode: 'Markdown' });
  }
  if (action === 'remove' && !exists) {
    return response.reply(`ℹ️ User \`${targetId}\` is not VIP.`, { parse_mode: 'Markdown' });
  }

  settings.vip.uid = action === 'add'
    ? [...vipIds, targetId]
    : vipIds.filter((id) => id !== targetId);
  return persist(settings, response, `✅ ${action === 'add' ? 'Added' : 'Removed'} VIP user \`${targetId}\`.`, {
    parse_mode: 'Markdown'
  });
}

function persist(settings, response, successMessage, options = {}) {
  try {
    writeSettingsFile(settings);
    return response.reply(successMessage, options);
  } catch (error) {
    console.error('Failed to save VIP settings:', error);
    return response.reply('⚠️ Could not save the VIP settings.');
  }
}
