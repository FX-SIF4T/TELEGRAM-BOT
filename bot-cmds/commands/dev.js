import { isConfiguredBotDeveloper } from '../../core/runtime/access.js';
import { readSettingsFile, writeSettingsFile } from '../../core/runtime/settings.js';

export const meta = {
  name: 'dev',
  version: '1.0.5',
  description: 'Manage bot developers (list/add/remove)',
  author: 'SIFAT',
  prefix: 'both',
  category: 'dev',
  type: 'anyone',
  role: 'developer',
  cooldown: 2,
  guide: [
    '- show this guide',
    'list - list developers',
    'add <uid|@username> - add developer (or reply)',
    'remove <uid|@username> - remove developer (or reply)',
    'only on - allow only developers to use the bot',
    'only off - disable developer-only mode',
    'only status - show developer-only mode'
  ]
};

const getSettingsPath = () => {
  if (!global.settingsPath) throw new Error('The settings file path is not configured.');
  return global.settingsPath;
};

const normalizeId = (id) => {
  if (id === undefined || id === null) return null;
  const value = String(id).trim();
  return /^\d{1,20}$/.test(value) ? value : null;
};

const normalizeUsername = (username) => {
  if (username === undefined || username === null) return null;
  const value = String(username).trim().replace(/^@/, '');
  return /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(value) ? value.toLowerCase() : null;
};

const buildUserName = (user) => {
  if (!user) return null;
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  const baseName = fullName || (user.username ? `@${user.username}` : null);
  if (!baseName) return null;
  return user.username && !baseName.includes(user.username)
    ? `${baseName} (@${user.username})`
    : baseName;
};

const loadSettings = () => {
  getSettingsPath();
  const source = readSettingsFile();
  if (!Array.isArray(source.devID)) source.devID = [];
  source.devID = [...new Set(source.devID.map(normalizeId).filter(Boolean))];
  if (!Array.isArray(source.devUsername)) source.devUsername = [];
  source.devUsername = [...new Set(source.devUsername.map(normalizeUsername).filter(Boolean))];
  return source;
};

const saveSettings = (settings) => {
  writeSettingsFile(settings);
};

const isDev = (settings, userId, username) =>
  isConfiguredBotDeveloper(userId, username, settings);

const getUserDisplay = async (bot, userId, userObj = null) => {
  const uid = normalizeId(userId);
  if (!uid) return { name: null, id: null };
  if (userObj) {
    const name = buildUserName(userObj);
    if (name) return { name, id: uid };
  }
  try {
    const chat = await bot.getChat(uid);
    const name = buildUserName(chat);
    return { name, id: uid };
  } catch (error) {
    return { name: null, id: uid };
  }
};

const buildDevList = async (bot, settings) => {
  const developerIds = Array.isArray(settings?.devID) ? settings.devID : [];
  const developerUsernames = Array.isArray(settings?.devUsername) ? settings.devUsername : [];
  if (!developerIds.length && !developerUsernames.length) {
    return '👑 No developers set.';
  }

  const entries = await Promise.all(
    developerIds.map(async (id, index) => {
      const { name, id: uid } = await getUserDisplay(bot, id);
      const displayName = name || `\`${uid}\``;
      return `${index + 1}. ${displayName}`;
    })
  );
  entries.push(...developerUsernames.map(
    (username, index) => `${developerIds.length + index + 1}. \`@${username}\``
  ));

  return `👑 *Developer list:*\n\n${entries.join('\n')}`;
};

const handleList = async (bot, settings, response) => {
  const list = await buildDevList(bot, settings);
  return response.reply(list, { parse_mode: 'Markdown' });
};

