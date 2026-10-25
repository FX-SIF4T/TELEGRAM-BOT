export const ACCESS_ROLES = Object.freeze([
  'normaluser',
  'premiumuser',
  'admin',
  'developer'
]);

const ROLE_RANK = new Map(ACCESS_ROLES.map((role, index) => [role, index]));
const groupAdminCache = new Map();

const ROLE_ALIASES = new Map([
  ['normaluser', 'normaluser'],
  ['normal', 'normaluser'],
  ['user', 'normaluser'],
  ['anyone', 'normaluser'],
  ['premiumuser', 'premiumuser'],
  ['premium', 'premiumuser'],
  ['vip', 'premiumuser'],
  ['admin', 'admin'],
  ['administrator', 'admin'],
  ['developer', 'developer'],
  ['dev', 'developer']
]);

const LEGACY_TYPE_ROLES = new Map([
  ['dev', 'developer'],
  ['vip', 'premiumuser'],
  ['administrator', 'admin']
]);

export function normalizeAccessRole(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.toLowerCase().replace(/[\s_-]/g, '');
  return ROLE_ALIASES.get(normalized) ?? null;
}

export function getRequiredAccessRole(meta = {}) {
  const explicitRole = normalizeAccessRole(meta.role);
  const commandType = typeof meta.type === 'string' ? meta.type.toLowerCase() : '';
  const legacyRole = LEGACY_TYPE_ROLES.get(commandType) ?? normalizeAccessRole(commandType);

  if (!explicitRole) return legacyRole ?? 'normaluser';
  if (!legacyRole) return explicitRole;
  return ROLE_RANK.get(explicitRole) >= ROLE_RANK.get(legacyRole)
    ? explicitRole
    : legacyRole;
}

function normalizeIds(value) {
  const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return new Set(values.map((entry) => String(entry).trim()).filter(Boolean));
}

function normalizeUsernames(value) {
  const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return new Set(values
    .map((entry) => String(entry).trim().replace(/^@/, '').toLowerCase())
    .filter((entry) => /^[a-z][a-z0-9_]{4,31}$/.test(entry)));
}

export function isConfiguredBotDeveloper(userId, username, settings = {}) {
  const normalizedId = String(userId ?? '').trim();
  const normalizedUsername = String(username ?? '').trim().replace(/^@/, '').toLowerCase();

  return (normalizedId && normalizeIds(settings.devID).has(normalizedId)) ||
    (normalizedUsername && normalizeUsernames(settings.devUsername).has(normalizedUsername)) ||
    false;
}

export function isAnonymousGroupSender({ senderChat, chatType } = {}) {
  return ['group', 'supergroup'].includes(chatType) &&
    senderChat !== undefined &&
    senderChat !== null;
}

export function getUserAccessRole({
  userId,
  username,
  settings = {},
  vip = {},
  isTelegramGroupAdmin = false
} = {}) {
  const id = String(userId ?? '');
  if (isConfiguredBotDeveloper(id, username, settings)) return 'developer';
  if (normalizeIds(settings.admin?.uid).has(id) || isTelegramGroupAdmin) return 'admin';
  const vipEnabled = settings.vip?.enabled !== false && vip.enabled !== false;
  const vipIds = new Set([
    ...(vipEnabled ? normalizeIds(vip.uid) : []),
    ...(vipEnabled ? normalizeIds(settings.vip?.uid) : [])
  ]);
  if (vipIds.has(id)) return 'premiumuser';
  return 'normaluser';
}

export async function hasBotUsageAccess({
  bot,
  userId,
  username,
  chatId,
  chatType,
  senderChat,
  settings = global.settings ?? {},
  vip = global.vip ?? {}
} = {}) {
  if (settings.devOnly === true) {
    return !isAnonymousGroupSender({ senderChat, chatType }) &&
      isConfiguredBotDeveloper(userId, username, settings);
  }
  if (settings.adminOnly !== true) return true;
  if (isAnonymousGroupSender({ senderChat, chatType })) return false;

  const userRole = getUserAccessRole({ userId, username, settings, vip });
  if (hasAccessRole(userRole, 'admin')) return true;

  if (
    userId === undefined ||
    userId === null ||
    chatId === undefined ||
    !['group', 'supergroup'].includes(chatType) ||
    typeof bot?.getChatMember !== 'function'
  ) {
    return false;
  }

  const cacheKey = `${chatId}:${userId}`;
  const now = Date.now();
  const cached = groupAdminCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.isAdmin;

  return isTelegramGroupAdmin(bot, chatId, userId);
}

function cacheGroupAdmin(cacheKey, isAdmin, now = Date.now()) {
  for (const [key, entry] of groupAdminCache) {
    if (entry.expiresAt <= now) groupAdminCache.delete(key);
  }
  if (groupAdminCache.size > 2000) groupAdminCache.clear();
  groupAdminCache.set(cacheKey, {
    isAdmin,
    expiresAt: now + (isAdmin ? 15000 : 5000)
  });
}

export async function isTelegramGroupAdmin(bot, chatId, userId) {
  if (
    userId === undefined ||
    userId === null ||
    chatId === undefined ||
    chatId === null ||
    typeof bot?.getChatMember !== 'function'
  ) return false;

  const cacheKey = `${chatId}:${userId}`;
  const now = Date.now();
  const cached = groupAdminCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.isAdmin;

  let isAdmin = false;
  try {
    const member = await bot.getChatMember(chatId, String(userId));
    isAdmin = member.status === 'administrator' || member.status === 'creator';
  } catch {}
  cacheGroupAdmin(cacheKey, isAdmin, now);
  return isAdmin;
}

export function hasAccessRole(userRole, requiredRole) {
  const actual = normalizeAccessRole(userRole);
  const required = normalizeAccessRole(requiredRole);
  return actual !== null &&
    required !== null &&
    ROLE_RANK.get(actual) >= ROLE_RANK.get(required);
}

export function canAccessCommand(userRole, meta = {}) {
  return hasAccessRole(userRole, getRequiredAccessRole(meta));
}

export function isConfiguredBotAdmin(userId, settings = {}) {
  return normalizeIds(settings.admin?.uid).has(String(userId ?? ''));
}
