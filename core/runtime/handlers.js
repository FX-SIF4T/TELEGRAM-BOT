import moment from 'moment-timezone';
import chalk from 'chalk';
import { R } from './bot.js';
import {
  canAccessCommand,
  getRequiredAccessRole,
  getUserAccessRole,
  hasBotUsageAccess,
  isTelegramGroupAdmin,
  isConfiguredBotAdmin,
  isConfiguredBotDeveloper,
  isAnonymousGroupSender
} from './access.js';
import { chargeCommand, refundCommandFee } from './storage.js';
import {
  canUseBareCommand,
  getPrefixesForChat,
  normalizeNoPrefixMode
} from './prefix.js';

const getCommandNames = (command) => {
  const meta = command?.meta ?? {};
  const aliases = Array.isArray(meta.aliases) ? meta.aliases : [];
  return [meta.name, ...aliases]
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.trim().toLowerCase());
};

async function getCommandAccessError({
  bot,
  userId,
  username,
  chatId,
  chatType,
  senderChat,
  meta,
  settings
}) {
  const senderId = String(userId);
  const hasUsageAccess = await hasBotUsageAccess({
    bot,
    userId: senderId,
    username,
    chatId,
    chatType,
    senderChat,
    settings
  });
  if (!hasUsageAccess) {
    if (settings.devOnly === true) {
      return 'The bot is in developer-only mode. Only configured developers can use it.';
    }
    return 'The bot is in admin-only mode. Only developers, bot admins, and Telegram group admins can use it.';
  }

  const isOwner = isConfiguredBotDeveloper(senderId, username, settings);
  const isBotAdmin = isConfiguredBotAdmin(senderId, settings);
  const requiredRole = getRequiredAccessRole(meta);
  let telegramGroupAdmin = false;

  if (
    requiredRole === 'admin' &&
    !isOwner &&
    !isBotAdmin &&
    ['group', 'supergroup'].includes(chatType)
  ) {
    telegramGroupAdmin = await isTelegramGroupAdmin(bot, chatId, senderId);
    if (!telegramGroupAdmin) {
      return 'Unable to verify your administrator status. Please try again later.';
    }
  }

  const userRole = getUserAccessRole({
    userId: senderId,
    username,
    settings,
    vip: global.vip,
    isTelegramGroupAdmin: telegramGroupAdmin
  });

  if (!canAccessCommand(userRole, meta)) {
    if (requiredRole === 'developer') {
      if (isAnonymousGroupSender({ senderChat, chatType })) {
        return `Telegram hides your personal account when you send as a group or anonymously. Send "${meta.name}" from your personal Telegram account so I can verify your developer ID or username.`;
      }
      return `Only bot developers can use the "${meta.name}" command. If this is your account, make sure your Telegram ID or username is listed in the developer settings.`;
    }
    if (requiredRole === 'admin') {
      return `Only bot admins or Telegram group admins can use the "${meta.name}" command.`;
    }
    if (requiredRole === 'premiumuser') {
      return `You need Premium access to use the "${meta.name}" command.`;
    }
  }

  if (!isOwner) {
    if (
      meta.type === 'administrator' &&
      !['group', 'supergroup'].includes(chatType)
    ) {
      return `The "${meta.name}" command can only be used in a group or supergroup by an administrator.`;
    }
    if (
      meta.type === 'group' &&
      !['group', 'supergroup'].includes(chatType)
    ) {
      return `The "${meta.name}" command can only be used in a group or supergroup.`;
    }
    if (meta.type === 'private' && chatType !== 'private') {
      return `The "${meta.name}" command can only be used in private chats.`;
    }
  }

  return null;
}

const parseCallbackPayload = (data) => {
  if (typeof data !== 'string' || !data.trim()) return null;

  try {
    const payload = JSON.parse(data);
    return payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload
      : null;
  } catch {
    const [command, ...args] = data.split(':');
    return command ? { command, args } : null;
  }
};

const createCallbackBot = (bot, onAnswered) => new Proxy(bot, {
  get(target, property) {
    if (property === 'answerCallbackQuery') {
      return async (...args) => {
        const result = await target.answerCallbackQuery(...args);
        onAnswered();
        return result;
      };
    }

    const value = Reflect.get(target, property, target);
    return typeof value === 'function' ? value.bind(target) : value;
  }
});

