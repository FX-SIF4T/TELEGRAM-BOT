
import axios from "axios";

export const meta = {
  name: "screenshot",
  aliases: ["ss", "webss"],
  version: "2.0.0",
  author: "𝐒𝐈𝐅𝐀𝐓",
  description: "Take screenshot of any website.",
  guide: "[url] | Reply to a website link",
  cooldown: 5,
  prefix: "both",
  type: "anyone",
  category: "utility"
};

export async function onStart({
  bot,
  chatId,
  msg,
  args = [],
  response
}) {
  const targetChat = chatId ?? msg?.chat?.id;

  try {
    let url = args.join(" ").trim();

    if (!url && msg?.reply_to_message) {
      const text =
        msg.reply_to_message.text ||
        msg.reply_to_message.caption ||
        "";

      const match = text.match(
        /https?:\/\/[^\s]+|(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s]*)?/i
      );

      url = match?.[0] || "";
    }

    if (!url) {
      return response.reply(
        "╭━━━〔 WEBSITE SCREENSHOT 〕\n" +
        "┃\n" +
        "┃ Please provide a website URL.\n" +
        "┃\n" +
        "┃ Example:\n" +
        "┃ ss google.com\n" +
        "┃ ss https://github.com\n" +
        "┃\n" +
        "╰━━━〔 POWERED BY SIFAT 〕"
      );
    }

    url = url.replace(/[<>()[\]{}"'`,]+$/g, "");

    if (!/^https?:\/\//i.test(url)) {
      url = "https://" + url;
    }

    const parsed = new URL(url);

    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("Invalid URL protocol.");
    }

    if (!parsed.hostname.includes(".")) {
      throw new Error("Invalid website URL.");
    }

    const loading = await response.reply(
      "⏳ Generating website screenshot...\nPlease wait."
    );

    try {
      const res = await axios.get(
        "https://fxswebssapi.vercel.app/api/ss",
        {
          params: { q: url },
          timeout: 120000,
          headers: {
            "User-Agent": "Mozilla/5.0"
          }
        }
      );

      if (
        !res.data ||
        res.data.status !== true ||
        !res.data.screenshot
      ) {
        throw new Error(
          res.data?.message || "Screenshot generation failed."
        );
      }

      const imageUrl = res.data.screenshot;

      const image = await axios.get(imageUrl, {
        responseType: "arraybuffer",
        timeout: 120000,
        maxContentLength: 20 * 1024 * 1024,
        headers: {
          "User-Agent": "Mozilla/5.0"
        }
      });

      const buffer = Buffer.from(image.data);

      if (!buffer.length) {
        throw new Error("Screenshot image is empty.");
      }

      const contentType =
        image.headers["content-type"] || "";

      if (!contentType.startsWith("image/")) {
        throw new Error("API returned an invalid image.");
      }

      await bot.sendPhoto(
        targetChat,
        buffer,
        {
          caption:
            "╭━━━〔 WEBSITE SCREENSHOT 〕\n" +
            "┃\n" +
            `┃ 🌐 Website: ${parsed.hostname}\n` +
            "┃ ✅ Screenshot generated\n" +
            "┃\n" +
            "╰━━━〔 POWERED BY SIFAT 〕",
          reply_to_message_id: msg.message_id
        }
      );

    } finally {
      if (loading?.message_id) {
        await bot.deleteMessage(
          targetChat,
          loading.message_id
        ).catch(() => {});
      }
    }

  } catch (error) {
    return response.reply(
      `❌ ${error?.response?.data?.message || error.message || "Screenshot generation failed."}`
    );
  }
}
