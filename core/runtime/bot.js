import TelegramBot from 'node-telegram-bot-api';
import { getMessage } from './utilities.js';

export class R {
  constructor(bot, msg) {
    if (!bot) {
      throw new TypeError('A Telegram bot instance is required.');
    }
    if (!msg?.chat || msg.chat.id === undefined || msg.chat.id === null) {
      throw new TypeError('A Telegram message with a chat ID is required.');
    }

    this.bot = bot;
    this.msg = msg;
    this.chatId = msg.chat.id;
  }

  _getOptions(options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('Message options must be an object.');
    }

    const finalOptions = { ...options };
    if (
      this.msg.chat.type !== 'private' &&
      !finalOptions.noReply &&
      !('reply_to_message_id' in finalOptions)
    ) {
      finalOptions.reply_to_message_id = this.msg.message_id;
    }
    delete finalOptions.noReply;
    return finalOptions;
  }

  _resolveTarget(target) {
    let chatId = this.chatId;
    let messageId;

    if (Number.isInteger(target)) {
      messageId = target;
    } else if (target && typeof target === 'object') {
      const rawMessageId = target.message_id ?? target.messageId;
      messageId = Number.isInteger(rawMessageId)
        ? rawMessageId
        : typeof rawMessageId === 'string' && /^-?\d+$/.test(rawMessageId)
          ? Number(rawMessageId)
          : undefined;
      chatId = target.chat?.id ?? target.chat_id ?? target.chatId ?? this.chatId;
    }

    if (!Number.isInteger(messageId) || chatId === undefined || chatId === null) {
      throw new TypeError('A valid message ID is required for this operation.');
    }

    return { chat_id: chatId, message_id: messageId };
  }

  send(text, options = {}) {
    return this.bot.sendMessage(this.chatId, text, options);
  }

  reply(text, options = {}) {
    return this.bot.sendMessage(this.chatId, text, this._getOptions(options));
  }

  photo(photo, options = {}) {
    return this.bot.sendPhoto(this.chatId, photo, this._getOptions(options));
  }

  audio(audio, options = {}) {
    return this.bot.sendAudio(this.chatId, audio, this._getOptions(options));
  }

  document(document, options = {}) {
    return this.bot.sendDocument(this.chatId, document, this._getOptions(options));
  }

  sticker(sticker, options = {}) {
    return this.bot.sendSticker(this.chatId, sticker, this._getOptions(options));
  }

  video(video, options = {}) {
    return this.bot.sendVideo(this.chatId, video, this._getOptions(options));
  }

  animation(animation, options = {}) {
    return this.bot.sendAnimation(this.chatId, animation, this._getOptions(options));
  }

  voice(voice, options = {}) {
    return this.bot.sendVoice(this.chatId, voice, this._getOptions(options));
  }

  videoNote(videoNote, options = {}) {
    return this.bot.sendVideoNote(this.chatId, videoNote, this._getOptions(options));
  }

  mediaGroup(media, options = {}) {
    return this.bot.sendMediaGroup(this.chatId, media, this._getOptions(options));
  }

  location(latitude, longitude, options = {}) {
    return this.bot.sendLocation(this.chatId, latitude, longitude, this._getOptions(options));
  }

  venue(latitude, longitude, title, address, options = {}) {
    return this.bot.sendVenue(
      this.chatId,
      latitude,
      longitude,
      title,
      address,
      this._getOptions(options)
    );
  }

  contact(phoneNumber, firstName, options = {}) {
    return this.bot.sendContact(
      this.chatId,
      phoneNumber,
      firstName,
      this._getOptions(options)
    );
  }

  poll(question, pollOptions, options = {}) {
    return this.bot.sendPoll(
      this.chatId,
      question,
      pollOptions,
      this._getOptions(options)
    );
  }

  dice(options = {}) {
    return this.bot.sendDice(this.chatId, this._getOptions(options));
  }

  editText(target, text, options = {}) {
    return this.bot.editMessageText(text, {
      ...options,
      ...this._resolveTarget(target)
    });
  }

  editCaption(target, caption, options = {}) {
    return this.bot.editMessageCaption(caption, {
      ...options,
      ...this._resolveTarget(target)
    });
  }

  editMedia(target, media, options = {}) {
    return this.bot.editMessageMedia(media, {
      ...options,
      ...this._resolveTarget(target)
    });
  }

  editMarkup(target, replyMarkup) {
    return this.bot.editMessageReplyMarkup(replyMarkup, this._resolveTarget(target));
  }

  delete(target) {
    const { chat_id: chatId, message_id: messageId } = this._resolveTarget(target);
    return this.bot.deleteMessage(chatId, messageId);
  }

  action(action = 'typing') {
    return this.bot.sendChatAction(this.chatId, action);
  }

  async forDev(text, options = {}) {
    const ownerIds = Array.isArray(global.settings?.devID)
      ? [...new Set(global.settings.devID.map(String).filter(Boolean))]
      : [];

    return Promise.allSettled(
      ownerIds.map((ownerId) => this.bot.sendMessage(ownerId, text, options))
    );
  }
}

