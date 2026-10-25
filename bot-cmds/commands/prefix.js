import fs from "fs-extra";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  getUserAccessRole,
  hasAccessRole
} from "../../core/runtime/access.js";
import { getPrefixesForChat } from "../../core/runtime/prefix.js";
import { sendRotatingMedia } from "../../core/runtime/command-media.js";

export const meta = {
  name: "prefix",
  version: "1.2",
  aliases: [],
  description: "Show or change the bot's prefix.",
  author: "S1F4T",
  prefix: "both",
  category: "config",
  type: "anyone",
  cooldown: 2,
  guide: ["<new_prefix>", "<new_prefix> -g", "reset"]
};

const PREFIX_MEDIA_URLS = [
  "https://i.imgur.com/5a9DjQ6.gif",
  "https://i.imgur.com/LC948jn.gif"
];

const PREFIX_CONFIRM_TTL_MS = 2 * 60 * 1000;
const PREFIX_ERROR =
  "⚠️ Prefix must be exactly one non-letter, non-number, non-space character.\n\nExamples: <code>!</code>, <code>#</code>, <code>$</code>";

export async function onStart({ bot, chatId, msg, args = [], response }) {
  const actualChatId = chatId ?? msg?.chat?.id;
  const commandArgs = Array.isArray(args) ? args : [];

  if (!commandArgs.length) {
    return sendPrefixInfo(response, msg, actualChatId);
  }

  const firstArg = String(commandArgs[0] ?? "");
  if (firstArg.toLowerCase() === "reset" && commandArgs.length === 1) {
    try {
      await saveChatPrefix(actualChatId, null);
      const globalPrefix = getPrefixesForChat({ ...global.settings, chatPrefixes: {} }, actualChatId).join(" ");
      return response.reply(`✅ ᴘʀᴇꜰɪx ʀᴇꜱᴇᴛ ᴛᴏ ᴅᴇꜰᴀᴜʟᴛ: ${globalPrefix}`);
    } catch (error) {
      console.error("Failed to reset chat prefix:", error.message);
      return response.reply("⚠️ Failed to reset the chat prefix.");
    }
  }

  const newPrefix = firstArg;
  if (!isValidPrefix(newPrefix)) return response.reply(PREFIX_ERROR, { parse_mode: "HTML" });

  const isGlobalChange = String(commandArgs[1] ?? "").toLowerCase() === "-g";
  if (commandArgs.length !== (isGlobalChange ? 2 : 1)) {
    return response.reply(PREFIX_ERROR, { parse_mode: "HTML" });
  }

  if (isGlobalChange) {
    const userId = String(msg?.from?.id ?? "");
    const allowed = await canChangeGlobalPrefix({
      bot,
      userId,
      username: msg?.from?.username,
      chatId: actualChatId,
      chatType: msg?.chat?.type
    });
    if (!allowed) {
      return response.reply("❌ ᴏɴʟʏ ᴀᴅᴍɪɴ ᴄᴀɴ ᴄʜᴀɴɢᴇ ɢʟᴏʙᴀʟ ᴘʀᴇꜰɪx");
    }
    return askToConfirmGlobalPrefix({ response, msg, chatId: actualChatId, newPrefix });
  }

  try {
    await saveChatPrefix(actualChatId, newPrefix);
    return response.reply(
      `✅ ᴘʀᴇꜰɪx ᴄʜᴀɴɢᴇᴅ ᴛᴏ: ${newPrefix}\n\nᴜꜱᴇ ᴛʜɪꜱ ᴘʀᴇꜰɪx ꜰᴏʀ ᴄᴏᴍᴍᴀɴᴅꜱ ɴᴏᴡ.`
    );
  } catch (error) {
    console.error("Failed to save chat prefix:", error.message);
    return response.reply("⚠️ Failed to save the new prefix. The current setting was not changed.");
  }
}

export async function onChat({ response, msg, chatId }) {
  const text = String(msg?.text ?? msg?.caption ?? "").trim().toLowerCase();
  if (text !== "prefix") return true;
  await sendPrefixInfo(response, msg, chatId ?? msg?.chat?.id);
  return false;
}

