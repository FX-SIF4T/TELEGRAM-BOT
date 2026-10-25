import fs from 'node:fs';

export function readSettingsFile(settingsPath = global.settingsPath) {
  if (!settingsPath) throw new Error('The settings file path is not configured.');
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error('The settings file must contain a JSON object.');
  }
  return settings;
}

export function writeSettingsFile(settings, settingsPath = global.settingsPath) {
  if (!settingsPath) throw new Error('The settings file path is not configured.');
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new TypeError('Settings must be a JSON object.');
  }

  const temporaryPath = `${settingsPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(settings, null, 2), 'utf8');
    fs.renameSync(temporaryPath, settingsPath);
  } catch (error) {
    try { fs.rmSync(temporaryPath, { force: true }); } catch {}
    throw error;
  }

  global.settings = settings;
  if (settings.vip && typeof settings.vip === 'object' && !Array.isArray(settings.vip)) {
    global.vip = settings.vip;
  }
  return settings;
}
