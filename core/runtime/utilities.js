import fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import chalk from 'chalk';
import { normalizeAccessRole } from './access.js';

const settingsPath = path.join(process.cwd(), 'settings.json');
const cacheDir = path.join(process.cwd(), 'bot-cmds', 'temp');
const messagesPath = path.join(process.cwd(), 'core', 'massages.txt');
const requiredLogLabels = ['esha', 'load', 'dev', 'err', 'warn', 'cmd', 'evnts'];
const cacheCleanupDelay = 30000;
const cacheWatchRetryDelay = 5000;

let cachedLogConfig;
let systemMessages = new Map();
let messageWatcher;
let messageReloadTimer;
let cacheReady;
let cacheWatcher;
let cacheWatcherStart;
let cacheCleanupTimer;
let cacheRetryTimer;
let moduleLoadSequence = 0;
let scriptsQueue = Promise.resolve();

function watchMessagesFile() {
  if (messageWatcher) return;

  try {
    messageWatcher = fs.watch(path.dirname(messagesPath), (eventType, filename) => {
      if (String(filename ?? '') !== path.basename(messagesPath)) return;

      clearTimeout(messageReloadTimer);
      messageReloadTimer = setTimeout(() => {
        loadMessages().catch((error) => {
          console.error(`Could not reload core/massages.txt: ${error.message}`);
        });
      }, 200);
      messageReloadTimer.unref?.();
    });

    messageWatcher.on('error', (error) => {
      console.error(`Message file watcher error: ${error.message}`);
      messageWatcher.close();
      messageWatcher = null;
    });
  } catch (error) {
    console.error(`Could not watch core/massages.txt: ${error.message}`);
  }
}