export async function onCallback({ bot, callbackQuery, payload, response }) {
  const sessions = getSessions();
  const sessionId = payload?.id;
  const session = typeof sessionId === "string" ? sessions?.get(`prefix:${sessionId}`) : null;

  if (
    payload?.command !== "prefix" ||
    !session ||
    session.expiresAt <= Date.now() ||
    String(callbackQuery?.from?.id ?? "") !== session.authorId ||
    String(callbackQuery?.message?.chat?.id ?? "") !== String(session.chatId) ||
    callbackQuery?.message?.message_id !== session.messageId
  ) {
    sessions?.delete?.(`prefix:${sessionId}`);
    await bot.answerCallbackQuery(callbackQuery.id, {
      text: "This prefix confirmation has expired or is not yours.",
      show_alert: true
    });
    return;
  }

  if (payload.action === "global-cancel") {
    sessions.delete(`prefix:${sessionId}`);
    await response.editText(callbackQuery.message, "❌ Global prefix change cancelled.", {
      reply_markup: { inline_keyboard: [] }
    });
    await bot.answerCallbackQuery(callbackQuery.id, { text: "Cancelled." });
    return;
  }

  if (payload.action !== "global-confirm") {
    await bot.answerCallbackQuery(callbackQuery.id, { text: "Invalid prefix action.", show_alert: true });
    return;
  }

  const allowed = await canChangeGlobalPrefix({
    bot,
    userId: String(callbackQuery.from.id),
    username: callbackQuery.from.username,
    chatId: session.chatId,
    chatType: session.chatType
  });
  if (!allowed) {
    sessions.delete(`prefix:${sessionId}`);
    await response.editText(callbackQuery.message, "❌ Only an admin can change the global prefix.", {
      reply_markup: { inline_keyboard: [] }
    });
    await bot.answerCallbackQuery(callbackQuery.id, { text: "Admin access is required.", show_alert: true });
    return;
  }

  try {
    await saveGlobalPrefix(session.newPrefix);
    sessions.delete(`prefix:${sessionId}`);
    await response.editText(
      callbackQuery.message,
      `✅ ɢʟᴏʙᴀʟ ᴘʀᴇꜰɪx ᴄʜᴀɴɢᴇᴅ ᴛᴏ: ${session.newPrefix}`,
      { reply_markup: { inline_keyboard: [] } }
    );
    await bot.answerCallbackQuery(callbackQuery.id, { text: "Global prefix updated." });
  } catch (error) {
    console.error("Failed to save global prefix:", error.message);
    await bot.answerCallbackQuery(callbackQuery.id, {
      text: "Failed to save the global prefix.",
      show_alert: true
    });
  }
}

export async function onReaction({ bot, update }) {
  if (!Array.isArray(update?.new_reaction) || update.new_reaction.length === 0) return;
  if (update?.user?.id === undefined || update?.message_id === undefined || update?.chat?.id === undefined) return;

  const sessions = getSessions();
  if (!sessions) return;

  const entry = [...sessions.entries()].find(([, session]) =>
    session?.kind === "global-prefix-confirmation" &&
    session.expiresAt > Date.now() &&
    String(session.chatId) === String(update.chat.id) &&
    session.messageId === update.message_id &&
    session.authorId === String(update.user.id)
  );
  if (!entry) return;

  const [key, session] = entry;
  const allowed = await canChangeGlobalPrefix({
    bot,
    userId: String(update.user.id),
    username: update.user.username,
    chatId: session.chatId,
    chatType: session.chatType
  });
  if (!allowed) {
    sessions.delete(key);
    await bot.sendMessage(session.chatId, "❌ Only an admin can change the global prefix.", {
      reply_to_message_id: session.messageId
    });
    return;
  }

  try {
    await saveGlobalPrefix(session.newPrefix);
    sessions.delete(key);
    await bot.editMessageReplyMarkup(
      { inline_keyboard: [] },
      { chat_id: session.chatId, message_id: session.messageId }
    ).catch(() => {});
    await bot.sendMessage(
      session.chatId,
      `✅ ɢʟᴏʙᴀʟ ᴘʀᴇꜰɪx ᴄʜᴀɴɢᴇᴅ ᴛᴏ: ${session.newPrefix}`,
      { reply_to_message_id: session.messageId }
    );
  } catch (error) {
    console.error("Failed to confirm global prefix reaction:", error.message);
    await bot.sendMessage(session.chatId, "⚠️ Failed to save the global prefix.", {
      reply_to_message_id: session.messageId
    });
  }
}

