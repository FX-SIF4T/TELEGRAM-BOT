export const meta = {
  name: 'pin',
  version: '1.0.0',
  aliases: [],
  description: 'Pin a replied message in the group.',
  author: 'SIFAT',
  prefix: 'both',
  category: 'group',
  type: 'administrator',
  cooldown: 2,
  guide: [
    'Reply to a message with pin to pin it.',
    'Automatically pins the replied message in the group.'
  ]
};

export async function onStart({ bot, msg, args, response }) {
  if (!msg.reply_to_message?.message_id) {
    return response.reply('❌ Please reply to a message with this command to pin it.');
  }

  const loading = await response.reply('📌 Pinning message...', { parse_mode: 'HTML' });

  try {
    await bot.pinChatMessage(msg.chat.id, msg.reply_to_message.message_id, {
      disable_notification: false
    });

    const pinnedBy = escapeHtml(
      msg.from.username ? `@${msg.from.username}` : msg.from.first_name || 'Unknown'
    );

    await response.editText(
      loading,
      `<b>📌 Message Pinned Successfully!</b>\n\nPinned by: ${pinnedBy}`,
      {
        parse_mode: 'HTML',
        reply_to_message_id: msg.reply_to_message.message_id
      }
    );

    setTimeout(async () => {
      try {
        await response.delete(msg.message_id);
      } catch {}
    }, 5000);

  } catch (error) {
    console.error('Pin Command Error:', error);

    const errMsg = String(error?.response?.body?.description || error?.message || error);

    if (/not enough rights|not enough administrator rights/i.test(errMsg)) {
      return response.editText(loading, '🚫 Bot lacks permission to pin messages.');
    }

    if (/can't pin|cannot pin/i.test(errMsg)) {
      return response.editText(loading, '⚠️ This message cannot be pinned.');
    }

    await response.editText(
      loading,
      '❌ Failed to pin the message. Please try again later.'
    );
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}
