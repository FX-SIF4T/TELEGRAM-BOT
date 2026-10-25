import { R } from './runtime/bot.js';
import { callback, chat, command, event, reply, word } from './runtime/handlers.js';
import { getMessage } from './runtime/utilities.js';
import { shouldUnsendForReaction } from './runtime/reaction.js';
import { hasBotUsageAccess } from './runtime/access.js';
import { getPrefixesForChat } from './runtime/prefix.js';
import { setupMuteHandler } from '../bot-cmds/commands/mute.js';

export async function listen(bot, log) {
  if (!bot || typeof bot.on !== 'function') {
    throw new TypeError('A Telegram bot instance is required.');
  }

  callback({ bot, log });

  if (bot._messageHandler) {
    bot.removeListener('message', bot._messageHandler);
  }
  if (bot._reactionHandler) {
    bot.removeListener('message_reaction', bot._reactionHandler);
  }

  bot._messageHandler = async (msg) => {
    try {
      if (!msg?.chat || msg.chat.id === undefined || msg.chat.id === null) return;

      const chatId = msg.chat.id;
      const userId = msg.from?.id;
      const response = new R(bot, msg);
      const context = { bot, msg, chatId, userId, response };

      if (msg.chat.type !== 'private') {
        const numericChatId = Number(chatId);
        if (Number.isFinite(numericChatId)) {
          const totalBots = Number.isInteger(bot.totalBots) && bot.totalBots > 0
            ? bot.totalBots
            : 1;
          const botIndex = Number.isInteger(bot.index) ? bot.index : 0;
          if (botIndex !== Math.abs(numericChatId) % totalBots) return;
        }
      }

      const text = typeof msg.text === 'string'
        ? msg.text.trim()
        : typeof msg.caption === 'string'
          ? msg.caption.trim()
          : '';

      if (userId !== undefined && userId !== null) {
        const prefixes = getPrefixesForChat(global.settings, chatId);
        const firstWord = text.split(/\s+/, 1)[0];
        const startsWithPrefix = prefixes.some((prefix) =>
          text.toLowerCase().startsWith(prefix.toLowerCase())
        );
        const isCommand = checkIfCommand(firstWord, prefixes);
        const hasUsageAccess = await hasBotUsageAccess({
          bot,
          userId,
          username: msg.from?.username,
          chatId,
          chatType: msg.chat.type,
          senderChat: msg.sender_chat,
          settings: global.settings ?? {},
          vip: global.vip ?? {}
        });
        if (!hasUsageAccess) {
          if (isCommand || startsWithPrefix) {
            const message = global.settings?.devOnly === true
              ? getMessage('maintenance_mode')
              : 'The bot is in admin-only mode. Only developers, bot admins, and Telegram group admins can use it.';
            await response.reply(message, { parse_mode: 'Markdown' });
          }
          return;
        }

        await event(context);

        if (isCommand || startsWithPrefix) {
          if (!startsWithPrefix && await chat(context) === false) return;
          await command(context);
          return;
        }
      } else {
        await event(context);
      }

      if (await chat(context) === false) return;
      await reply(context);
      await word(context);
    } catch (error) {
      console.error('Error in message handler:', error);
    }
  };

  bot.on('message', bot._messageHandler);
  setupMuteHandler(bot);

  bot._reactionHandler = async (update) => {
    const prefixCommand = global.esha?.commands?.get('prefix');
    if (typeof prefixCommand?.onReaction === 'function') {
      try {
        await prefixCommand.onReaction({ bot, update });
      } catch (error) {
        console.error('Error processing prefix confirmation reaction:', error.message);
      }
    }

    const config = global.settings?.reactionUnsend;
    if (!shouldUnsendForReaction(config, update)) return;

    if (config.adminOnly !== false) {
      const userId = update.user?.id;
      if (userId === undefined || userId === null) return;
      try {
        const member = await bot.getChatMember(update.chat.id, userId);
        if (!['administrator', 'creator'].includes(member.status)) return;
      } catch (error) {
        console.warn('Could not verify reaction administrator:', error.message);
        return;
      }
    }

    try {
      await bot.deleteMessage(update.chat.id, update.message_id);
    } catch (error) {
      console.warn('Could not delete reacted message:', error.message);
    }
  };
  bot.on('message_reaction', bot._reactionHandler);
}

function checkIfCommand(firstWord, prefixes) {
  const commands = global.esha?.commands;
  if (!(commands instanceof Map) || commands.size === 0) return false;

  const cleanWord = String(firstWord ?? '').split('@')[0].toLowerCase();
  const candidates = new Set([cleanWord]);

  for (const prefix of prefixes) {
    const normalizedPrefix = prefix.toLowerCase();
    if (cleanWord.startsWith(normalizedPrefix)) {
      candidates.add(cleanWord.slice(normalizedPrefix.length));
    }
  }

  for (const [commandName, entry] of commands) {
    const aliases = Array.isArray(entry.meta?.aliases) ? entry.meta.aliases : [];
    const names = [entry.meta?.name ?? commandName, ...aliases]
      .filter((name) => typeof name === 'string')
      .map((name) => name.toLowerCase());
    if (names.some((name) => candidates.has(name))) return true;
  }

  return false;
}
