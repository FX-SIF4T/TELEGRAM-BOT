import { creditBalance, debitBalance, getBalance } from '../../core/runtime/storage.js';

export const meta = {
  name: 'slot',
  version: '1.0',
  author: 'SIFAT',
  description: '🎰 𝖧𝗒𝗉𝖾𝗋-𝖲𝗅𝗈𝗍 𝖬𝖺𝖼𝗁𝗂𝗇𝖾 𝗐𝗂𝗍𝗁 𝖲𝗆𝖺𝗋𝗍 𝖡𝖺𝗅𝖺𝗇𝖼𝖾',
  prefix: 'both',
  category: 'game',
  role: 'normaluser',
  cooldown: 5,
  guide: ['<amount>', 'Supports: 50k, 1.5m, 2b, all']
};

const fonts = {
  a: 'A', b: 'ʙ', c: 'ᴄ', d: 'ᴅ', e: 'ᴇ', f: 'ꜰ', g: 'ɢ', h: 'ʜ', i: 'ɪ', j: 'ᴊ', k: 'ᴋ', l: 'ʟ', m: 'ᴍ',
  n: 'ɴ', o: 'ᴏ', p: 'ᴘ', q: 'ǫ', r: 'ʀ', s: 'ꜱ', t: 'ᴛ', u: 'ᴜ', v: 'ᴠ', w: 'ᴡ', x: 'x', y: 'ʏ', z: 'ᴢ',
  '0': '𝟎', '1': '𝟏', '2': '𝟐', '3': '𝟑', '4': '𝟒', '5': '𝟓', '6': '𝟔', '7': '𝟕', '8': '𝟖', '9': '𝟗',
  '.': '.', '+': '+', '-': '-'
};

const stylize = (text) => String(text).split('').map((character) => fonts[character] || character).join('');

export function formatSlotMoney(amount) {
  if (Math.abs(amount) >= 1.0e12) return (Math.abs(amount) / 1.0e12).toFixed(2) + 'T';
  if (Math.abs(amount) >= 1.0e9) return (Math.abs(amount) / 1.0e9).toFixed(2) + 'B';
  if (Math.abs(amount) >= 1.0e6) return (Math.abs(amount) / 1.0e6).toFixed(2) + 'M';
  if (Math.abs(amount) >= 1.0e3) return (Math.abs(amount) / 1.0e3).toFixed(2) + 'K';
  return Math.abs(amount).toFixed(0);
}

export function parseSlotBet(input, balance) {
  if (typeof input !== 'string' || !input.trim()) return 0;
  const value = input.trim().toLowerCase();
  if (value === 'all' || value === 'max') return balance;

  const amount = Number.parseFloat(value);
  if (!Number.isFinite(amount)) return Number.NaN;
  if (value.includes('t')) return amount * 1e12;
  if (value.includes('b')) return amount * 1e9;
  if (value.includes('m')) return amount * 1e6;
  if (value.includes('k')) return amount * 1e3;
  return amount;
}

export function getSlotPayout(first, second, third, bet) {
  if (first === second && second === third) {
    return { winnings: bet * 15, status: '💎 𝖩𝖠𝖢𝖪𝖯𝖮𝖳', multiplier: 15 };
  }
  if (first === second || first === third || second === third) {
    return { winnings: bet * 3, status: '✨ 𝖶𝖨𝖭', multiplier: 3 };
  }
  return { winnings: 0, status: '🦖 𝖫𝖮𝖲𝖲', multiplier: 0 };
}

