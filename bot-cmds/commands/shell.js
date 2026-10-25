import { exec } from 'child_process';
import util from 'util';
const execPromise = util.promisify(exec);
const MAX_OUTPUT_LENGTH = 3200;

export const meta = {
  name: 'shell',
  version: '1.0.0',
  aliases: ['terminal', 'bash'],
  description: 'Execute shell or terminal commands on the server.',
  author: 'SIFAT',
  prefix: 'both',
  category: 'dev',
  type: 'dev',
  role: 'developer',
  cooldown: 5,
  guide: ['<command> - Run a shell/terminal command on the host server.']
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function truncate(value) {
  const text = String(value || '');
  return text.length > MAX_OUTPUT_LENGTH
    ? `${text.slice(0, MAX_OUTPUT_LENGTH)}\n… output truncated`
    : text;
}

export async function onStart({ bot, msg, args, response, usages }) {
  const command = args.join(' ');
  if (!command) {
    return usages();
  }

  const loadingMsg = await response.reply('💻 *Executing command...*', { parse_mode: 'Markdown' });

  try {
    const { stdout, stderr } = await execPromise(command, {
      timeout: 30000,
      maxBuffer: 512 * 1024,
      windowsHide: true
    });
    const output = [stdout?.trim(), stderr?.trim()].filter(Boolean).join('\n\n') ||
      'Command completed successfully with no output.';
    await response.editText(
      loadingMsg,
      `<b>Command</b>\n<code>${escapeHtml(truncate(command))}</code>\n\n` +
      `<b>Output</b>\n<pre>${escapeHtml(truncate(output))}</pre>`,
      { parse_mode: 'HTML' }
    );

  } catch (error) {
    const details = [error.message, error.stdout, error.stderr].filter(Boolean).join('\n').trim();
    await response.editText(
      loadingMsg,
      `<b>Command failed</b>\n<pre>${escapeHtml(truncate(details))}</pre>`,
      { parse_mode: 'HTML' }
    );
  }
}