export function callback({ bot }) {
  if (!bot || typeof bot.on !== 'function') {
    throw new TypeError('A Telegram bot instance is required for callback handling.');
  }

  if (bot._callbackHandler) {
    bot.removeListener('callback_query', bot._callbackHandler);
  }

  bot._callbackHandler = async (query) => {
    if (!query?.id) {
      console.warn('Invalid callback query received.');
      return;
    }

    let answered = false;
    const answer = async (options = {}) => {
      if (answered) return;
      try {
        await bot.answerCallbackQuery(query.id, options);
        answered = true;
      } catch (error) {
        console.error('Failed to answer callback query:', error?.message || error);
      }
    };

    if (query.game_short_name) {
      await answer({ text: 'Games are not supported.', show_alert: true });
      return;
    }

    const payload = parseCallbackPayload(query.data);
    if (typeof payload?.command !== 'string' || !payload.command.trim()) {
      await answer({ text: 'Invalid callback format.', show_alert: true });
      return;
    }

    const commands = global.esha?.commands;
    if (!(commands instanceof Map)) {
      await answer({ text: 'Commands are not initialized.', show_alert: true });
      return;
    }

    const requestedName = payload.command.trim().toLowerCase();
    let selectedCommand = commands.get(requestedName);
    if (!selectedCommand) {
      selectedCommand = [...commands.values()].find((entry) =>
        getCommandNames(entry).includes(requestedName)
      );
    }

    if (typeof selectedCommand?.onCallback !== 'function') {
      await answer({ text: 'Command not found.', show_alert: true });
      return;
    }

    const message = query.message;
    if (!message?.chat?.id) {
      await answer({ text: 'Inline callbacks are not supported.', show_alert: true });
      return;
    }

    const accessError = await getCommandAccessError({
      bot,
      userId: query.from.id,
      username: query.from.username,
      chatId: message.chat.id,
      chatType: message.chat.type,
      senderChat: message.sender_chat,
      meta: selectedCommand.meta ?? {},
      settings: global.settings ?? {}
    });
    if (accessError) {
      await answer({ text: accessError, show_alert: true });
      return;
    }

    const response = new R(bot, message);
    const callbackBot = createCallbackBot(bot, () => {
      answered = true;
    });

    try {
      await selectedCommand.onCallback({
        bot: callbackBot,
        callbackQuery: query,
        chatId: message.chat.id,
        messageId: message.message_id ?? null,
        inlineMessageId: query.inline_message_id ?? null,
        args: Array.isArray(payload.args) ? payload.args : [],
        payload,
        response
      });
      await answer();
    } catch (error) {
      console.error(`Error executing callback for "${requestedName}":`, error);
      await answer({
        text: 'An error occurred. Please try again.',
        show_alert: true
      });
    }
  };

  bot.on('callback_query', bot._callbackHandler);
}

export async function chat({ bot, response, msg, chatId }) {
  const commands = global.esha?.commands;
  if (!(commands instanceof Map)) return;

  const text = typeof msg?.text === 'string'
    ? msg.text
    : typeof msg?.caption === 'string'
      ? msg.caption
      : '';
  const args = text.trim() ? text.trim().split(/\s+/) : [];

  for (const [commandName, command] of commands.entries()) {
    if (typeof command?.onChat !== 'function') continue;

    try {
      const shouldContinue = await command.onChat({
        bot,
        response,
        msg,
        chatId,
        args
      });
      if (shouldContinue === false) return false;
    } catch (error) {
      console.error(`Error executing onChat for "${commandName}":`, error);
    }
  }
  return true;
}

