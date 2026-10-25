// webview.js
import express from 'express';
import chalk from 'chalk';
import path from 'path';
import os from 'node:os';
import fs from 'fs-extra';
import session from 'express-session';
import TelegramBot from 'node-telegram-bot-api';
import { listen } from './listen.js';
import crypto from 'crypto';
import {
  allowTokenAccessAttempt,
  isDashboardPasswordConfigured,
  verifyDashboardPassword
} from './runtime/dashboard-auth.js';

export function webview(log) {
  console.log('');
  console.log(chalk.blue('LOADING SERVER SYSTEM'));
  const app = express();
  const port = process.env.PORT || 3000;
  app.disable("x-powered-by");
  app.set('trust proxy', 1);
  const sessionSecret = global.settings?.secret;
  if (typeof sessionSecret !== 'string' || !sessionSecret.trim()) {
    throw new Error('settings.secret is required for dashboard sessions.');
  }
  // Middleware
  app.use(express.json({ limit: '2kb' }));
  app.use(express.urlencoded({ extended: true, limit: '2kb' }));
  app.use(session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: 'auto',
      maxAge: 3600000
    }
  }));
  function tokenAuthCheck(req, res, next) {
    res.set('Cache-Control', 'no-store');
    if (req.session.tokensAuthenticated === true) return next();
    return res.status(401).json({ error: 'Unlock token management to continue.' });
  }
  // Define paths
  const dashboardPath = path.join(process.cwd(), 'core', 'dashboard', 'index.html');
  const commonJsPath = path.join(process.cwd(), 'core', 'dashboard', 'common.js');
  const commonCssPath = path.join(process.cwd(), 'core', 'dashboard', 'common.css');
  const dashboardCssPath = path.join(process.cwd(), 'core', 'dashboard', 'dashboard.css');
  // Routes
  app.get('/', (req, res) => {
    res.redirect('/dashboard.html');
  });
  app.get('/dashboard.html', (req, res) => {
    res.sendFile(dashboardPath);
  });
  app.get('/commands.html', (req, res) => {
    res.sendFile(dashboardPath);
  });
  app.get('/events.html', (req, res) => {
    res.sendFile(dashboardPath);
  });
  app.get('/tokens.html', (req, res) => {
    res.sendFile(dashboardPath);
  });
  app.get('/common.js', (req, res) => {
    res.sendFile(commonJsPath);
  });
  app.get('/common.css', (req, res) => {
    res.sendFile(commonCssPath);
  });
  app.get('/dashboard.css', (req, res) => {
    res.sendFile(dashboardCssPath);
  });

  const tokenAccessAttempts = new Map();
  function checkTokenAccessRateLimit(req, res) {
    const address = req.ip || req.socket?.remoteAddress || 'unknown';
    const attempt = allowTokenAccessAttempt(tokenAccessAttempts, address);
    if (!attempt.allowed) {
      res.set('Retry-After', String(attempt.retryAfterSeconds));
      res.status(429).json({ success: false, error: 'Too many attempts. Try again later.' });
      return false;
    }
    if (tokenAccessAttempts.size > 1000) {
      const now = Date.now();
      for (const [key, value] of tokenAccessAttempts) {
        if (value.resetAt <= now) tokenAccessAttempts.delete(key);
      }
    }
    return true;
  }

  function clearTokenAccessRateLimit(req) {
    const address = req.ip || req.socket?.remoteAddress || 'unknown';
    tokenAccessAttempts.delete(address);
  }

  function establishTokenSession(req, res) {
    req.session.regenerate((error) => {
      if (error) {
        console.error('Could not create token-management session:', error);
        return res.status(500).json({ success: false, error: 'Could not unlock token management.' });
      }
      req.session.tokensAuthenticated = true;
      return res.json({ success: true });
    });
  }

  app.get('/api/tokens/auth-status', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
      passwordConfigured: isDashboardPasswordConfigured(global.settings?.dashboardPass),
      authorized: req.session.tokensAuthenticated === true
    });
  });

  app.post('/api/tokens/authenticate', (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!checkTokenAccessRateLimit(req, res)) return;
    const configuredPassword = global.settings?.dashboardPass;
    if (!isDashboardPasswordConfigured(configuredPassword)) {
      return res.status(503).json({ success: false, error: 'Set dashboardPass in settings.json and restart the bot.' });
    }
    if (!verifyDashboardPassword(configuredPassword, req.body?.password)) {
      return res.status(401).json({ success: false, error: 'Incorrect token-management password.' });
    }
    clearTokenAccessRateLimit(req);
    return establishTokenSession(req, res);
  });

  app.post('/api/tokens/lock', (req, res) => {
    req.session.tokensAuthenticated = false;
    req.session.save((error) => {
      if (error) return res.status(500).json({ success: false, error: 'Could not lock token management.' });
      return res.json({ success: true });
    });
  });

  // API Endpoints
  // Bot information endpoint
  app.get("/api/bot-info", (req, res) => {
    try {
      const tokens = global.states.tokens || [];
      const commands = Array.from(global.esha.commands.values()).map(cmd => ({
        name: cmd.meta.name,
        aliases: cmd.meta.aliases || [],
        description: cmd.meta.description || 'No description',
        usage: cmd.meta.usage || `${global.settings.prefix}${cmd.meta.name}`,
        category: cmd.meta.category || 'general'
      }));
      const events = Array.from(global.esha.events.values()).map(evt => ({
        name: evt.meta.name,
        description: evt.meta.description || 'No description'
      }));
      res.json({
        botCount: tokens.length,
        activeBotCount: Array.isArray(global.bots) ? global.bots.filter(Boolean).length : 0,
        commandCount: commands.length,
        eventCount: events.length,
        settings: {
          prefix: global.settings.prefix,
          developer: global.settings.developer,
          timezone: global.settings.timeZone
        },
        memory: {
          usedBytes: process.memoryUsage().rss,
          totalBytes: os.totalmem(),
          usedPercent: Math.min(100, Math.round((process.memoryUsage().rss / os.totalmem()) * 100))
        },
        uptime: {
          seconds: process.uptime(),
          human: convertTime(process.uptime() * 1000)
        }
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  let dashboardAvatarBuffer = null;
  let dashboardAvatarExpiresAt = 0;
  const tokenAvatarCache = new Map();
  app.get('/api/bot-avatar', async (req, res) => {
    if (dashboardAvatarBuffer && dashboardAvatarExpiresAt > Date.now()) {
      return res
        .set('Cache-Control', 'private, max-age=3600')
        .type('image/jpeg')
        .send(dashboardAvatarBuffer);
    }

    const bot = global.bots?.[0];
    if (
      !bot ||
      typeof bot.getMe !== 'function' ||
      typeof bot.getUserProfilePhotos !== 'function' ||
      typeof bot.getFileStream !== 'function'
    ) {
      return res.status(204).set('Cache-Control', 'no-store').end();
    }

    try {
      const me = await bot.getMe();
      const profile = await bot.getUserProfilePhotos(me.id, { limit: 1 });
      const photoSizes = profile?.photos?.[0] ?? [];
      const photo = photoSizes.reduce((largest, candidate) => {
        const candidateSize = Number(candidate.file_size ?? candidate.width * candidate.height ?? 0);
        const largestSize = Number(largest?.file_size ?? largest?.width * largest?.height ?? 0);
        return candidateSize > largestSize ? candidate : largest;
      }, null);
      if (!photo?.file_id) return res.status(204).set('Cache-Control', 'no-store').end();

      const stream = bot.getFileStream(photo.file_id);
      const chunks = [];
      let totalBytes = 0;
      for await (const chunk of stream) {
        const data = Buffer.from(chunk);
        totalBytes += data.length;
        if (totalBytes > 5 * 1024 * 1024) {
          stream.destroy?.();
          throw new Error('Telegram profile photo exceeds the size limit.');
        }
        chunks.push(data);
      }

      dashboardAvatarBuffer = Buffer.concat(chunks);
      if (!dashboardAvatarBuffer.length) {
        dashboardAvatarBuffer = null;
        return res.status(204).set('Cache-Control', 'no-store').end();
      }
      dashboardAvatarExpiresAt = Date.now() + 60 * 60 * 1000;

      return res
        .set('Cache-Control', 'private, max-age=3600')
        .type('image/jpeg')
        .send(dashboardAvatarBuffer);
    } catch (error) {
      console.error('Failed to load dashboard bot avatar:', error);
      return res.status(502).end();
    }
  });
  // Commands endpoint
  app.get("/api/commands", (req, res) => {
    try {
      const commands = Array.from(global.esha.commands.values()).map(cmd => ({
        name: cmd.meta.name,
        aliases: cmd.meta.aliases || [],
        description: cmd.meta.description || 'No description',
        usage: cmd.meta.usage || `${global.settings.prefix}${cmd.meta.name}`,
        category: cmd.meta.category || 'general',
        cooldown: cmd.meta.cooldown || 0
      }));
      // Group by category
      const grouped = commands.reduce((acc, cmd) => {
        const cat = cmd.category;
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(cmd);
        return acc;
      }, {});
      res.json({ commands: grouped, total: commands.length });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  // Events endpoint
  app.get("/api/events", (req, res) => {
    try {
      const events = Array.from(global.esha.events.values()).map(evt => ({
        name: evt.meta.name,
        description: evt.meta.description || 'No description',
        type: evt.meta.type || 'message'
      }));
      res.json({ events, total: events.length });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  // Token management
  app.get('/api/token-avatar/:index', tokenAuthCheck, async (req, res) => {
    const index = Number.parseInt(req.params.index, 10);
    if (!Number.isInteger(index) || index < 0 || index >= global.states.tokens.length) {
      return res.status(404).end();
    }

    const bot = global.bots?.[index];
    if (!bot || typeof bot.getMe !== 'function' || typeof bot.getUserProfilePhotos !== 'function' || typeof bot.getFileStream !== 'function') {
      return res.status(404).end();
    }

    const token = global.states.tokens[index];
    const cacheKey = crypto.createHash('sha256').update(String(token)).digest('hex');
    const cached = tokenAvatarCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return res.set('Cache-Control', 'private, max-age=3600').type('image/jpeg').send(cached.buffer);
    }

    try {
      const me = await bot.getMe();
      const profile = await bot.getUserProfilePhotos(me.id, { limit: 1 });
      const sizes = profile?.photos?.[0] ?? [];
      const photo = sizes.reduce((largest, candidate) => {
        const candidateSize = Number(candidate.file_size ?? candidate.width * candidate.height ?? 0);
        const largestSize = Number(largest?.file_size ?? largest?.width * largest.height ?? 0);
        return candidateSize > largestSize ? candidate : largest;
      }, null);
      if (!photo?.file_id) return res.status(404).end();

      const stream = bot.getFileStream(photo.file_id);
      const chunks = [];
      let totalBytes = 0;
      for await (const chunk of stream) {
        const data = Buffer.from(chunk);
        totalBytes += data.length;
        if (totalBytes > 5 * 1024 * 1024) {
          stream.destroy?.();
          throw new Error('Telegram profile photo exceeds the size limit.');
        }
        chunks.push(data);
      }
      const buffer = Buffer.concat(chunks);
      if (!buffer.length) return res.status(404).end();
      tokenAvatarCache.set(cacheKey, { buffer, expiresAt: Date.now() + 60 * 60 * 1000 });
      return res.set('Cache-Control', 'private, max-age=3600').type('image/jpeg').send(buffer);
    } catch (error) {
      console.error(`Failed to load dashboard bot avatar for instance ${index + 1}:`, error);
      return res.status(502).end();
    }
  });

  app.get("/api/tokens", tokenAuthCheck, async (req, res) => {
    try {
      const tokensInfo = await Promise.all(global.states.tokens.map(async (token, index) => {
        const bot = global.bots[index];
        let botName = `Bot Instance ${index + 1}`;
        let avatarUrl = null;
        try {
          const me = await bot.getMe();
          botName = me.username ? `@${me.username}` : me.first_name || botName;
          const photos = await bot.getUserProfilePhotos(me.id, { limit: 1 });
          if (photos?.total_count > 0 && photos.photos?.[0]?.length) {
            avatarUrl = `/api/token-avatar/${index}`;
          }
        } catch (err) {
          console.error(`Error fetching info for bot ${index}:`, err);
        }
        return {
          id: index,
          token: token.substring(0, 20) + '...' + token.slice(-10),
          fullToken: req.session.tokensAuthenticated ? token : undefined,
          botName,
          avatarUrl
        };
      }));
      res.json({ tokens: tokensInfo, isAuthorized: req.session.tokensAuthenticated === true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  app.post("/api/tokens", tokenAuthCheck, async (req, res) => {
    const { token } = req.body;
    if (typeof token !== 'string' || !/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
      return res.status(400).json({ error: 'Invalid token format' });
    }
    try {
      global.states.tokens.push(token);
      await fs.writeJson(global.settingsPath, global.settings, { spaces: 2 });
      tokenAvatarCache.clear();
      // Dynamically initialize new bot
      const newBot = new TelegramBot(token, { polling: true });
      newBot.index = global.bots.length;
      newBot.totalBots = global.bots.length + 1;
      listen(newBot, log);
      global.bots.push(newBot);
      // Update totalBots on existing bots
      global.bots.forEach(b => {
        b.totalBots = global.bots.length;
      });
      res.json({ success: true, message: 'Token added and bot session refreshed successfully.' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  app.delete("/api/tokens/:index", tokenAuthCheck, async (req, res) => {
    const index = parseInt(req.params.index);
    if (isNaN(index) || index < 0 || index >= global.states.tokens.length) {
      return res.status(400).json({ error: 'Invalid token index' });
    }
    try {
      // Stop and remove bot
      const botToRemove = global.bots[index];
      if (botToRemove) {
        botToRemove.stopPolling();
      }
      global.bots.splice(index, 1);
      // Update indices and totalBots
      global.bots.forEach((b, i) => {
        b.index = i;
        b.totalBots = global.bots.length;
      });
      global.states.tokens.splice(index, 1);
      await fs.writeJson(global.settingsPath, global.settings, { spaces: 2 });
      tokenAvatarCache.clear();
      res.json({ success: true, message: 'Token removed and bot session refreshed successfully.' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  app.post("/api/restart", tokenAuthCheck, (req, res) => {
    res.json({ message: 'Restarting bot...' });
    setTimeout(() => {
      process.exit(0);
    }, 2000);
  });
  // Health check
  app.get("/health", (req, res) => {
    res.status(200).json({ status: "UP" });
  });
  // Uptime
  app.get("/uptime", (req, res) => {
    res.json({
      uptime: process.uptime(),
      uptimeHuman: convertTime(process.uptime() * 1000)
    });
  });
  // Start server
  app.locals.server = app.listen(port, "0.0.0.0", () => {
    log.esha(`Esha Bot server is running on port ${port}`, 'esha');
  });
  return app;
}
function convertTime(ms) {
  const sec = Math.floor((ms / 1000) % 60);
  const min = Math.floor((ms / (1000 * 60)) % 60);
  const hr = Math.floor((ms / (1000 * 60 * 60)) % 24);
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  return `${days}d ${hr}h ${min}m ${sec}s`;
}