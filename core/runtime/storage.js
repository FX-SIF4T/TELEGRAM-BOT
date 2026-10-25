import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workerPath = fileURLToPath(new URL('./database_worker.py', import.meta.url));
let activeConfig = null;
let initializationPromise = null;

function getConfig(settings = global.settings ?? {}) {
  const configured = settings.database ?? {};
  const type = String(configured.type ?? 'sqlite').toLowerCase();
  if (!['sqlite', 'mongodb', 'mongo'].includes(type)) {
    throw new Error('database.type must be "sqlite" or "mongodb".');
  }
  return {
    type,
    path: configured.path ?? 'data/bot.sqlite',
    name: configured.name ?? 'telegram_bot',
    uriEnv: configured.uriEnv ?? 'MONGODB_URI',
    uri: configured.uri ?? ''
  };
}

function runWorker(action, values = {}) {
  if (!activeConfig) {
    throw new Error('The database has not been initialized.');
  }

  return new Promise((resolve, reject) => {
    const python = process.env.PYTHON || 'python3';
    const child = spawn(python, [workerPath], {
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => reject(new Error(`Could not start the database worker: ${error.message}`)));
    child.on('close', (code) => {
      let response;
      try {
        response = JSON.parse(stdout);
      } catch {
        return reject(new Error(`Database worker returned invalid output${stderr ? `: ${stderr.trim()}` : ''}`));
      }
      if (code !== 0 || !response.success) {
        return reject(new Error(response.error ?? 'Database operation failed.'));
      }
      resolve(response.result);
    });
    child.stdin.end(JSON.stringify({ action, config: activeConfig, ...values }));
  });
}

export async function initializeStorage(settings = global.settings ?? {}) {
  activeConfig = getConfig(settings);
  initializationPromise = runWorker('init');
  await initializationPromise;
  return activeConfig.type;
}

async function ensureInitialized() {
  if (initializationPromise) {
    await initializationPromise;
    return;
  }
  await initializeStorage();
}

export async function getBalance(userId) {
  await ensureInitialized();
  const result = await runWorker('balance', { userId: String(userId) });
  return Number(result.balance);
}

export async function creditBalance(userId, amount, reason = 'admin-credit') {
  await ensureInitialized();
  const result = await runWorker('credit', {
    userId: String(userId),
    amount: Number(amount),
    reason
  });
  return result;
}

export async function debitBalance(userId, amount, reason = 'admin-debit') {
  await ensureInitialized();
  return runWorker('debit', {
    userId: String(userId),
    amount: Number(amount),
    reason
  });
}

export async function claimDailyReward(userId, {
  claimDate,
  maxClaims,
  coins,
  experience
} = {}) {
  await ensureInitialized();
  return runWorker('daily_reward', {
    userId: String(userId),
    claimDate: String(claimDate ?? ''),
    maxClaims: Number(maxClaims),
    coins: Number(coins),
    experience: Number(experience)
  });
}

export async function chargeCommand(userId, amount, collectorId, commandName) {
  await ensureInitialized();
  if (!collectorId) {
    throw new Error('Set feeCollectorUID in settings.json before enabling command fees.');
  }
  return runWorker('transfer', {
    userId: String(userId),
    amount: Number(amount),
    counterpartyId: String(collectorId),
    reason: `command:${commandName}`
  });
}

export async function refundCommandFee(userId, amount, collectorId, commandName) {
  await ensureInitialized();
  return runWorker('transfer', {
    userId: String(collectorId),
    amount: Number(amount),
    counterpartyId: String(userId),
    reason: `refund:${commandName}`
  });
}

export function getConfiguredDatabasePath() {
  const config = getConfig();
  return config.type === 'sqlite'
    ? path.resolve(process.cwd(), config.path)
    : null;
}
