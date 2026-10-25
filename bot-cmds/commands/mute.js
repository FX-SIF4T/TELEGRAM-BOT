export const meta = {
  name: 'mute',
  version: '1.0.1',
  aliases: [],
  description: 'Temporarily mute a user from sending messages (reply to a user). Falls back to delete-enforcement in legacy groups.',
  author: 'SIFAT',
  prefix: 'both',
  category: 'group',
  type: 'administrator',
  cooldown: 2,
  guide: [
    'Reply to a user with <minutes>',
    '10',
    'Maximum duration: 525600 minutes (365 days).'
  ]
};

function escapeHtml(value) {
  return String(value ?? 'Unknown').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function userLabel(user) {
  return user?.username
    ? `@${escapeHtml(user.username)}`
    : escapeHtml([user?.first_name, user?.last_name].filter(Boolean).join(' ') || 'Unknown user');
}

export function getMuteKey(chatId, userId) {
  return `${chatId}:${userId}`;
}

export function getMuteStore() {
  if (global.mutedUsers instanceof Map) return global.mutedUsers;
  const previous = global.mutedUsers;
  global.mutedUsers = new Map();
  if (previous && typeof previous === 'object') {
    for (const [userId, info] of Object.entries(previous)) {
      if (info?.chatId !== undefined) {
        global.mutedUsers.set(getMuteKey(info.chatId, userId), info);
      }
    }
  }
  return global.mutedUsers;
}

export async function onStart({ bot, msg, args, response, usages }) {
  if (!msg.reply_to_message || !msg.reply_to_message.from) {
    return usages();
  }

  const durationMin = Number(args?.[0]);
  if (!Number.isInteger(durationMin) || durationMin <= 0) {
    return response.reply('❌ Invalid duration. Provide the number of minutes (positive integer). Example: mute 10');
  }
  if (!Number.isSafeInteger(durationMin) || durationMin > 525600) {
    return response.reply('❌ Mute duration must be between 1 and 525600 minutes (365 days).');
  }

  const targetUser = msg.reply_to_message.from;
  const targetUserId = targetUser.id;
  const chatId = msg.chat.id;
  const chatType = msg.chat.type;
  if (!['group', 'supergroup'].includes(chatType)) {
    return response.reply('❌ Mute can only be used in a group or supergroup.');
  }

  const loading = await response.reply(
    `🔇 Muting ${userLabel(targetUser)} for ${durationMin} minute(s)...`,
    { parse_mode: 'HTML' }
  );

  const until = Math.floor(Date.now() / 1000) + durationMin * 60;

  const muteStore = getMuteStore();
  const muteKey = getMuteKey(chatId, targetUserId);
  muteStore.set(muteKey, { chatId, userId: targetUserId, until, lastNoticeAt: 0 });

  if (chatType === 'group') {
    await response.editText(
      loading,
      `<b>✅ Mute applied (fallback mode)</b>\n\nUser: ${userLabel(targetUser)}\nDuration: ${durationMin} minute(s)\nMethod: delete enforcement\n\nThe bot must have permission to delete messages in this chat.`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  try {
    await bot.restrictChatMember(chatId, targetUserId, {
      can_send_messages: false,
      can_send_media_messages: false,
      can_send_polls: false,
      can_send_other_messages: false,
      can_add_web_page_previews: false,
      until_date: until
    });

    try {
      const userPhotos = await bot.getUserProfilePhotos(targetUserId).catch(() => null);
      if (userPhotos && userPhotos.total_count && userPhotos.photos && userPhotos.photos.length) {
        const fileId = userPhotos.photos[0][userPhotos.photos[0].length - 1].file_id;
        await response.photo(fileId, {
          caption: `<b>✅ User Muted Successfully!</b>\n\nMuted User: ${userLabel(targetUser)}\nDuration: ${durationMin} minute(s)\nMuted by: ${userLabel(msg.from)}`,
          parse_mode: 'HTML',
          noReply: true
        });
      } else {
        await response.send(
          `<b>✅ User Muted Successfully!</b>\n\nMuted User: ${userLabel(targetUser)}\nDuration: ${durationMin} minute(s)\nMuted by: ${userLabel(msg.from)}`,
          { parse_mode: 'HTML', noReply: true }
        );
      }
    } catch (sendErr) {
      console.warn('mute: failed to send photo, sending text instead:', sendErr && sendErr.message ? sendErr.message : sendErr);
      await response.send(
        `<b>✅ User Muted Successfully!</b>\n\nMuted User: ${userLabel(targetUser)}\nDuration: ${durationMin} minute(s)\nMuted by: ${userLabel(msg.from)}`,
        { parse_mode: 'HTML', noReply: true }
      );
    }

    try { await response.delete(loading); } catch {}
    return;
  } catch (err) {
    console.warn('restrictChatMember failed — falling back to deletion enforcement:', err && (err.message || err));
    await response.editText(
      loading,
      `<b>⚠️ Couldn't apply an official mute (supergroup API failed).</b>\n\nFalling back to delete enforcement for ${userLabel(targetUser)} for ${durationMin} minute(s).\n\nMake sure the bot has permission to delete messages in this chat.`,
      { parse_mode: 'HTML' }
    );
    return;
  }
}

const registeredMuteBots = new WeakSet();
export function setupMuteHandler(bot) {
  if (!bot || typeof bot.on !== 'function' || registeredMuteBots.has(bot)) return;
  registeredMuteBots.add(bot);

  bot.on('message', async (msg) => {
    try {
      if (!msg?.from || !msg?.chat || msg.chat.id === undefined) return;
      const totalBots = Number.isInteger(bot.totalBots) && bot.totalBots > 0 ? bot.totalBots : 1;
      const botIndex = Number.isInteger(bot.index) ? bot.index : 0;
      const numericChatId = Number(msg.chat.id);
      if (
        msg.chat.type !== 'private' &&
        Number.isFinite(numericChatId) &&
        botIndex !== Math.abs(numericChatId) % totalBots
      ) return;

      const muteStore = getMuteStore();
      const muteKey = getMuteKey(msg.chat.id, msg.from.id);
      const muteInfo = muteStore.get(muteKey);
      if (!muteInfo) return;

      const now = Math.floor(Date.now() / 1000);

      if (muteInfo.until <= now) {
        muteStore.delete(muteKey);
        return;
      }

      try {
        await bot.deleteMessage(msg.chat.id, msg.message_id);
      } catch {}

      if (now - (muteInfo.lastNoticeAt || 0) >= 30) {
        muteInfo.lastNoticeAt = now;
        const remaining = Math.ceil((muteInfo.until - now) / 60);
        try {
          await bot.sendMessage(msg.chat.id,
            `<b>🔇 You are currently muted.</b>\n\nRemaining time: ${remaining} minute(s).`,
            { parse_mode: 'HTML', reply_to_message_id: msg.message_id }
          );
        } catch {}
      }
    } catch (e) {
      console.error('Error in setupMuteHandler message listener:', e && (e.message || e));
    }
  });
}