async function sendPrefixInfo(response, msg, chatId) {
  const settings = global.settings ?? {};
  const globalPrefix = getPrefixesForChat({ ...settings, chatPrefixes: {} }, chatId).join(" ");
  const chatPrefix = getPrefixesForChat(settings, chatId).join(" ");
  const userName = ([
    msg?.from?.first_name,
    msg?.from?.last_name
  ].filter(Boolean).join(" ") || msg?.from?.username || "ᴜꜱᴇʀ")
    .replace(/[\r\n\t]/g, " ")
    .slice(0, 64);
  const botName = String(settings.nickNameBot || settings.botName || "Esha")
    .replace(/[\r\n\t]/g, " ")
    .slice(0, 64);
  const info =
    `〔 ʜᴇʏ ${userName} ᴅɪᴅ ʏᴏᴜ ᴀꜱᴋ ᴍʏ ᴘʀᴇꜰɪx ‽ 〕\n\n` +
    `┣ ɢʟᴏʙᴀʟ ᴘʀᴇꜰɪx : ${globalPrefix}\n` +
    `┣ ᴛʜɪꜱ ᴄʜᴀᴛ     : ${chatPrefix}\n` +
    `┣ ᴄᴍᴅ ᴍᴇɴᴜ      : ʜᴇʟᴘ\n` +
    `┣ ᴅᴇᴠ           : ꜱɪꜰᴜ ☠️\n\n` +
    `〔 ɪ'ᴍ ${botName} ᴀᴛ ʏᴏᴜʀ ꜱᴇʀᴠɪᴄᴇ 🌊 〕`;

  return sendRotatingMedia({
    response,
    urls: PREFIX_MEDIA_URLS,
    caption: info,
    method: "animation",
    key: "prefix"
  });
}

async function askToConfirmGlobalPrefix({ response, msg, chatId, newPrefix }) {
  const sessions = getSessions();
  if (!sessions) return response.reply("⚠️ Prefix confirmation is unavailable.");

  const sessionId = randomBytes(6).toString("hex");
  const prompt = await response.reply(
    `⚠️ ʀᴇᴀᴄᴛ ᴛᴏ ᴄᴏɴꜰɪʀᴍ ɢʟᴏʙᴀʟ ᴘʀᴇꜰɪx → ${newPrefix}`,
    {
      reply_markup: {
        inline_keyboard: [[
          {
            text: "✅",
            callback_data: JSON.stringify({
              command: "prefix",
              action: "global-confirm",
              id: sessionId
            })
          },
          {
            text: "❌",
            callback_data: JSON.stringify({
              command: "prefix",
              action: "global-cancel",
              id: sessionId
            })
          }
        ]]
      }
    }
  );

  const now = Date.now();
  for (const [key, session] of sessions) {
    if (String(key).startsWith("prefix:") && (!session?.expiresAt || session.expiresAt <= now)) {
      sessions.delete(key);
    }
  }
  sessions.set(`prefix:${sessionId}`, {
    kind: "global-prefix-confirmation",
    authorId: String(msg?.from?.id ?? ""),
    username: msg?.from?.username,
    chatId,
    chatType: msg?.chat?.type,
    messageId: prompt.message_id,
    newPrefix,
    expiresAt: now + PREFIX_CONFIRM_TTL_MS
  });

  return prompt;
}

async function canChangeGlobalPrefix({ bot, userId, username, chatId, chatType }) {
  let isTelegramGroupAdmin = false;
  if (
    userId &&
    chatId !== undefined &&
    ["group", "supergroup"].includes(chatType)
  ) {
    try {
      const member = await bot.getChatMember(chatId, userId);
      isTelegramGroupAdmin = ["administrator", "creator"].includes(member.status);
    } catch {}
  }

  const userRole = getUserAccessRole({
    userId,
    username,
    settings: global.settings,
    vip: global.vip,
    isTelegramGroupAdmin
  });
  return hasAccessRole(userRole, "admin");
}

async function saveChatPrefix(chatId, prefix) {
  if (chatId === undefined || chatId === null) {
    throw new Error("A chat ID is required.");
  }

  const settings = { ...(global.settings ?? {}) };
  const chatPrefixes = settings.chatPrefixes &&
    typeof settings.chatPrefixes === "object" &&
    !Array.isArray(settings.chatPrefixes)
    ? { ...settings.chatPrefixes }
    : {};

  if (prefix === null) delete chatPrefixes[String(chatId)];
  else chatPrefixes[String(chatId)] = prefix;

  if (Object.keys(chatPrefixes).length) settings.chatPrefixes = chatPrefixes;
  else delete settings.chatPrefixes;

  await persistSettings(settings);
}

async function saveGlobalPrefix(prefix) {
  await persistSettings({ ...(global.settings ?? {}), prefix });
}

async function persistSettings(settings) {
  if (!global.settingsPath) throw new Error("Settings file path is not configured.");

  const temporaryPath = `${global.settingsPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.ensureDir(path.dirname(global.settingsPath));
  try {
    await fs.writeFile(temporaryPath, JSON.stringify(settings, null, 2), "utf8");
    await fs.rename(temporaryPath, global.settingsPath);
    global.settings = settings;
  } catch (error) {
    await fs.remove(temporaryPath).catch(() => {});
    throw error;
  }
}

function getSessions() {
  const sessions = global.esha?.callbacks;
  return sessions instanceof Map ? sessions : null;
}

function isValidPrefix(value) {
  return typeof value === "string" &&
    Array.from(value).length === 1 &&
    !/^[A-Za-z0-9\s]$/u.test(value);
}
