import { readSettingsFile, writeSettingsFile } from '../../core/runtime/settings.js';

export const meta = {
  name: 'devonly',
  version: '2.0.0',
  aliases: ['maintenance', 'maintenancemode'],
  description: 'Toggle developer-only access to the bot.',
  author: 'SIFAT',
  prefix: 'both',
  category: 'dev',
  role: 'developer',
  type: 'dev',
  cooldown: 0,
  guide: ['status - show developer-only mode', 'on - allow only developers', 'off - allow other users again']
};

export async function onStart({ args = [], response }) {
  let settings;
  try {
    settings = readSettingsFile();
  } catch (error) {
    console.error('Could not read bot settings:', error.message);
    return response.reply('⚠️ Bot settings are unavailable.');
  }

  const action = String(args[0] ?? 'status').toLowerCase();
  if (action === 'status') {
    const status = settings.devOnly === true ? 'ENABLED' : 'DISABLED';
    return response.reply(`⚙️ *Developer-only mode: ${status}*`, { parse_mode: 'Markdown' });
  }
  if (!['on', 'off', 'enable', 'disable'].includes(action)) {
    return response.reply('Use `.devonly on`, `.devonly off`, or `.devonly status`.');
  }

  const enabled = action === 'on' || action === 'enable';
  if (settings.devOnly === enabled) {
    return response.reply(`ℹ️ Developer-only mode is already ${enabled ? 'enabled' : 'disabled'}.`);
  }

  settings.devOnly = enabled;
  try {
    writeSettingsFile(settings);
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