export async function command({ bot, response, msg, chatId }) {
  const text = typeof msg?.text === 'string'
    ? msg.text
    : typeof msg?.caption === 'string'
      ? msg.caption
      : '';
  if (!text.trim() || !msg?.from?.id) return;

  const settings = global.settings ?? {};
  const prefixes = getPrefixesForChat(settings, chatId);
  const matchedPrefix = prefixes.find((prefix) =>
    text.toLowerCase().startsWith(prefix.toLowerCase())
  );
  const prefixUsed = Boolean(matchedPrefix);
  const commandText = prefixUsed
    ? text.slice(matchedPrefix.length).trim()
    : text.trim();

  if (!commandText) {
    if (prefixUsed) return response.reply('Please enter a command after the prefix.');
    return;
  }

  const commandArgs = commandText.split(/\s+/);
  const rawCommandName = commandArgs.shift().toLowerCase();
  const [commandName, mentionedUsername] = rawCommandName.split('@', 2);

  if (mentionedUsername !== undefined) {
    try {
      const botUsername = (await bot.getMe())?.username;
      if (!botUsername || mentionedUsername.toLowerCase() !== botUsername.toLowerCase()) {
        return;
      }
    } catch (error) {
      console.error(chalk.red(`Failed to get bot username: ${error.message}`));
      return;
    }
  }

  const commands = global.esha?.commands;
  if (!(commands instanceof Map)) return;

  let selectedCommand = commands.get(commandName);
  if (!selectedCommand) {
    selectedCommand = [...commands.values()].find((entry) =>
      getCommandNames(entry).includes(commandName)
    );
  }

  if (!selectedCommand) {
    if (prefixUsed) {
      return response.reply(`The command "${commandName}" is not found in my system.`);
    }
    return;
  }

  const meta = selectedCommand.meta ?? {};
  const commandPrefixMode = meta.prefix ?? true;
  const effectivePrefix = matchedPrefix ?? prefixes[0];
  const noPrefixMode = normalizeNoPrefixMode(settings.noPrefix);

  if (commandPrefixMode === false && prefixUsed) {
    return response.reply(
      `The command "${meta.name}" does not require a prefix. Please invoke it without the prefix.`
    );
  }
  let isNoPrefixAdmin = false;
  if (!prefixUsed && noPrefixMode === 'adminOnly') {
    const noPrefixAccessError = await getCommandAccessError({
      bot,
      userId: msg.from.id,
      username: msg.from.username,
      chatId,
      chatType: msg.chat?.type,
      senderChat: msg.sender_chat,
      meta: { name: meta.name, role: 'admin' },
      settings
    });
    if (noPrefixAccessError) {
      return response.reply('No-prefix commands are limited to bot admins and group admins.');
    }
    isNoPrefixAdmin = true;
  }
  if (!prefixUsed && !canUseBareCommand({
    mode: noPrefixMode,
    commandPrefix: meta.prefix,
    isAdmin: isNoPrefixAdmin
  })) {
    return response.reply(
      `The command "${meta.name}" requires a prefix. Please use "${effectivePrefix}" before the command name.`
    );
  }

  const usages = () => {
    if (!meta.guide) return;

    const guides = Array.isArray(meta.guide) ? meta.guide : [meta.guide];
    const displayPrefix = commandPrefixMode === false ? '' : effectivePrefix;
    const usageText = [
      `${settings.symbols ?? 'ℹ️'} Usages:`,
      '',
      ...guides.map((guide) => `${displayPrefix}${meta.name} ${guide}`),
      meta.description ? `\n- ${meta.description}` : ''
    ].filter(Boolean).join('\n');

    return response.reply(usageText, { parse_mode: 'Markdown' });
  };

  const senderId = String(msg.from.id);
  const senderUsername = msg.from.username;
  const isOwner = isConfiguredBotDeveloper(senderId, senderUsername, settings);
  const chatType = msg.chat?.type;
  const accessError = await getCommandAccessError({
    bot,
    userId: senderId,
    username: senderUsername,
    chatId,
    chatType,
    senderChat: msg.sender_chat,
    meta,
    settings
  });
  if (accessError) return response.reply(accessError);

  if (!global.esha.cooldowns || !(global.esha.cooldowns instanceof Map)) {
    global.esha.cooldowns = new Map();
  }
  const cooldownSeconds = Number.isFinite(Number(meta.cooldown))
    ? Math.max(0, Number(meta.cooldown))
    : 1;
  const now = Date.now();

  if (!isOwner && cooldownSeconds > 0) {
    if (!global.esha.cooldowns.has(meta.name)) {
      global.esha.cooldowns.set(meta.name, new Map());
    }

    const timestamps = global.esha.cooldowns.get(meta.name);
    const previousTime = timestamps.get(senderId);
    const cooldownMs = cooldownSeconds * 1000;

    if (previousTime !== undefined && now < previousTime + cooldownMs) {
      const timeLeft = Math.ceil((previousTime + cooldownMs - now) / 1000);
      return response.reply(
        `😼 Please wait ${timeLeft} seconds before using "${commandName}" again.`
      );
    }

    timestamps.set(senderId, now);
  }

  const time = moment().tz(settings.timeZone || 'UTC').format('HH:mm:ss DD/MM/YYYY');
  const rawFee = settings.commandMoney?.[meta.name] ?? settings.commandMoney?.[commandName] ?? 0;
  const commandFee = Number(rawFee);
  if (!Number.isSafeInteger(commandFee) || commandFee < 0) {
    console.error(`Invalid commandMoney value configured for "${meta.name}".`);
    return response.reply(`The fee for "${meta.name}" is configured incorrectly.`);
  }

  let feeCharged = false;
  try {
    if (commandFee > 0) {
      const feeResult = await chargeCommand(
        senderId,
        commandFee,
        settings.feeCollectorUID,
        meta.name
      );
      if (!feeResult.ok) {
        const balance = Number.isFinite(feeResult.balance) ? feeResult.balance : 0;
        return response.reply(
          `Not enough credits to use "${meta.name}". Fee: ${commandFee}; balance: ${balance}.`
        );
      }
      feeCharged = true;
    }

    await selectedCommand.onStart({
      bot,
      response,
      msg,
      chatId,
      args: commandArgs,
      type: isOwner ? 'dev' : 'anyone',
      userId: msg.from.id,
      usages
    });

    if (settings.devMode === true) {
      const executionTime = Date.now() - now;
      const consoleWidth = process.stdout.columns || 80;
      const separator = chalk.gray('─'.repeat(consoleWidth));
      const logMessage = [
        separator,
        chalk.bold.blue('[ DEVELOPMENT MODE ]'),
        `${chalk.bold.blue('Command:')}         ${commandName}`,
        `${chalk.bold.blue('Timestamp:')}       ${time}`,
        `${chalk.bold.blue('Sender ID:')}       ${senderId}`,
        `${chalk.bold.blue('Arguments:')}       ${commandArgs.join(' ') || 'None'}`,
        `${chalk.bold.blue('Execution Time:')}  ${executionTime}ms`,
        separator
      ].join('\n');
      console.log(logMessage);
    }
  } catch (error) {
    if (feeCharged) {
      try {
        await refundCommandFee(senderId, commandFee, settings.feeCollectorUID, meta.name);
      } catch (refundError) {
        console.error(`Failed to refund ${commandFee} credits after "${meta.name}" failed:`, refundError);
      }
    }
    console.error(
      chalk.red(`[ERROR] ${time} - Error executing command "${commandName}": ${error.message}\n${error.stack}`)
    );
    return response.reply(`Error executing command "${commandName}": ${error.message}`);
  }
}

