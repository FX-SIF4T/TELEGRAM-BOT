
import axios from "axios";
import FormData from "form-data";
import fs from "fs-extra";
import path from "path";
import os from "os";

const API = "https://image-edit-api-3olu.onrender.com";
const API_KEY = process.env.IMAGE_EDIT_API_KEY || "firexsifu";
const CACHE = path.join(os.tmpdir(), "clipsnap-edit");

const HEADERS = {
  "X-API-Key": API_KEY
};

export const meta = {
  name: "edit",
  aliases: ["ai-edit", "clipsnap"],
  version: "1.0.0",
  author: "𝐒𝐈𝐅𝐀𝐓",
  description: "AI image editing using ClipSnap API.",
  guide: "[prompt] | models [fast/high-quality] | --mode fast/high_quality",
  cooldown: 5,
  prefix: "both",
  type: "anyone",
  category: "image"
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function parseError(error) {
  const data = error.response?.data;

  if (data) {
    try {
      const parsed = JSON.parse(Buffer.from(data).toString());
      return parsed.detail || parsed.message || parsed.error || error.message;
    } catch {}
  }

  return error.message || "Something went wrong.";
}

function getImage(msg) {
  if (!msg) return null;

  if (msg.photo?.length) {
    return msg.photo[msg.photo.length - 1];
  }

  if (msg.document?.mime_type?.startsWith("image/")) {
    return msg.document;
  }

  return null;
}

function parseInput(args) {
  const input = args.join(" ").trim();

  const modeMatch = input.match(
    /--mode(?:=|\s+)(?:"([^"]+)"|'([^']+)'|(\S+))/i
  );

  const modelMatch = input.match(
    /--model(?:=|\s+)(?:"([^"]+)"|'([^']+)'|(.+?))(?=\s+--|$)/i
  );

  const mode = (
    modeMatch?.[1] ||
    modeMatch?.[2] ||
    modeMatch?.[3] ||
    "fast"
  ).toLowerCase();

  const model = (
    modelMatch?.[1] ||
    modelMatch?.[2] ||
    modelMatch?.[3] ||
    "Nano Banana"
  ).trim();

  const imageUrl = input.match(/https?:\/\/[^\s]+/i)?.[0] || "";

  const prompt = input
    .replace(/--mode(?:=|\s+)(?:"[^"]+"|'[^']+'|\S+)/i, "")
    .replace(/--model(?:=|\s+)(?:"[^"]+"|'[^']+'|.+?)(?=\s+--|$)/i, "")
    .replace(/https?:\/\/[^\s]+/i, "")
    .trim();

  return { prompt, mode, model, imageUrl };
}

async function downloadTelegramImage(bot, image) {
  const url = await bot.getFileLink(image.file_id);

  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 60000,
    maxContentLength: 20 * 1024 * 1024
  });

  const mime = res.headers["content-type"] || "image/jpeg";

  if (!mime.startsWith("image/")) {
    throw new Error("Invalid Telegram image.");
  }

  return {
    buffer: Buffer.from(res.data),
    mime,
    ext: mime.includes("png")
      ? "png"
      : mime.includes("webp")
        ? "webp"
        : "jpg"
  };
}


async function downloadImageUrl(url) {
  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 120000,
    maxContentLength: 30 * 1024 * 1024
  });

  const mime = res.headers["content-type"] || "image/jpeg";

  if (!mime.startsWith("image/")) {
    throw new Error("API result URL did not return an image.");
  }

  return {
    buffer: Buffer.from(res.data),
    mime
  };
}