export async function loadMessages() {
  const content = await fsPromises.readFile(messagesPath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`Invalid core/massages.txt JSON: ${error.message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('core/massages.txt must contain a JSON object of system message keys and text.');
  }

  const entries = Object.entries(parsed);
  for (const [key, value] of entries) {
    if (!key.trim() || typeof value !== 'string') {
      throw new Error('Each core/massages.txt entry must have a non-empty key and a string value.');
    }
  }

  systemMessages = new Map(entries);
  watchMessagesFile();
  return systemMessages.size;
}

export function getMessage(key, values = {}) {
  if (typeof key !== 'string' || !systemMessages.has(key)) {
    throw new Error(`Unknown bot system message key: ${String(key)}`);
  }

  return systemMessages.get(key).replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (placeholder, name) => {
    if (!Object.hasOwn(values, name)) {
      throw new Error(`Missing "${name}" value for bot system message "${key}".`);
    }
    return String(values[name]);
  });
}

function getLogConfig() {
  if (cachedLogConfig) return cachedLogConfig;

  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  const config = settings.logging;
  const missingLabels = requiredLogLabels.filter(
    (label) => typeof config?.[label] !== 'string' || !config[label].trim()
  );

  if (missingLabels.length) {
    throw new Error(`settings.json logging section is missing labels: ${missingLabels.join(', ')}`);
  }

  cachedLogConfig = config;
  return cachedLogConfig;
}

function writeLog(label, message, color = 'blue', method = 'log') {
  console[method](`${chalk[color](label)} - ${message}`);
}

export default function log(message, type = 'load') {
  const config = getLogConfig();
  const label = config[type] ?? (type === 'login' ? config.esha : config.load);
  const color = type === 'err' ? 'red' : type === 'warn' ? 'yellow' : 'blue';
  const method = type === 'err' ? 'error' : type === 'warn' ? 'warn' : 'log';

  writeLog(label, message, color, method);
}

export function esha(message) {
  writeLog(getLogConfig().esha, message);
}

export function commands(message) {
  writeLog(getLogConfig().cmd, message);
}

export function events(message) {
  writeLog(getLogConfig().evnts, message);
}

export function dev(message) {
  writeLog(getLogConfig().dev, message);
}

export function error(message) {
  writeLog(getLogConfig().err, message, 'red', 'error');
}

export function database(message) {
  writeLog('database', message);
}

export function update(message) {
  writeLog('update', message);
}

export function backup(message) {
  writeLog('backup', message);
}

export function download(message) {
  writeLog('download', message);
}

export function install(message) {
  writeLog('install', message);
}

export async function create() {
  await fsPromises.mkdir(cacheDir, { recursive: true });
}

export async function clear() {
  await create();

  const entries = await fsPromises.readdir(cacheDir, { withFileTypes: true });
  if (!entries.length) return 0;

  const results = await Promise.allSettled(
    entries.map((entry) =>
      fsPromises.rm(path.join(cacheDir, entry.name), { recursive: true, force: true })
    )
  );
  const failures = results.filter((result) => result.status === 'rejected');
  const clearedCount = results.length - failures.length;

  for (const failure of failures) {
    console.error(`Error clearing cache entry: ${failure.reason?.message ?? failure.reason}`);
  }

  if (clearedCount) console.log(`${clearedCount} cache entries cleared`);
  return clearedCount;
}

function scheduleCacheWatchRetry() {
  if (cacheRetryTimer) return;

  cacheRetryTimer = setTimeout(() => {
    cacheRetryTimer = null;
    void startCacheWatcher();
  }, cacheWatchRetryDelay);
  cacheRetryTimer.unref?.();
}

function scheduleCacheCleanup() {
  clearTimeout(cacheCleanupTimer);
  cacheCleanupTimer = setTimeout(async () => {
    try {
      const entries = await fsPromises.readdir(cacheDir);
      if (entries.length) {
        console.log(`${entries.length} cache entries detected. Clearing now.`);
        await clear();
      }
    } catch (error) {
      console.error(`Error reading cache directory: ${error.message}`);
    }
  }, cacheCleanupDelay);
  cacheCleanupTimer.unref?.();
}

async function startCacheWatcher() {
  if (cacheWatcher) return cacheWatcher;
  if (cacheWatcherStart) return cacheWatcherStart;

  cacheWatcherStart = (async () => {
    await create();

    try {
      const watcher = fs.watch(cacheDir, (eventType, filename) => {
        if (eventType === 'rename' && filename) scheduleCacheCleanup();
      });

      cacheWatcher = watcher;
      watcher.on('error', (error) => {
        console.error(`Cache watcher error: ${error.message}. Restarting watcher.`);
        watcher.close();
        if (cacheWatcher === watcher) cacheWatcher = null;
        scheduleCacheWatchRetry();
      });

      return watcher;
    } catch (error) {
      console.error(`Error setting up cache watcher: ${error.message}`);
      scheduleCacheWatchRetry();
      return null;
    }
  })();

  try {
    return await cacheWatcherStart;
  } finally {
    cacheWatcherStart = null;
  }
}

export async function watch() {
  return startCacheWatcher();
}

async function initializeCache() {
  if (!cacheReady) {
    cacheReady = (async () => {
      await create();
      await clear();
      await startCacheWatcher();
    })();
  }

  return cacheReady;
}

function validateModule(module, moduleType) {
  if (!module || typeof module !== 'object') {
    throw new Error('No valid module export found');
  }

  if (!module.meta || typeof module.meta !== 'object') {
    throw new Error('Missing meta property in module');
  }

  const { name } = module.meta;
  if (typeof name !== 'string' || !name.trim() || name !== name.trim()) {
    throw new Error('Missing or invalid meta.name in module');
  }

  if (typeof module.onStart !== 'function') {
    throw new Error('Missing or invalid onStart method in module');
  }

  if (moduleType === 'command') {
    if (module.meta.role !== undefined && !normalizeAccessRole(module.meta.role)) {
      throw new Error('Invalid meta.role in command module');
    }

    const aliases = module.meta.aliases ?? [];
    if (
      !Array.isArray(aliases) ||
      !aliases.every((alias) => typeof alias === 'string' && alias.trim() === alias && alias.length)
    ) {
      throw new Error('Invalid meta.aliases in command module');
    }

    const identifiers = [name, ...aliases].map((identifier) => identifier.toLowerCase());
    if (new Set(identifiers).size !== identifiers.length) {
      throw new Error('Command name and aliases must be unique');
    }
  }
}

function errorLogger(logger, message) {
  if (typeof logger?.error === 'function') {
    logger.error(message);
  } else {
    console.error(message);
  }
}

async function loadDirectory(directory, moduleType, collection, logger) {
  const errors = {};
  const usedIdentifiers = new Set();
  const logSuccess = moduleType === 'command' ? logger.commands : logger.events;
  const loadingMessage = moduleType === 'command' ? 'LOADING COMMANDS' : 'LOADING EVENTS';

  console.log(chalk.blue(loadingMessage));

  try {
    const files = (await fsPromises.readdir(directory))
      .filter((file) => file.endsWith('.js'))
      .sort((left, right) => left.localeCompare(right));

    for (const file of files) {
      try {
        const modulePath = path.join(directory, file);
        const moduleUrl = pathToFileURL(modulePath);
        moduleUrl.searchParams.set('update', `${Date.now()}-${moduleLoadSequence++}`);
        const loadedModule = await import(moduleUrl.href);
        const moduleExport = loadedModule.default || loadedModule;

        validateModule(moduleExport, moduleType);

        const aliases = moduleType === 'command' ? moduleExport.meta.aliases ?? [] : [];
        const identifiers = [moduleExport.meta.name, ...aliases];
        const duplicate = identifiers.find((identifier) =>
          usedIdentifiers.has(identifier.toLowerCase())
        );

        if (duplicate) {
          throw new Error(`Duplicate ${moduleType} name or alias "${duplicate}"`);
        }

        for (const identifier of identifiers) {
          usedIdentifiers.add(identifier.toLowerCase());
        }

        collection.set(moduleExport.meta.name, moduleExport);
        if (typeof logSuccess === 'function') logSuccess(`Loaded "${moduleExport.meta.name}"`);
      } catch (error) {
        const errorMessage = `Error loading ${moduleType} "${file}": ${error.message}`;
        errorLogger(logger, errorMessage);
        errors[file] = error;
      }
    }
  } catch (error) {
    const errorMessage = `Error reading ${moduleType} directory "${directory}": ${error.message}`;
    errorLogger(logger, errorMessage);
    errors.directory = error;
  }

  return errors;
}

async function loadScripts(logger) {
  await initializeCache();

  const activeLogger = logger ?? { commands, events, error };
  if (!global.esha || typeof global.esha !== 'object') global.esha = {};
  if (!(global.esha.commands instanceof Map)) global.esha.commands = new Map();
  if (!(global.esha.events instanceof Map)) global.esha.events = new Map();

  const commandsPath = path.join(process.cwd(), 'bot-cmds', 'commands');
  const eventsPath = path.join(process.cwd(), 'bot-cmds', 'events');

  global.esha.commands.clear();
  global.esha.events.clear();

  const commandErrors = await loadDirectory(
    commandsPath,
    'command',
    global.esha.commands,
    activeLogger
  );
  if (typeof activeLogger.commands === 'function') {
    activeLogger.commands(`Loaded ${global.esha.commands.size} commands successfully`);
  }
  console.log('');

  const eventErrors = await loadDirectory(
    eventsPath,
    'event',
    global.esha.events,
    activeLogger
  );
  if (typeof activeLogger.events === 'function') {
    activeLogger.events(`Loaded ${global.esha.events.size} events successfully`);
  }

  const errors = { ...commandErrors, ...eventErrors };
  if (Object.keys(errors).length) {
    const summary = Object.fromEntries(
      Object.entries(errors).map(([file, error]) => [
        file,
        error instanceof Error ? error.message : String(error)
      ])
    );
    errorLogger(activeLogger, `Errors occurred during module loading: ${JSON.stringify(summary, null, 2)}`);
  }

  return Object.keys(errors).length ? errors : false;
}

export function scripts(logger) {
  const currentRun = scriptsQueue.then(
    () => loadScripts(logger),
    () => loadScripts(logger)
  );
  scriptsQueue = currentRun.catch(() => undefined);
  return currentRun;
}