const handleAddRemove = async (bot, msg, args, response, settings, action) => {
  const requesterId = msg.from?.id ?? msg.from?.user_id;
  const requesterUsername = msg.from?.username;
  if (!isDev(settings, requesterId, requesterUsername)) {
    return response.reply('⚠️ Only developers can use this command.', { parse_mode: 'Markdown' });
  }

  const repliedUser = msg.reply_to_message?.from;
  const rawTarget = args[1];
  const targetId = normalizeId(repliedUser?.id ?? rawTarget);
  const targetUsername = normalizeUsername(
    repliedUser?.username ?? (targetId ? null : rawTarget)
  );
  if (!targetId && !targetUsername) {
    return response.reply(
      `⚠️ Missing or invalid target. Use \`${action} <numeric uid|@username>\` or reply to a user message.`,
      { parse_mode: 'Markdown' }
    );
  }

  const currentIds = new Set((settings.devID || []).map(String));
  const currentUsernames = new Set((settings.devUsername || []).map(normalizeUsername).filter(Boolean));
  const hasTargetId = Boolean(targetId && currentIds.has(targetId));
  const hasTargetUsername = Boolean(targetUsername && currentUsernames.has(targetUsername));
  const identityParts = [];
  if (targetId) {
    const display = await getUserDisplay(bot, targetId, repliedUser);
    identityParts.push(display.name ? `${display.name} (\`${display.id}\`)` : `\`${targetId}\``);
  }
  if (targetUsername) identityParts.push(`\`@${targetUsername}\``);
  const userLabel = identityParts.join(' / ');

  if (action === 'add') {
    if ((!targetId || hasTargetId) && (!targetUsername || hasTargetUsername)) {
      return response.reply(`ℹ️ User ${userLabel} is already a developer.`, { parse_mode: 'Markdown' });
    }
    if (targetId && !hasTargetId) settings.devID = [...new Set([...currentIds, targetId])];
    if (targetUsername && !hasTargetUsername) {
      settings.devUsername = [...new Set([...currentUsernames, targetUsername])];
    }
  } else {
    if (!hasTargetId && !hasTargetUsername) {
      return response.reply(`ℹ️ User ${userLabel} is not a developer.`, { parse_mode: 'Markdown' });
    }
    if (targetId) settings.devID = [...currentIds].filter((id) => id !== targetId);
    if (targetUsername) {
      settings.devUsername = [...currentUsernames].filter((username) => username !== targetUsername);
    }
  }

  try {
    saveSettings(settings);
    const actionText = action === 'add' ? 'Added' : 'Removed';
    return response.reply(`✅ ${actionText} developer: ${userLabel}.`, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error saving settings:', error);
    return response.reply(`⚠️ Failed to save settings: ${error?.message ?? error}`, { parse_mode: 'Markdown' });
  }
};

export async function onStart({ bot, msg, args, response, usages }) {
  let settings;
  try {
    settings = loadSettings();
  } catch (error) {
    console.error('Error loading settings:', error?.message ?? error);
    return response.reply('⚠️ Could not read bot settings. No changes were made.');
  }

  if (!args.length) {
    return usages();
  }

  const subcommand = args[0].toLowerCase();

  switch (subcommand) {
    case 'only': {
      const action = String(args[1] ?? '').toLowerCase();
      if (!action || action === 'status') {
        const status = settings.devOnly === true ? 'ENABLED' : 'DISABLED';
        return response.reply(
          `⚙️ *Developer-only mode: ${status}*\n\nUse \`.dev only on\` or \`.dev only off\`.`,
          { parse_mode: 'Markdown' }
        );
      }
      if (!['on', 'off'].includes(action)) {
        return response.reply('Use `.dev only on`, `.dev only off`, or `.dev only status`.');
      }
      const enabled = action === 'on';
      if (settings.devOnly === enabled) {
        return response.reply(`ℹ️ Developer-only mode is already ${enabled ? 'enabled' : 'disabled'}.`);
      }
      settings.devOnly = enabled;
      try {
        saveSettings(settings);
        return response.reply(
          enabled
            ? '✅ Developer-only mode enabled. Only configured developers can use the bot.'
            : '✅ Developer-only mode disabled.'
        );
      } catch (error) {
        console.error('Failed to save developer-only mode:', error);
        return response.reply('⚠️ Could not save the developer-only setting.');
      }
    }

    case 'list':
      return handleList(bot, settings, response);

    case 'add':
    case 'remove':
      return handleAddRemove(bot, msg, args, response, settings, subcommand);

    default:
      const defaultGuide = meta.guide.join('\n');
      return response.reply(defaultGuide || '⚠️ Invalid subcommand.', { parse_mode: 'Markdown' });
  }
}
