import { inspect } from 'node:util';

export const meta = {
  name: "eval",
  version: "1.0.0",
  aliases: [],
  description: "Test your code from the bot quickly",
  author: "SIFAT",
  prefix: "both",
  category: "dev",
  type: "dev",
  role: "developer",
  cooldown: 5,
  guide: "<code to test>"
};

export async function onStart({ bot, args, response, msg, usages }) {
  if (!args.length) {
    return usages();
  }

  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
  const out = async (result) => {
    const formatted = typeof result === 'string'
      ? result
      : inspect(result, { depth: 4, maxArrayLength: 80, maxStringLength: 3000, breakLength: 100 });
    const output = formatted.length > 3500 ? `${formatted.slice(0, 3500)}\n… output truncated` : formatted;
    await response.reply(`<pre>${escapeHtml(output)}</pre>`, { parse_mode: 'HTML' });
  }

  const userCode = `
    (async () => {
      try {
        const __result = await (${args.join(" ")});
        await out(__result);
      } catch (err) {
        console.error("Eval error:", err);
        await response.reply(\`<pre>\${escapeHtml(String(err.stack || err.message).slice(0, 3500))}</pre>\`, { parse_mode: "HTML" });
      }
    })();
  `;

  try {
    await eval(userCode);
  } catch (err) {
    console.error("Eval invocation error:", err);
    await response.reply(`❌ Failed to evaluate code: ${err.message}`);
  }
}
