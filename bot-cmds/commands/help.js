import {
  canAccessCommand,
  getUserAccessRole
} from "../../core/runtime/access.js";
import { getPrefixesForChat } from "../../core/runtime/prefix.js";
import { sendRotatingMedia } from "../../core/runtime/command-media.js";

export const meta = {
  name: "help",
  aliases: ["h", "menu"],
  version: "6.0",
  author: "𝐒𝐈𝐅𝐀𝐓",
  description: "Show all available commands.",
  guide: "[command name]",
  cooldown: 5,
  prefix: "both",
  type: "anyone",
  category: "system"
};

const VIDEO_URLS = [
  "https://i.imgur.com/IudwgaP.mp4",
  "https://i.imgur.com/AMv8IqG.mp4",
  "https://i.imgur.com/xhFp4Rc.mp4",
  "https://i.imgur.com/EXar1VY.mp4",
  "https://i.imgur.com/vWigmIF.mp4",
  "https://i.imgur.com/V6Au0p4.mp4"
];

const smallCapsMap = {
  a: "ᴀ", b: "ʙ", c: "ᴄ", d: "ᴅ", e: "ᴇ", f: "ꜰ",
  g: "ɢ", h: "ʜ", i: "ɪ", j: "ᴊ", k: "ᴋ", l: "ʟ",
  m: "ᴍ", n: "ɴ", o: "ᴏ", p: "ᴘ", q: "ǫ", r: "ʀ",
  s: "ꜱ", t: "ᴛ", u: "ᴜ", v: "ᴠ", w: "ᴡ", x: "x",
  y: "ʏ", z: "ᴢ"
};

const cmdFontMap = {
  ...smallCapsMap,
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
  "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹"
};

let lastVideoIndex = -1;

export function toSmallCaps(text) {
  return String(text).toLowerCase().split("").map((character) =>
    smallCapsMap[character] || character
  ).join("");
}

export function toCommandFont(text) {
  return String(text).toLowerCase().split("").map((character) =>
    cmdFontMap[character] || character
  ).join("");
}

export async function onStart({ bot, chatId, msg, args = [], response }) {
  const commands = global.esha?.commands;
  if (!(commands instanceof Map)) {
    return response.reply("⚠️ Commands are not loaded yet.");
  }

  const actualChatId = chatId ?? msg?.chat?.id;
  const chatType = msg?.chat?.type ?? "private";
  const userId = String(msg?.from?.id ?? "");
  const isGroupAdmin = await checkGroupAdmin(bot, actualChatId, userId, chatType);
  const userRole = getUserAccessRole({
    userId,
    username: msg?.from?.username,
    settings: global.settings,
    vip: global.vip,
    isTelegramGroupAdmin: isGroupAdmin
  });
  const visibleCommands = getVisibleCommands(commands, userRole, chatType);
  const prefix = getPrefixesForChat(global.settings, actualChatId).join(" ");
  const query = String(args[0] ?? "").trim().toLowerCase();
  const isMenuQuery = !query || ["all", "-all", "-a"].includes(query) || /^\d+$/.test(query);

  if (!isMenuQuery) {
    const command = visibleCommands.find((entry) => {
      const identifiers = [entry.meta.name, ...(entry.meta.aliases ?? [])];
      return identifiers.some((identifier) => String(identifier).toLowerCase() === query);
    });
    if (!command) return response.reply(`❌ Command "${query}" not found.`);

    const detailMessage = generateCommandInfo(command.meta, prefix);
    return sendRotatingMedia({
      response,
      urls: VIDEO_URLS,
      caption: detailMessage,
      method: "video",
      key: "help"
    });
  }

  const helpMessage = generateHelpMenu(visibleCommands, prefix);
  return sendRotatingMedia({
    response,
    urls: VIDEO_URLS,
    caption: helpMessage,
    method: "video",
    key: "help"
  });
}

export function getVisibleCommands(commands, userRole, chatType) {
  return [...commands.values()]
    .filter((command) => {
      const category = String(command.meta?.category ?? "").toLowerCase();
      if (category === "hidden" || command.meta?.name === "help") return false;
      if (!canAccessCommand(userRole, command.meta)) return false;
      if (command.meta.type === "administrator" && !["group", "supergroup"].includes(chatType)) return false;
      if (command.meta.type === "group" && !["group", "supergroup"].includes(chatType)) return false;
      if (command.meta.type === "private" && chatType !== "private") return false;
      return true;
    })
    .sort((left, right) => left.meta.name.localeCompare(right.meta.name));
}

