// main.js
import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import * as log from './runtime/utilities.js';
import { login } from './runtime/bot.js';
import { listen } from './listen.js';
import { webview } from './webview.js';
import { initializeStorage } from './runtime/storage.js';
import { startGitHubAutoPush } from './runtime/github.js';
console.log(chalk.blue('LOADING MAIN SYSTEM'));
const settingsPath = path.join(process.cwd(), 'settings.json');
let settings, vip, api, states;
try {
  settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  if (process.env.SESSION_SECRET?.trim()) {
    settings.secret = process.env.SESSION_SECRET.trim();
  }
  if (process.env.DASHBOARD_PASSWORD?.trim()) {
    settings.dashboardPass = process.env.DASHBOARD_PASSWORD.trim();
  }
  if (settings.api && typeof settings.api === 'object' && !Array.isArray(settings.api)) {
    api = settings.api;
    log.esha('Loaded API endpoints from settings.json', 'esha');
  } else {
    api = {};
    log.default('No API endpoints are configured; API-backed commands will be unavailable.', 'warn');
  }
  vip = settings.vip;
  states = settings.bots;
  if (!vip || !Array.isArray(vip.uid)) {
    throw new Error('settings.json must contain a vip.uid array');
  }
  if (!states || !Array.isArray(states.tokens)) {
    throw new Error('settings.json must contain a bots.tokens array');
  }
  log.esha('Loaded settings.json configuration', 'esha');
  console.log('');
} catch (error) {
  console.error(`Error loading configuration files: ${error.message}`);
  process.exit(1);
}
global.settingsPath = settingsPath;
global.settings = settings;
global.vip = vip;
global.api = api;
global.states = states;
global.esha = {
  commands: new Map(),
  cooldowns: new Map(),
  replies: new Map(),
  callbacks: new Map(),
  events: new Map(),
  instances: new Map()
};
// Initialize everything
(async () => {
  try {
    await log.loadMessages();
    const databaseType = await initializeStorage(settings);
    log.esha(`Connected to ${databaseType} database`, 'esha');
    await log.scripts(log);
    global.scripts = log.scripts;
    startGitHubAutoPush();
    global.bots = await login(log, listen);
    webview(log);
  } catch (error) {
    log.default(`Error during initialization: ${error.message}`, 'err');
    console.error(error);
    process.exit(1);
  }
})();