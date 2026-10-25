import { isConfiguredBotDeveloper } from '../../core/runtime/access.js';

export const meta = {
  name: 'dashboard',
  version: '1.0.0',
  aliases: [],
  description: 'Show the Esha Bot dashboard address and access instructions',
  author: 'SIFAT',
  prefix: 'both',
  category: 'Utility',
  type: 'anyone',
  role: 'developer',
  cooldown: 5,
  guide: ['Show dashboard access instructions']
};

function detectHostingUrl() {
  if (process.env.VERCEL || process.env.VERCEL_ENV) {
    return `https://${process.env.VERCEL_URL}`;
  }
  if (process.env.RENDER) {
    return process.env.RENDER_EXTERNAL_URL;
  }
  if (process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_STATIC_URL) {
    return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  }
  if (process.env.DATABASE_URL && process.env.PORT && process.env.HEROKU_APP_NAME) {
    return `https://${process.env.HEROKU_APP_NAME}.herokuapp.com`;
  }
  if (process.env.AWS_EXECUTION_ENV || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return 'AWS - URL not automatically available';
  }
  if (process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT) {
    return 'Google Cloud - URL not automatically available';
  }
  if (process.env.AZURE_WEBJOBS_STORAGE || process.env.WEBSITE_SITE_NAME) {
    return `https://${process.env.WEBSITE_HOSTNAME}`;
  }
  if (process.env.K_SERVICE || process.env.K_REVISION) {
    return `https://${process.env.K_SERVICE}-dot-${process.env.K_REVISION}.run.app`;
  }
  if (process.env.NOW_BUILDER) {
    return `https://${process.env.VERCEL_URL}`;
  }
  if (process.env.NETLIFY) {
    return process.env.URL;
  }
  if (process.env.FLY_APP_NAME) {
    return `https://${process.env.FLY_APP_NAME}.fly.dev`;
  }
  if (process.env.DENO_DEPLOYMENT_ID) {
    return 'Deno Deploy - URL requires project name';
  }
  if (process.env.REPLIT_DOMAINS) {
    const domains = process.env.REPLIT_DOMAINS.split(',');
    return `https://${domains[0]}`;
  }
  if (process.cwd().startsWith('/home/container') || process.env.HOME === '/home/container') {
    return process.env.APP_URL || 'PTERODACTYL';
  }
  return 'Local or Unknown - No URL available';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;'
  })[character]);
}

export async function onStart({ bot, msg, args, response, usages }) {
  try {
    const userId = String(msg.from?.id ?? '');
    const isDev = isConfiguredBotDeveloper(
      userId,
      msg.from?.username,
      global.settings
    );
    if (!isDev) return response.reply('Only bot developers can access the dashboard.');

    const hosting = detectHostingUrl();
    const safeHosting = escapeHtml(hosting);
    const hostingText = /^https?:\/\//.test(hosting)
      ? `<a href="${safeHosting}">${safeHosting}</a>`
      : `<i>${safeHosting}</i>`;
    return response.reply(
      `🔗 <b>Esha Bot Dashboard</b>\n\n${hostingText}\n\nThe dashboard, commands, and events are open normally. Bot token viewing and changes require the password configured as <code>dashboardPass</code> in settings.json.`,
      { parse_mode: 'HTML' }
    );
  } catch (error) {
    console.error('Dashboard link command failed:', error);
    return response.reply('Could not show the dashboard address. Please check the dashboard configuration.');
  }
}