export function generateHelpMenu(commands, prefix) {
  const categories = {};

  for (const command of commands) {
    const category = cleanCategoryName(command.meta.category);
    if (!categories[category]) categories[category] = [];
    categories[category].push(command.meta.name);
  }

  let message = `╭┈─────┈──┈─────┈╮\n` +
    `       🌸 𝐁𝐎𝐓 𝐌𝐄𝐍𝐔 🌸\n` +
    `╰┈─────┈──┈─────┈╯\n\n`;

  for (const category of Object.keys(categories).sort()) {
    const names = categories[category].sort();
    message += `╭┈─┈━[🌸 ${toSmallCaps(category)} ]\n`;
    for (let index = 0; index < names.length; index += 2) {
      const first = toCommandFont(names[index]);
      const second = names[index + 1] ? toCommandFont(names[index + 1]) : null;
      message += second
        ? `┋⌬ ${first.padEnd(12)} ⌬ ${second}\n`
        : `┋⌬ ${first}\n`;
    }
    message += `┕┈───┈──┈────┈𒐬\n\n`;
  }

  message += `╭┈───────┈┈ ೄྀ࿐┐\n` +
    ` 🍄 𝐓𝐨𝐭𝐚𝐥: ${commands.length}\n` +
    ` 🎀 𝐏𝐫𝐞𝐟𝐢𝐱: ${prefix}\n` +
    ` 🌸𝐒𝐭𝐚𝐲 𝐇𝐚𝐩𝐩𝐲 & 𝐁𝐞𝐚𝐮𝐭𝐢𝐟𝐮𝐥🌸\n` +
    `╰┈──────┈──────┈─┘`;

  return message;
}

export function generateCommandInfo(command, prefix) {
  const name = command.name;
  const aliases = command.aliases?.length
    ? command.aliases.join(", ")
    : "None";
  const description =
    command.longDescription?.en ??
    command.longDescription ??
    command.shortDescription?.en ??
    command.shortDescription ??
    command.description ??
    "No description";
  const guides = Array.isArray(command.guide)
    ? command.guide
    : command.guide
      ? [command.guide]
      : [];
  const usage = guides.length
    ? guides.map((guide) => formatUsage(guide, prefix, name)).join("\n")
    : "No usage instructions provided.";

  return `╭┈─────┈─ ─┈────┈╮\n` +
    `  🌸 𝗖𝗢𝗠𝗠𝗔𝗡𝗗 𝗜𝗡𝗙𝗢 🌸\n` +
    `╰┈─────┈─ ─┈────┈╯\n\n` +
    ` 🪷 𝐍𝐚𝐦𝐞: ${toSmallCaps(name)}\n` +
    ` 🪷 𝐂𝐚𝐭𝐞𝐠𝐨𝐫𝐲: ${toSmallCaps(command.category || "General")}\n` +
    ` 🪷 𝐀𝐥𝐢𝐚𝐬𝐞𝐬: ${aliases}\n` +
    ` 🪷 𝐕𝐞𝐫𝐬𝐢𝐨𝐧: ${command.version || "1.0"}\n` +
    ` 🪷 𝐀𝐮𝐭𝐡𝐨𝐫: ${command.author || "S1FU"}\n\n` +
    ` ┌──────ʚ🍄ɞ──────┐\n` +
    `  📖 𝐃𝐞𝐬𝐜: ${description}\n\n` +
    `  💡 𝐔𝐬𝐚𝐠𝐞: ${usage}\n` +
    ` └──────ʚ🍄ɞ──────┘\n\n` +
    ` 🌸𝐒𝐭𝐚𝐲 𝐇𝐚𝐩𝐩𝐲&𝐁𝐞𝐚𝐮𝐭𝐢𝐟𝐮𝐥🌸\n` +
    `╰┈───┈──────┈───┈╯`;
}

async function checkGroupAdmin(bot, chatId, userId, chatType) {
  if (
    !userId ||
    chatId === undefined ||
    !["group", "supergroup"].includes(chatType) ||
    typeof bot?.getChatMember !== "function"
  ) {
    return false;
  }

  try {
    const member = await bot.getChatMember(chatId, userId);
    return member.status === "administrator" || member.status === "creator";
  } catch {
    return false;
  }
}

function cleanCategoryName(text) {
  if (!text) return "OTHERS";
  return String(text)
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function formatUsage(guide, prefix, name) {
  const value = String(guide ?? "").trim();
  if (value.includes("{pn}")) {
    return value.replace(/{pn}/g, prefix).replace(/{name}/g, name);
  }
  if (value.startsWith(`${prefix}${name}`)) return value;
  return `${prefix}${name}${value ? ` ${value}` : ""}`;
}