export const Message = R;

export const login = async (log, registerListeners) => {
  if (typeof registerListeners !== 'function') {
    throw new TypeError('A bot listener registration function is required.');
  }

  const configuredTokens = global.states?.tokens;
  const tokens = Array.isArray(configuredTokens)
    ? [...new Set(configuredTokens
        .filter((token) => typeof token === 'string' && token.trim())
        .map((token) => token.trim()))]
    : [];
  const tokenEnv = global.settings?.bots?.tokenEnv || 'TELEGRAM_BOT_TOKEN';
  const environmentToken = process.env[tokenEnv]?.trim();
  if (!tokens.length && environmentToken) tokens.push(environmentToken);

  if (!tokens.length) {
    throw new Error(
      `No valid Telegram bot tokens found in settings.json bots.tokens or the ${tokenEnv} secret.`
    );
  }

  const timeZone = global.settings?.timeZone || 'UTC';
  const devIds = Array.isArray(global.settings?.devID)
    ? [...new Set(global.settings.devID.map(String).filter(Boolean))]
    : [];
  global.settings.devID = devIds;

  const startTime = new Date().toLocaleString('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  const allowedUpdates = [
    'message',
    'edited_message',
    'channel_post',
    'edited_channel_post',
    'inline_query',
    'chosen_inline_result',
    'callback_query',
    'shipping_query',
    'pre_checkout_query',
    'poll',
    'poll_answer',
    'my_chat_member',
    'chat_member',
    'chat_join_request',
    'message_reaction',
    'message_reaction_count'
  ];
  const bots = tokens.map((token, index) => {
    const bot = new TelegramBot(token, { polling: false });
    bot.options.polling = { params: { allowed_updates: allowedUpdates } };
    bot.on('polling_error', (error) => {
      const statusCode = error?.response?.statusCode;
      const errorCode = typeof error?.code === 'string' && /^[A-Z0-9_-]{1,32}$/.test(error.code)
        ? error.code
        : null;
      const detail = Number.isInteger(statusCode) ? `HTTP ${statusCode}` : errorCode ?? 'unknown';
      console.error(`Telegram polling error: ${detail}`);
    });
    bot.index = index;
    bot.totalBots = tokens.length;
    return bot;
  });

  try {
    await Promise.all(bots.map((bot) => registerListeners(bot, log)));
    await Promise.all(bots.map((bot) => bot.startPolling()));
  } catch (error) {
    await Promise.allSettled(
      bots.map((bot) => Promise.resolve().then(() => bot.stopPolling()))
    );
    throw error;
  }

  if (devIds.length) {
    const dmText = getMessage('startup_complete', {
      instances: bots.length,
      time: startTime,
      timezone: timeZone
    });
    const results = await Promise.allSettled(
      devIds.map((devId) => bots[0].sendMessage(devId, dmText, { parse_mode: 'Markdown' }))
    );
    const failedNotifications = results.filter((result) => result.status === 'rejected').length;

    if (failedNotifications) {
      const message = `Could not notify ${failedNotifications} configured developer account(s).`;
      if (typeof log?.error === 'function') {
        log.error(message);
      } else {
        console.warn(message);
      }
    }
  }

  return bots;
};