async function extractImage(data, contentType) {
  if (
    contentType?.startsWith("image/") ||
    contentType?.includes("octet-stream")
  ) {
    return Buffer.from(data);
  }

  let json;

  try {
    json = JSON.parse(Buffer.from(data).toString("utf8"));
  } catch {
    throw new Error("API returned an unsupported image response.");
  }

  
  const findImage = obj => {
    if (!obj || typeof obj !== "object") return null;

    const url =
      obj.image_url ||
      obj.output_url ||
      obj.result_url ||
      obj.imageUrl ||
      obj.url;

    const base64 =
      obj.image_base64 ||
      obj.base64 ||
      obj.image;

    if (typeof base64 === "string" && base64.length > 100) {
      return { base64 };
    }

    if (typeof url === "string" && /^https?:\/\//i.test(url)) {
      return { url };
    }

    for (const key of ["data", "result", "output"]) {
      const found = findImage(obj[key]);
      if (found) return found;
    }

    return null;
  };

  const found = findImage(json);

  if (found?.base64) {
    const base64 = found.base64.replace(
      /^data:image\/[^;]+;base64,/i,
      ""
    );
    return Buffer.from(base64, "base64");
  }

  if (found?.url) {
    const result = await downloadImageUrl(found.url);
    return result.buffer;
  }

  throw new Error(
    json.detail ||
    json.message ||
    json.error ||
    "No generated image found in API response."
  );
}


async function waitForJob(jobId) {
  const maxAttempts = 100;

  for (let i = 0; i < maxAttempts; i++) {
    const statusRes = await axios.get(
      `${API}/api/v1/jobs/${encodeURIComponent(jobId)}`,
      {
        headers: HEADERS,
        timeout: 30000
      }
    );

    const job = statusRes.data || {};
    const status = String(
      job.status || job.state || ""
    ).toLowerCase();

    if (["completed", "complete", "success", "succeeded", "done"].includes(status)) {
      const resultRes = await axios.get(
        `${API}/api/v1/jobs/${encodeURIComponent(jobId)}/result`,
        {
          headers: HEADERS,
          responseType: "arraybuffer",
          timeout: 120000,
          maxContentLength: 30 * 1024 * 1024
        }
      );

      return extractImage(
        resultRes.data,
        resultRes.headers["content-type"] || ""
      );
    }

    if (["failed", "error", "cancelled", "canceled"].includes(status)) {
      throw new Error(
        job.error || job.message || "Image editing job failed."
      );
    }

    await sleep(3000);
  }

  throw new Error("Image generation timed out.");
}


async function showModels(response, type = "") {
  const endpoint = type === "fast"
    ? "/api/v1/models/fast"
    : type === "high-quality" || type === "high_quality"
      ? "/api/v1/models/high-quality"
      : "/api/v1/models";

  const res = await axios.get(`${API}${endpoint}`, {
    headers: HEADERS,
    timeout: 60000
  });

  const data = res.data;
  const models = data.models || data.data || data;

  let output = "╭━━━〔 CLIPSNAP AI MODELS 〕\n";

  if (Array.isArray(models)) {
    models.forEach((item, index) => {
      const name = typeof item === "string"
        ? item
        : item.name || item.id || "Unknown";

      const available = typeof item === "string" || item.available !== false;

      output += `┃ ${index + 1}. ${name} ${available ? "✅" : "❌"}\n`;
    });
  } else if (typeof models === "object" && models !== null) {
    for (const [category, items] of Object.entries(models)) {
      output += `\n┣━━〔 ${category.toUpperCase()} 〕\n`;

      if (Array.isArray(items)) {
        items.forEach((item, index) => {
          const name = typeof item === "string"
            ? item
            : item.name || item.id || "Unknown";

          output += `┃ ${index + 1}. ${name}\n`;
        });
      }
    }
  } else {
    output += "┃ No models found.\n";
  }

  output += "\n╰━━〔 POWERED BY SIFAT 〕";

  return response.reply(output);
}

