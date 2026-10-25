import { isAnonymousGroupSender } from '../../core/runtime/access.js';

export const meta = {
  name: 'uid',
  version: '1.0.0',
  aliases: ['id', 'userid'],
  description: 'Shows your Telegram user ID or the ID of the user you replied to.',
  author: 'SIFAT',
  prefix: 'both',
  category: 'utility',
  type: 'anyone',
  cooldown: 3,
  guide: ['uid — Get your own user ID or the ID of a replied user.']
};

export async function onStart({ bot, msg, args, usages, response }) {
  try {
    if (isAnonymousGroupSender({
      senderChat: msg.sender_chat,
      chatType: msg.chat?.type
    })) {
      const senderTitle = msg.sender_chat.title || msg.chat.title || 'this group';
      const safeTitle = String(senderTitle).replace(/[&<>"']/g, (character) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[character]);
      return response.reply(
        `⚠️ Telegram hides your personal account when you send as <b>${safeTitle}</b>. Send <code>.uid</code> from your personal account to see the ID and username used for developer access.`,
        { parse_mode: 'HTML' }
      );
    }

    const target = msg.reply_to_message?.from || msg.from;
    if (target?.id === undefined || target?.id === null) {
      return response.reply('❌ Could not find a Telegram user ID in this message.');
    }
    const name = [target.first_name, target.last_name].filter(Boolean).join(' ') || 'Unknown User';
    const id = target.id;
    const username = target.username
      ? `<code>@${String(target.username).replace(/[&<>"']/g, (character) => ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;'
        })[character])}</code>`
      : '<i>not set</i>';
    const safeName = String(name).replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[character]);

    await response.reply(
      `🆔 <b>${safeName}</b>'s Telegram ID: <code>${id}</code>\nUsername: ${username}`,
      { parse_mode: 'HTML' }
    );
  } catch (err) {
    console.error(err);
    await response.reply('❌ An error occurred while fetching the user ID.');
  }
}
