export function normalizeNoPrefixMode(value) {
  const normalized = String(value ?? 'off').trim().toLowerCase();
  if (['on', 'true', 'all'].includes(normalized)) return 'all';
  if (['adminonly', 'admin_only', 'admin-only'].includes(normalized)) return 'adminOnly';
  return 'off';
}

export function canUseBareCommand({ mode, commandPrefix, isAdmin = false } = {}) {
  if (mode === 'adminOnly') return isAdmin;
  if (mode === 'all') return true;
  return commandPrefix === false;
}

export function getPrefixes(prefixSetting) {
  const values = Array.isArray(prefixSetting) ? prefixSetting : [prefixSetting ?? '/'];
  const prefixes = [...new Set(values
    .filter((value) => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean))];
  return prefixes.length ? prefixes : ['/'];
}

export function getPrefixesForChat(settings = {}, chatId) {
  const chatPrefixes = settings?.chatPrefixes;
  const localPrefix = chatId === undefined || chatId === null ||
    !chatPrefixes || typeof chatPrefixes !== 'object' || Array.isArray(chatPrefixes)
    ? null
    : chatPrefixes[String(chatId)];
  return getPrefixes(typeof localPrefix === 'string' && localPrefix.trim()
    ? localPrefix
    : settings?.prefix);
}