export async function event({ bot, msg, chatId, response }) {
  const events = global.esha?.events;
  if (!(events instanceof Map)) return;

  for (const { meta, onStart } of events.values()) {
    if (typeof onStart !== 'function') continue;

    try {
      await onStart({ bot, msg, chatId, response });
    } catch (error) {
      console.error(`Error executing event "${meta?.name ?? 'unknown'}":`, error);
    }
  }
}

export async function reply({ bot, response, msg, chatId }) {
  const { replies, commands } = global.esha ?? {};
  const repliedMessageId = msg?.reply_to_message?.message_id;
  if (repliedMessageId === undefined || !(replies instanceof Map) || !(commands instanceof Map)) {
    return;
  }

  const replyData = replies.get(repliedMessageId);
  if (!replyData) return;

  const { meta, ...data } = replyData;
  const commandName = meta?.name;
  if (!commandName) {
    return response.reply('Cannot find command name to execute this reply.');
  }

  const selectedCommand = commands.get(commandName);
  if (!selectedCommand) {
    return response.reply(`Cannot find command: ${commandName}`);
  }
  if (typeof selectedCommand.onReply !== 'function') {
    return response.reply(`Command ${commandName} doesn't support replies`);
  }

  const text = typeof msg.text === 'string' ? msg.text.trim() : '';

  try {
    await selectedCommand.onReply({
      bot,
      response,
      msg,
      chatId,
      userId: msg.from?.id,
      args: text ? text.split(/\s+/) : [],
      data,
      commandName,
      replyMsg: msg.reply_to_message
    });
  } catch (error) {
    await response.reply(`An error occurred while processing your reply: ${error.message}`);
  }
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const keywordMatches = (text, keyword) => {
  const value = String(keyword ?? '').trim();
  if (!value) return false;
  const pattern = new RegExp(
    `(^|[^\\p{L}\\p{N}_])${escapeRegExp(value)}(?=$|[^\\p{L}\\p{N}_])`,
    'iu'
  );
  return pattern.test(text);
};

export async function word({ bot, response, msg, chatId }) {
  if (typeof msg?.text !== 'string') return;

  const text = msg.text.trim();
  if (!text) return;

  const prefixes = getPrefixesForChat(global.settings, chatId);
  if (prefixes.some((prefix) => text.toLowerCase().startsWith(prefix.toLowerCase()))) {
    return;
  }

  const commands = global.esha?.commands;
  if (!(commands instanceof Map)) return;

  const firstToken = text.split(/\s+/, 1)[0].toLowerCase();
  for (const command of commands.values()) {
    const prefixMode = command.meta?.prefix;
    if (prefixMode !== false && prefixMode !== 'both') continue;
    if (getCommandNames(command).includes(firstToken)) return;
  }

  const args = text.split(/\s+/);
  for (const command of commands.values()) {
    if (typeof command.onWord !== 'function') continue;

    const keywords = Array.isArray(command.meta?.keyword)
      ? command.meta.keyword
      : [command.meta?.keyword];
    if (!keywords.some((keyword) => keywordMatches(text, keyword))) continue;

    try {
      await command.onWord({ bot, response, msg, chatId, args });
    } catch (error) {
      console.error(`Error executing onWord for "${command.meta?.name ?? 'unknown'}":`, error);
    }
  }
}
