export const meta = {
  name: 'start',
  version: '1.0.0',
  aliases: [],
  description: 'Initiate interaction with the bot and display welcome information',
  author: 'SIFAT',
  prefix: 'both',
  category: 'hidden',
  type: 'anyone',
  cooldown: 0,
  guide: []
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

export async function onStart({ msg, response }) {
  const prefix = global.settings?.prefix ?? '.';
  const userName = escapeHtml(
    [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || 'User'
  );
  const welcomeMessage =
    `👋 <b>Hello, ${userName}!</b>\n\n` +
    '<b>Welcome to Esha Bot.</b>\n\n' +
    `Explore the available commands. For the full list, type <code>${escapeHtml(prefix)}help</code>.\n\n` +
    'If you need help, contact the bot developer.';

  try {
    await response.reply(welcomeMessage, { parse_mode: 'HTML' });
  } catch (error) {
    console.error('Failed to send start message:', error);
  }
}