export function rollSlot(symbols, bet, random = Math.random) {
  let first;
  let second;
  let third;
  const chance = random();

  if (chance < 0.15) {
    first = second = third = symbols[Math.floor(random() * symbols.length)];
  } else if (chance < 0.55) {
    first = second = symbols[Math.floor(random() * symbols.length)];
    const alternatives = symbols.filter((symbol) => symbol !== first);
    third = alternatives[Math.floor(random() * alternatives.length)];
  } else {
    const shuffled = [...symbols].sort(() => 0.5 - random());
    [first, second, third] = shuffled;
  }

  return {
    symbols: [first, second, third],
    ...getSlotPayout(first, second, third, bet)
  };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function onStart({ msg, args = [], response }) {
  const userId = msg?.from?.id;
  if (userId === undefined || userId === null) {
    return response.reply(`⚠️ ${stylize('Could not identify your account.')}`);
  }

  let balance;
  try {
    balance = await getBalance(userId);
  } catch (error) {
    console.error('slot: could not read wallet balance:', error);
    return response.reply(`⚠️ ${stylize('Wallet is unavailable.')}`);
  }

  const bet = parseSlotBet(args[0], balance);
  if (!Number.isFinite(bet) || !Number.isSafeInteger(bet)) {
    return response.reply(`⚠️ ${stylize('Invalid Amount.')}`);
  }
  if (bet < 50) return response.reply(`⚠️ ${stylize('Minimum bet is 50$')}`);
  if (bet > balance) {
    return response.reply(`💳 ${stylize('Insufficient Funds.')}\n${stylize('You have: ' + formatSlotMoney(balance))}`);
  }
  if (bet > Math.floor(Number.MAX_SAFE_INTEGER / 15)) {
    return response.reply(`⚠️ ${stylize('Invalid Amount.')}`);
  }

  let debit;
  try {
    debit = await debitBalance(userId, bet, 'slot-bet');
  } catch (error) {
    console.error('slot: could not place bet:', error);
    return response.reply(`⚠️ ${stylize('Wallet is unavailable.')}`);
  }
  if (!debit.ok) {
    return response.reply(`💳 ${stylize('Insufficient Funds.')}\n${stylize('You have: ' + formatSlotMoney(debit.balance ?? balance))}`);
  }

  const symbols = ['🇧🇩', '🇮🇩', '🏴‍☠️', '🇦🇷', '🇯🇵', '🇵🇰'];
  const result = rollSlot(symbols, bet);
  const [first, second, third] = result.symbols;
  const { winnings, status } = result;

  let finalBalance = debit.balance;
  if (winnings > 0) {
    try {
      const payout = await creditBalance(userId, winnings, 'slot-payout');
      finalBalance = payout.balance;
    } catch (error) {
      console.error('slot: payout failed:', error);
      try {
        await creditBalance(userId, bet, 'slot-refund');
        return response.reply(`⚠️ ${stylize('Game failed. Your bet was refunded.')}`);
      } catch (refundError) {
        console.error('slot: wager refund failed:', refundError);
        return response.reply(`⚠️ ${stylize('Game failed. Contact a developer.')}`);
      }
    }
  }

  try {
    const animation = await response.reply('｢ 🎰 ｣ 𝖲𝖸𝖲𝖳𝖤𝖬 𝖲𝖳𝖠𝖱𝖳...');
    const frames = [
      { symbols: ['🔄', '🔄', '🔄'], text: '𝗜𝗡𝗜𝗧𝗜𝗔𝗟𝗜𝗭𝗜𝗡𝗚' },
      { symbols: [symbols[1], symbols[4], '🔄'], text: '𝗦𝗬𝗡𝗖𝗛𝗥𝗢𝗡𝗜𝗭𝗜𝗡𝗚' },
      { symbols: ['🔄', symbols[0], symbols[5]], text: '𝗖𝗔𝗟𝗜𝗕𝗥𝗔𝗧𝗜𝗡𝗚' },
      { symbols: [first, second, third], text: '𝗖𝗢𝗠𝗣𝗟𝗘𝗧𝗘𝗗' }
    ];

    for (let index = 0; index < frames.length; index++) {
      await delay(1000);
      const isLast = index === frames.length - 1;
      const profitDisplay = isLast
        ? (winnings > 0 ? `+${formatSlotMoney(winnings)}` : `-${formatSlotMoney(bet)}`)
        : '---';
      const ui =
        `   ◢ ${stylize('SLOTS MACHINE')} ◣\n` +
        `╭───────────────╮\n` +
        `│    ${frames[index].symbols[0]}  │  ${frames[index].symbols[1]}  │  ${frames[index].symbols[2]}  │\n` +
        `╰───────────────╯\n` +
        `◈ 𝖲𝖳𝖠𝖳𝖴𝖲: ${isLast ? stylize(status) : stylize(frames[index].text)}\n` +
        `────────────────────\n` +
        `⌬ 𝖡𝖤𝖳 : ${stylize(formatSlotMoney(bet))}\n` +
        `⌬ 𝖶𝖨𝖭 : ${stylize(profitDisplay)}\n` +
        `⌬ 𝖡𝖠𝖫 : ${stylize(formatSlotMoney(finalBalance))}`;
      await response.editText(animation, ui);
    }
  } catch (error) {
    console.error('slot: could not display game result:', error);
  }
}