export async function onStart({
  bot,
  chatId,
  msg,
  args = [],
  response
}) {
  let output;
  let processing;

  const targetChat = chatId ?? msg.chat.id;

  try {
    const sub = String(args[0] || "").toLowerCase();

    // HELP
    if (["help", "-h", "--help"].includes(sub)) {
      return response.reply(
        "╭━━━〔 CLIPSNAP AI 〕\n" +
        "┃\n" +
        "┃ ✦ AI Image Editing\n" +
        "┃ ✦ Default Mode: FAST\n" +
        "┃ ✦ Default Model: Nano Banana\n" +
        "┃\n" +
        "┣━━━〔 COMMANDS 〕\n" +
        "┃ edit [prompt]\n" +
        "┃ edit models\n" +
        "┃ edit models fast\n" +
        "┃ edit models high-quality\n" +
        "┃ edit help\n" +
        "┃\n" +
        "┣━━━〔 MODES 〕\n" +
        "┃ --mode fast\n" +
        "┃ --mode high_quality\n" +
        "┃\n" +
        "┣━━━〔 EXAMPLES 〕\n" +
        "┃ Reply image: edit Make it cinematic\n" +
        "┃ edit Remove background --mode fast\n" +
        "┃ edit Make realistic --mode high_quality\n" +
        "┃ edit Beautiful portrait --model \"Nano Banana Pro\"\n" +
        "┃\n" +
        "╰━━━〔 POWERED BY SIFAT 〕"
      );
    }

    
    if (sub === "models") {
      const type = String(args[1] || "").toLowerCase();
      return await showModels(response, type);
    }

    const {
      prompt,
      mode,
      model,
      imageUrl
    } = parseInput(args);

    if (!prompt) {
      return response.reply("❌ Please provide an editing prompt.");
    }

    if (!["fast", "high_quality"].includes(mode)) {
      return response.reply("❌ Invalid mode. Use fast or high_quality.");
    }

  
    const image =
      getImage(msg.reply_to_message) ||
      getImage(msg);

    if (!image && !imageUrl) {
      return response.reply(
        "❌ Reply to an image, attach an image, or provide an image URL."
      );
    }

    processing = await response.reply(
      "⏳ AI is editing your image...\nPlease wait."
    );

    await fs.ensureDir(CACHE);

  
    const form = new FormData();

    form.append("prompt", prompt);
    form.append("mode", mode);
    form.append("model", model);

    if (image) {
      const file = await downloadTelegramImage(bot, image);

      form.append("image", file.buffer, {
        filename: `input.${file.ext}`,
        contentType: file.mime
      });
    } else {
      form.append("image_url", imageUrl);
    }


    const result = await axios.post(
      `${API}/api/v1/edit`,
      form,
      {
        headers: {
          ...HEADERS,
          ...form.getHeaders()
        },
        responseType: "arraybuffer",
        timeout: 330000,
        maxContentLength: 30 * 1024 * 1024,
        maxBodyLength: 30 * 1024 * 1024
      }
    );

    const contentType = result.headers["content-type"] || "";

    let imageBuffer;

    if (contentType.startsWith("image/") ||
        contentType.includes("octet-stream")) {
      imageBuffer = Buffer.from(result.data);
    } else {
    
      let json = {};

      try {
        json = JSON.parse(Buffer.from(result.data).toString("utf8"));
      } catch {}

      const jobId = json.job_id || json.id;

      if (jobId) {
        imageBuffer = await waitForJob(jobId);
      } else {
        imageBuffer = await extractImage(result.data, contentType);
      }
    }

    if (!imageBuffer?.length) {
      throw new Error("Generated image is empty.");
    }

  
    output = path.join(
      CACHE,
      `edit-${Date.now()}.jpg`
    );

    await fs.writeFile(output, imageBuffer);

  
    await bot.sendPhoto(
      targetChat,
      fs.createReadStream(output),
      {
        reply_to_message_id: msg.message_id,
        caption:
          "╭━━━〔AI EDITOR〕\n" +
          "┃\n" +
          "┃ Image edited successfully!\n" +
          `┃ 🎨 Mode: ${mode}\n` +
          `┃ 🤖 Model: ${model}\n` +
          "┃ 👑 Powered by SIFAT\n" +
          "╰━━━━━━━━━━━━━━"
      }
    );

  } catch (error) {
    return response.reply(`❌ ${parseError(error)}`);

  } finally {
    if (output) {
      await fs.remove(output).catch(() => {});
    }

    if (processing?.message_id) {
      await bot.deleteMessage(
        targetChat,
        processing.message_id
      ).catch(() => {});
    }
  }
}
