
import axios from "axios";
import fs from "fs-extra";
import path from "path";
import os from "os";

const API = "https://fxspinterestapi.vercel.app";
const KEY = "sifatx404";
const CACHE = path.join(os.tmpdir(), "pinterest-cache");
const MAX_MB = 24;

const UA = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"
};

const pendingVideos = new Map();

export const meta = {
  name: "pinterest",
  aliases: ["pin", "pintrest"],
  version: "2.0.0",
  author: "𝐒𝐈𝐅𝐀𝐓",
  description: "Search and download Pinterest images and videos.",
  guide: "[query] [-limit] | -v [query] [-limit] | Reply to results with a number",
  cooldown: 10,
  prefix: "both",
  type: "anyone",
  category: "media"
};

function short(text, max = 60) {
  text = String(text || "No title").replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

function clean(files) {
  for (const file of files) {
    if (file) fs.remove(file).catch(() => {});
  }
}

function errMsg(error) {
  const status = error?.response?.status;

  if (status === 401 || status === 403) return "API key invalid!";
  if (status === 404) return "API endpoint not found!";
  if (status === 413) return "File too large!";
  if (error?.code === "ECONNABORTED") return "API timeout, try again!";
  return error?.response?.data?.detail ||
    error?.response?.data?.message ||
    error?.message ||
    "Pinterest API error!";
}

async function toFile(url, ext, timeout = 60000, params) {
  await fs.ensureDir(CACHE);

  const file = path.join(
    CACHE,
    `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
  );

  const res = await axios.get(url, {
    params,
    responseType: "arraybuffer",
    timeout,
    headers: UA,
    maxContentLength: MAX_MB * 1024 * 1024,
    maxBodyLength: MAX_MB * 1024 * 1024
  });

  const buffer = Buffer.from(res.data);

  if (buffer.length < 500) {
    throw new Error("Empty or invalid file.");
  }

  await fs.writeFile(file, buffer);
  return file;
}

async function imageFile(url) {
  try {
    return await toFile(url, "jpg", 30000);
  } catch {
    return await toFile(
      `${API}/api/image`,
      "jpg",
      30000,
      { url, key: KEY }
    );
  }
}

function parseInput(args) {
  let input = args.join(" ").trim();

  const isVideo = /(?:^|\s)-v(?:\s|$)/i.test(input);

  input = input.replace(/(?:^|\s)-v(?=\s|$)/i, " ").trim();

  const match = input.match(/(?:^|\s)-(\d+)\s*$/);

  const limit = match
    ? Math.min(Math.max(parseInt(match[1]), 1), isVideo ? 10 : 30)
    : isVideo ? 6 : 10;

  if (match) {
    input = input.replace(/(?:^|\s)-(\d+)\s*$/, "").trim();
  }

  return { query: input, isVideo, limit };
}

async function searchPinterest(query, isVideo, limit) {
  const endpoint = isVideo
    ? "/api/video/search"
    : "/api/search";

  const res = await axios.get(`${API}${endpoint}`, {
    params: {
      q: query,
      limit,
      key: KEY
    },
    timeout: 90000,
    headers: UA
  });

  return (res.data?.results || []).slice(0, limit);
}

async function downloadVideo(video) {
  if (video.download) {
    try {
      return await toFile(video.download, "mp4", 180000);
    } catch {}
  }

  if (video.hls) {
    return await toFile(
      `${API}/api/video/download`,
      "mp4",
      180000,
      {
        url: video.hls,
        key: KEY
      }
    );
  }

  if (video.pin) {
    return await toFile(
      `${API}/api/video/download`,
      "mp4",
      180000,
      {
        url: video.pin,
        key: KEY
      }
    );
  }

  throw new Error("Video download URL not found.");
}

async function sendImages(bot, chatId, images, query, msg) {
  const files = [];

  try {
    const downloaded = await Promise.all(
      images.map(item =>
        item.image_url
          ? imageFile(item.image_url).catch(() => null)
          : null
      )
    );

    files.push(...downloaded.filter(Boolean));

    if (!files.length) {
      return bot.sendMessage(chatId, "❌ Image loading failed!", {
        reply_to_message_id: msg.message_id
      });
    }

    for (let i = 0; i < files.length; i += 10) {
      const batch = files.slice(i, i + 10);

      const media = batch.map((file, index) => ({
        type: "photo",
        media: file,
        ...(i === 0 && index === 0
          ? { caption: `🖼 PINTEREST: ${query}\n\nTotal: ${files.length}` }
          : {})
      }));

      await bot.sendMediaGroup(chatId, media, {
        reply_to_message_id: i === 0 ? msg.message_id : undefined
      });
    }
  } finally {
    clean(files);
  }
}

async function sendVideoResults(bot, chatId, videos, query, msg) {
  const list = videos
    .map((video, index) =>
      `${index + 1}. ${short(video.title)}`
    )
    .join("\n");

  const body =
    `╭━━━〔 PINTEREST VIDEO 〕\n` +
    `┃ 🔎 Search: ${query}\n` +
    `┃ 🎬 Found: ${videos.length}\n` +
    `┣━━━━━━━━━━━━━━\n` +
    `${list}\n` +
    `┣━━━━━━━━━━━━━━\n` +
    `┃ Reply to this message with a number\n` +
    `┃ Example: 1\n` +
    `╰━━━〔 POWERED BY SIFAT 〕`;

  const sent = await bot.sendMessage(chatId, body, {
    reply_to_message_id: msg.message_id
  });

  pendingVideos.set(
    `${chatId}:${sent.message_id}`,
    {
      videos,
      author: String(msg.from?.id || ""),
      createdAt: Date.now()
    }
  );

  for (const [key, value] of pendingVideos) {
    if (Date.now() - value.createdAt > 30 * 60 * 1000) {
      pendingVideos.delete(key);
    }
  }

  return sent;
}

export async function onStart({
  bot,
  chatId,
  msg,
  args = [],
  response
}) {
  const targetChat = chatId ?? msg?.chat?.id;
  let videoFile;

  try {
    const replied = msg?.reply_to_message;

    if (
      replied &&
      /^\d+$/.test(String(args[0] || "").trim())
    ) {
      const key = `${targetChat}:${replied.message_id}`;
      const saved = pendingVideos.get(key);

      if (!saved) {
        return response.reply("❌ Search result expired. Search again.");
      }

      if (
        saved.author &&
        saved.author !== String(msg.from?.id || "")
      ) {
        return response.reply("❌ This search belongs to another user.");
      }

      const choice = parseInt(args[0], 10);
      const video = saved.videos[choice - 1];

      if (!video) {
        return response.reply(
          `❌ Invalid number! Choose 1-${saved.videos.length}.`
        );
      }

      await response.reply("⏳ Downloading Pinterest video...");

      videoFile = await downloadVideo(video);

      await bot.sendVideo(
        targetChat,
        fs.createReadStream(videoFile),
        {
          caption:
            `╭━━━〔 PINTEREST VIDEO 〕\n` +
            `┃ 🎬 ${short(video.title, 100)}\n` +
            `┃ ✅ Download complete\n` +
            `┃ 👑 Powered by SIFAT\n` +
            `╰━━━━━━━━━━━━━━`,
          reply_to_message_id: msg.message_id,
          supports_streaming: true
        }
      );

      return;
    }

    const { query, isVideo, limit } = parseInput(args);

    if (!query) {
      return response.reply(
        "╭━━━〔 PINTEREST SEARCH 〕\n" +
        "┃\n" +
        "┃ 🖼 Images:\n" +
        "┃ pin cat\n" +
        "┃ pin cat -20\n" +
        "┃\n" +
        "┃ 🎬 Videos:\n" +
        "┃ pin -v cat\n" +
        "┃ pin -v cat -5\n" +
        "┃\n" +
        "┃ Reply to video results with a number\n" +
        "┃\n" +
        "╰━━━〔 POWERED BY SIFAT 〕"
      );
    }

    const loading = await response.reply(
      `⏳ Searching Pinterest ${isVideo ? "videos" : "images"}...\n🔎 ${query}`
    );

    try {
      const results = await searchPinterest(query, isVideo, limit);

      if (!results.length) {
        return bot.sendMessage(targetChat, "❌ No Pinterest results found.", {
          reply_to_message_id: msg.message_id
        });
      }

      if (isVideo) {
        const videos = results
          .map(video => ({
            title: video.title,
            hls: video.hls_url,
            download: video.download_url,
            cover: video.cover_url,
            pin: video.pin_url
          }))
          .filter(video => video.hls || video.download || video.pin);

        if (!videos.length) {
          return response.reply("❌ No downloadable videos found.");
        }

        return await sendVideoResults(
          bot,
          targetChat,
          videos,
          query,
          msg
        );
      }

      return await sendImages(
        bot,
        targetChat,
        results,
        query,
        msg
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
    return response.reply(`❌ ${errMsg(error)}`);
  } finally {
    if (videoFile) {
      clean([videoFile]);
    }
  }
}
