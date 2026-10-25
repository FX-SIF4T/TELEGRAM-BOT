import { creditBalance, debitBalance, getBalance } from '../../core/runtime/storage.js';

export const meta = {
  name: 'bet',
  aliases: ['sicbo'],
  version: '3.0',
  author: 'S1F4T',
  description: '𝖽𝗂𝗀𝗂𝗍𝖺𝗅 𝖽𝗂𝖼𝖾 𝖻𝖾𝗍𝗍𝗂𝗇𝗀',
  prefix: 'both',
  category: '𝗀𝖺𝗆𝖾',
  role: 'normaluser',
  cooldown: 5,
  guide: ['『 <𝖻𝗂𝗀/𝗌𝗆𝖺𝗅𝗅> <𝖺𝗆𝗈𝗎𝗇𝗍> 』']
};

const fonts = {
  a: '𝖺', b: '𝖻', c: '𝖼', d: '𝖽', e: '𝖾', f: '𝖿', g: '𝗀', h: '𝗁', i: '𝗂', j: '𝗃', k: '𝗄', l: '𝗅', m: '𝗆',
  n: '𝗇', o: '𝗈', p: '𝗉', q: '𝗊', r: '𝗋', s: '𝗌', t: '𝗍', u: '𝗎', v: '𝗏', w: '𝗐', x: '𝗑', y: '𝗒', z: '𝗓',
  '0': '𝟎', '1': '𝟏', '2': '𝟐', '3': '𝟑', '4': '𝟒', '5': '𝟓', '6': '𝟔', '7': '𝟕', '8': '𝟖', '9': '𝟗'
};

const stylize = (text) => String(text)
  .toLowerCase()
  .split('')
  .map((character) => fonts[character] || character)
  .join('');

export function parseBetAmount(input) {
  if (typeof input !== 'string' || !input.trim()) return Number.NaN;
  const value = input.trim().toLowerCase();
  const number = Number.parseFloat(value);
  if (!Number.isFinite(number)) return Number.NaN;
  if (value.endsWith('k')) return number * 1000;
  if (value.endsWith('m')) return number * 1000000;
  return number;
}

