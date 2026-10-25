import { getMuteKey, getMuteStore } from './mute.js';

export const meta = {
  name: 'unmute',
  version: '1.0.1',
  aliases: [],
  description: 'Remove mute restriction for a user (reply to the user). Works on supergroups (official) or falls back to delete-enforcement cleanup in legacy groups.',
  author: 'SIFAT',
  prefix: 'both',
  category: 'group',
  type: 'administrator',
  cooldown: 2,
  guide: [
    'Reply to a user with: unmute',
    'Removes mute whether it was applied via API (supergroup) or fallback deletion enforcement.'
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

export async function onStart({ bot, msg, args, response, usages }) {
  if (!msg.reply_to_message || !msg.reply_to_message.from) {
    return usages();
  }

  const targetUser = msg.reply_to_message.from;
  const targetUserId = targetUser.id;
  const chatId = msg.chat.id;
  const chatType = msg.chat.type;

  if (!['group', 'supergroup'].includes(chatType)) {
    return response.reply('❌ Unmute can only be used in a group or supergroup.');
  }

  const loading = await response.reply(`🔊 Unmuting ${userLabel(targetUser)}...`, { parse_mode: 'HTML' });

  getMuteStore().delete(getMuteKey(chatId, targetUserId));

  if (chatType === 'group') {
    await response.editText(
      loading,
      `<b>✅ Unmuted</b>\n\nUser: ${userLabel(targetUser)}\nThe bot will no longer enforce a fallback mute for this user in this group.`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  try {
    await bot.restrictChatMember(chatId, targetUserId, {
      can_send_messages: true,
      can_send_media_messages: true,
      can_send_polls: true,
      can_send_other_messages: true,
      can_add_web_page_previews: true
    });

    try {
      const userPhotos = await bot.getUserProfilePhotos(targetUserId).catch(() => null);
      if (userPhotos && userPhotos.total_count && userPhotos.photos && userPhotos.photos.length) {
        const fileId = userPhotos.photos[0][userPhotos.photos[0].length - 1].file_id;
        await response.photo(fileId, {
          caption: `<b>✅ User Unmuted Successfully!</b>\n\nUnmuted User: ${userLabel(targetUser)}\nUnmuted by: ${userLabel(msg.from)}`,
          parse_mode: 'HTML',
          noReply: true
        });
      } else {
        await response.send(
          `<b>✅ User Unmuted Successfully!</b>\n\nUnmuted User: ${userLabel(targetUser)}\nUnmuted by: ${userLabel(msg.from)}`,
          { parse_mode: 'HTML', noReply: true }
        );
      }
    } catch (sendErr) {
      console.warn('unmute: failed to send photo, sending text instead:', sendErr && sendErr.message ? sendErr.message : sendErr);
      await response.send(
        `<b>✅ User Unmuted Successfully!</b>\n\nUnmuted User: ${userLabel(targetUser)}\nUnmuted by: ${userLabel(msg.from)}`,
        { parse_mode: 'HTML', noReply: true }
      );
    }

    try {
      await bot.sendMessage(chatId,
        `<b>🔊 Good news!</b>\n\n${userLabel(targetUser)}, you have been unmuted and can now send messages in the group.`,
        { parse_mode: 'HTML', reply_to_message_id: msg.reply_to_message.message_id }
      );
    } catch (notifErr) {
    }

    try { await response.delete(loading); } catch {}
    return;
  } catch (err) {
    console.warn('restrictChatMember (unmute) failed — cleaned up fallback store:', err && (err.message || err));
    await response.editText(
      loading,
      `<b>✅ Unmuted (best-effort)</b>\n\nUser: @${safe(targetUser.username || targetUser.first_name)}\nNote: Could not update official permissions via API. If the user still cannot send messages, please check the group type/permissions and try again.`,
      { parse_mode: 'HTML' }
    );
    return;
  }
}
