import { isConfiguredBotDeveloper } from '../../core/runtime/access.js';
import { readSettingsFile, writeSettingsFile } from '../../core/runtime/settings.js';

export const meta = {
  name: 'admin',
  aliases: [],
  version: '2.0.0',
  description: 'Manage admin-only mode and bot-wide administrators.',
  author: 'SIFAT',
  prefix: 'both',
  category: 'dev',
  role: 'admin',
  cooldown: 2,
  guide: [
    'on - allow only developers, bot admins, and group admins to use the bot',
    'off - allow all users to use the bot',
    'status - show admin-only mode',
    'list - show bot-wide administrators',
    'add <uid> - add a bot-wide administrator',
    'remove <uid> - remove a bot-wide administrator'
  ]
};

const getAdminIds = (settings) => {
  if (!settings.admin || typeof settings.admin !== 'object' || Array.isArray(settings.admin)) {
    settings.admin = { uid: [] };
  }
  if (!Array.isArray(settings.admin.uid)) settings.admin.uid = [];
  settings.admin.uid = [...new Set(settings.admin.uid.map(String).filter(Boolean))];
  return settings.admin.uid;
};

export async function onStart({ args = [], msg, response }) {
  let settings;
  try {
    settings = readSettingsFile();
  } catch (error) {
    console.error('Could not read bot settings:', error.message);
    return response.reply('Bot settings are unavailable.');
  }
  const adminIds = getAdminIds(settings);
  const action = String(args?.[0] ?? '').toLowerCase();

  if (!action || action === 'status') {
    const status = settings.adminOnly === true ? 'ENABLED' : 'DISABLED';
    return response.reply(
      `⚙️ *Admin-only mode: ${status}*\n\n${meta.guide.slice(0, 3).map((item) => `• .admin ${item}`).join('\n')}`,
      { parse_mode: 'Markdown' }
    );
  }

  if (action === 'on' || action === 'off') {
    settings.adminOnly = action === 'on';
    try {
      writeSettingsFile(settings);
      return response.reply(
        action === 'on'
          ? '✅ Admin-only mode enabled. Developers, bot admins, and Telegram group admins can use the bot.'
          : '✅ Admin-only mode disabled. All users can use the bot.'
      );
    } catch (error) {
      console.error('Failed to save admin-only mode:', error);
      return response.reply('⚠️ Could not save the admin-only setting.');
    }
  }

  const requesterId = msg?.from?.id;
  if (!isConfiguredBotDeveloper(requesterId, msg?.from?.username, settings)) {
    return response.reply('⚠️ Only developers can list or change the bot-wide admin list.');
  }

  if (action === 'list') {
    return response.reply(
      adminIds.length
        ? `👑 *Bot Admins:*\n\n${adminIds.map((id, index) => `${index + 1}. \`${id}\``).join('\n')}`
        : '👑 No bot-wide admins are configured.',
      { parse_mode: 'Markdown' }
    );
  }

  if (action !== 'add' && action !== 'remove') return response.reply(meta.guide.join('\n'));

  const rawId = args?.[1];
  if (typeof rawId !== 'string' || !/^\d+$/.test(rawId)) {
    return response.reply(`Use \`.admin ${action} <uid>\` with a numeric Telegram user ID.`);
  }

  const targetId = rawId;
  const exists = adminIds.includes(targetId);
  if (action === 'add' && exists) {
    return response.reply(`User \`${targetId}\` is already a bot admin.`, { parse_mode: 'Markdown' });
  }
  if (action === 'remove' && !exists) {
    return response.reply(`User \`${targetId}\` is not a bot admin.`, { parse_mode: 'Markdown' });
  }

  settings.admin.uid = action === 'add'
    ? [...adminIds, targetId]
    : adminIds.filter((id) => id !== targetId);

  try {
    writeSettingsFile(settings);
    const label = action === 'add' ? 'Added' : 'Removed';
    return response.reply(`✅ ${label} bot admin: \`${targetId}\`.`, { parse_mode: 'Markdown' });
  } catch (error) {
    settings.admin.uid = adminIds;
    console.error('Failed to save bot admin list:', error);
    return response.reply(`Could not save the bot admin list: ${error.message}`);
  }
}
