import fs from "fs-extra";
import path from "node:path";
import { normalizeNoPrefixMode } from "../../core/runtime/prefix.js";

export const meta = {
  name: "noprefix",
  aliases: ["np"],
  version: "1.0.0",
  description: "Control commands that can be used without a prefix.",
  author: "SIFAT",
  prefix: true,
  category: "config",
  role: "admin",
  type: "anyone",
  cooldown: 2,
  guide: ["on", "off", "admin on", "admin off"]
};

const usage =
  "Usage:\n" +
  ".np on - allow everyone to use commands without a prefix\n" +
  ".np off - disable no-prefix commands\n" +
  ".np admin on - allow only admins to use commands without a prefix\n" +
  ".np admin off - disable admin-only no-prefix mode";

export async function onStart({ args = [], response }) {
  const settings = global.settings;
  if (!settings || typeof settings !== "object") {
    return response.reply("⚠️ Bot settings are unavailable.");
  }

  const commandArgs = Array.isArray(args)
    ? args.map((argument) => String(argument).toLowerCase())
    : [];

  if (commandArgs.length === 0) {
    const mode = normalizeNoPrefixMode(settings.noPrefix);
    const label = mode === "all"
      ? "on for everyone"
      : mode === "adminOnly"
        ? "on for admins only"
        : "off";
    return response.reply(`⚙️ No-prefix mode is currently ${label}.\n\n${usage}`);
  }

  let mode;
  if (commandArgs.length === 1 && commandArgs[0] === "on") {
    mode = "all";
  } else if (commandArgs.length === 1 && commandArgs[0] === "off") {
    mode = "off";
  } else if (
    commandArgs.length === 2 &&
    commandArgs[0] === "admin" &&
    commandArgs[1] === "on"
  ) {
    mode = "adminOnly";
  } else if (
    commandArgs.length === 2 &&
    commandArgs[0] === "admin" &&
    commandArgs[1] === "off"
  ) {
    mode = "off";
  } else {
    return response.reply(usage);
  }

  try {
    await saveNoPrefixMode(mode);
  } catch (error) {
    console.error("Failed to save no-prefix mode:", error.message);
    return response.reply("⚠️ Could not save the no-prefix setting.");
  }

  if (mode === "all") {
    return response.reply("✅ No-prefix commands are now enabled for everyone.");
  }
  if (mode === "adminOnly") {
    return response.reply("✅ No-prefix commands are now enabled for admins only.");
  }
  return response.reply("✅ No-prefix commands are now disabled.");
}

async function saveNoPrefixMode(mode) {
  if (!global.settingsPath) {
    throw new Error("Settings file path is not configured.");
  }

  const updatedSettings = { ...(global.settings ?? {}), noPrefix: mode };
  const temporaryPath = `${global.settingsPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.ensureDir(path.dirname(global.settingsPath));
  try {
    await fs.writeFile(temporaryPath, JSON.stringify(updatedSettings, null, 2), "utf8");
    await fs.rename(temporaryPath, global.settingsPath);
    global.settings = updatedSettings;
  } catch (error) {
    await fs.remove(temporaryPath).catch(() => {});
    throw error;
  }
}