export function getBetResult(choice, total) {
  const resultType = total >= 11 && total <= 17 ? 'big' : 'small';
  const userPick = ['big', 'tai', 'b'].includes(choice) ? 'big' : 'small';
  return { resultType, userPick, isWin: userPick === resultType };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function setReaction(bot, msg, emoji) {
  if (typeof bot?.setMessageReaction !== 'function' || !msg?.message_id) return;
  try {
    await bot.setMessageReaction(msg.chat.id, msg.message_id, {
      reaction: [{ type: 'emoji', emoji }]
    });
  } catch {}
}

function getPlayerName(user) {
  return [user?.first_name, user?.last_name].filter(Boolean).join(' ') ||
    (user?.username ? `@${user.username}` : String(user?.id ?? ''));
}

export async function onStart({ bot, msg, args = [], response }) {
  const userId = msg?.from?.id;
  const choice = String(args[0] ?? '').toLowerCase();
  const betAmount = parseBetAmount(args[1]);
  const validChoices = ['big', 'small', 'tai', 'xiu', 'b', 's'];

  if (!validChoices.includes(choice) || !Number.isSafeInteger(betAmount) || betAmount <= 0) {
    const invocation = String(msg?.text ?? msg?.caption ?? '').trim().split(/\s+/, 1)[0] ||
      `${global.settings?.prefix ?? '.'}bet`;
    return response.reply(
      `╭───────────────────╮\n\n  ᯓ  𝗂𝗇𝗏𝖺𝗅𝗂𝖽 𝖿𝗈𝗋𝗆𝖺𝗍 .ᐟ\n  ⋆ 𝗎𝗌𝖾: ${invocation} 𝖻𝗂𝗀 𝟧𝟢𝗄\n\n╰──────────────────────╯`
    );
  }
  if (userId === undefined || userId === null) {
    return response.reply('ᯓ 𝗎𝗇𝖺𝖻𝗅𝖾 𝗍𝗈 𝗋𝖾𝖺𝖽 𝗎𝗌𝖾𝗋 𝗐𝖺𝗅𝗅𝖾𝗍');
  }
  if (betAmount > Math.floor(Number.MAX_SAFE_INTEGER / 2)) {
    return response.reply(`ᯓ 𝗂𝗇𝗏𝖺𝗅𝗂𝖽 𝖻𝖾𝗍 𝖺𝗆𝗈𝗎𝗇𝗍`);
  }

  let balance;
  try {
    balance = await getBalance(userId);
  } catch (error) {
    console.error('bet: could not read wallet balance:', error);
    return response.reply('ᯓ 𝗐𝖺𝗅𝗅𝖾𝗍 𝗎𝗇𝖺𝗏𝖺𝗂𝗅𝖺𝖻𝗅𝖾');
  }
  if (balance < betAmount) {
    return response.reply(`ᯓ 𝗂𝗇𝗌𝗎𝖿𝖿𝗂𝖼𝗂𝖾𝗇𝗍 𝖼𝗈𝗂𝗇𝗌 \n 𝖻𝖺𝗅𝖺𝗇𝖼𝖾: ${stylize(balance.toLocaleString())}$`);
  }

  let debit;
  try {
    debit = await debitBalance(userId, betAmount, 'bet-wager');
  } catch (error) {
    console.error('bet: could not place bet:', error);
    return response.reply('ᯓ 𝗐𝖺𝗅𝗅𝖾𝗍 𝗎𝗇𝖺𝗏𝖺𝗂𝗅𝖺𝖻𝗅𝖾');
  }
  if (!debit.ok) {
    return response.reply(
      `ᯓ 𝗂𝗇𝗌𝗎𝖿𝖿𝗂𝖼𝗂𝖾𝗇𝗍 𝖼𝗈𝗂𝗇𝗌 \n 𝖻𝖺𝗅𝖺𝗇𝖼𝖾: ${stylize((debit.balance ?? balance).toLocaleString())}$`
    );
  }

  let loading;
  try {
    loading = await response.reply('ᯓ 𝗌𝗁𝖺𝗄𝗂𝗇𝗀 𝖽𝗂𝖼𝖾...🤒');
  } catch (error) {
    console.error('bet: could not show game animation:', error);
    try {
      await creditBalance(userId, betAmount, 'bet-refund');
    } catch (refundError) {
      console.error('bet: wager refund failed:', refundError);
    }
    return;
  }

  const diceFaces = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
  const d1 = Math.floor(Math.random() * 6) + 1;
  const d2 = Math.floor(Math.random() * 6) + 1;
  const d3 = Math.floor(Math.random() * 6) + 1;
  const total = d1 + d2 + d3;
  const { resultType, isWin } = getBetResult(choice, total);
  let finalMoney = debit.balance;

  if (isWin) {
    try {
      const payout = await creditBalance(userId, betAmount * 2, 'bet-payout');
      finalMoney = payout.balance;
    } catch (error) {
      console.error('bet: payout failed:', error);
      try {
        await creditBalance(userId, betAmount, 'bet-refund');
        await response.editText(loading, 'ᯓ 𝗐𝖺𝗀𝖾𝗋 𝗋𝖾𝖿𝗎𝗇𝖽𝖾𝖽');
      } catch (refundError) {
        console.error('bet: wager refund failed:', refundError);
        await response.editText(loading, 'ᯓ 𝗀𝖺𝗆𝖾 𝖿𝖺𝗂𝗅𝖾𝖽 — 𝖼𝗈𝗇𝗍𝖺𝖼𝗍 𝖺 𝖽𝖾𝗏𝖾𝗅𝗈𝗉𝖾𝗋');
      }
      return;
    }
  }

  const frames = ['⚀ ⚄ ⚃', '⚅ ⚁ ⚂', '⚃ ⚂ ⚄'];
  try {
    for (const frame of frames) {
      await delay(700);
      await response.editText(loading, `┆━━━━━━━━━━━━━┆\n\n              [ ${frame} ]\n\n┆━━━━━━━━━━━━━┆`);
    }

    await delay(500);
    const status = isWin ? '𝗐𝗂𝗇𝗇𝖾𝗋' : '𝗅𝗈𝗌𝖾𝗋';
    const profit = isWin ? `+${betAmount.toLocaleString()}` : `-${betAmount.toLocaleString()}`;
    const finalUI =
      `┍━━━[𝗌𝗂𝖼𝖻𝗈 𝗋𝖾𝗌𝗎𝗅𝗍]\n\n` +
      `  𝖽𝗂𝖼𝖾: [ ${diceFaces[d1 - 1]} ] [ ${diceFaces[d2 - 1]} ] [ ${diceFaces[d3 - 1]} ]\n` +
      `  ⋆ 𝗍𝗈𝗍𝖺𝗅: ${stylize(total)} [ ${stylize(resultType)} ]\n\n` +
      `  ⋆ 𝗉𝗅𝖺𝗒𝖾𝗋: ${stylize(getPlayerName(msg.from))}\n` +
      `  ⋆ 𝗋𝖾𝗌𝗎𝗅𝗍: ${stylize(profit)}$ [ ${stylize(status)} ]\n` +
      `  ⋆ 𝗐𝖺𝗅𝗅𝖾𝗍: ${stylize(finalMoney.toLocaleString())}$ Ი𐑼\n\n` +
      `┕━━━━━━━━━━━━━━>`;
    await response.editText(loading, finalUI);
  } catch (error) {
    console.error('bet: could not display game result:', error);
  }

  await setReaction(bot, msg, isWin ? '👹' : '🤡');
}
