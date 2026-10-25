import { getMessage } from '../../core/runtime/utilities.js';

export const meta = {
  name: "welcome",
  description: "Handles new members joining the group and sends welcome messages.",
  version: "1.0.0",
  author: "SIFAT"
};

export async function onStart({ bot, msg, chatId, response }) {
  const newMembers = msg.new_chat_members;

  try {
    if (!newMembers) return;

    const botInfo = await bot.getMe();
    const chatInfo = await bot.getChat(chatId);
    const title = chatInfo.title || "the group";

    const isBotAdded = newMembers.some(member => member.id === botInfo.id);

    if (isBotAdded) {
      const chatMember = await bot.getChatMember(chatId, botInfo.id);

      if (chatMember.status !== 'administrator') {
        await response.send(getMessage('bot_connected', {
          botName: botInfo.first_name,
          groupName: title
        }));
      }
      return;
    }

    for (const newMember of newMembers) {
      const memberName = `${newMember.first_name}${newMember.last_name ? ' ' + newMember.last_name : ''}`;
      const memberCount = await bot.getChatMemberCount(chatId);

      await response.send(getMessage('group_member_welcome', {
        memberName,
        groupName: title,
        memberCount
      }));
    }

  } catch (error) {
    console.log('Error in welcome handler:', error);
    await response.forDev(`Error in welcome handler:\n${error.message}`);
  }
}