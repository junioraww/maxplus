const KNOWN_PERMISSIONS = new Set([
  'ui:mount',
  'ui:style',
  'stores:read',
  'stores:write',
  'api:call',
  'network',
  'crypto',
  'tauri',
  'storage',
  'events',
]);

const KNOWN_MOUNT_POINTS = new Set([
  'panel:tab',
  'panel:tab-content',
  'sticker-panel:tab',
  'sticker-panel:tab-content',
  'input:action',
  'input:toolbar',
  'input:context-item',
  'message:context-item',
  'message:footer',
  'message:decoration',
  'chat:header-action',
  'chat:header-info',
  'chat:footer',
  'chat:background',
  'settings:section',
  'settings:page',
  'sidebar:section',
  'notification:action',
  'global:style',
  'global:init',
  'global:overlay',
  'global:modal',
]);

const ID_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const MAX_FILE_BYTES = 131072;

export class PluginLoadError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function validateManifest(manifest, files) {
  if (!manifest || typeof manifest !== 'object') {
    throw new PluginLoadError('MISSING_MANIFEST', 'manifest.json is missing or invalid');
  }

  if (!manifest.id || !ID_REGEX.test(manifest.id)) {
    throw new PluginLoadError('INVALID_ID', 'Plugin id must match reverse.domain.style format');
  }

  if (!manifest.name || typeof manifest.name !== 'string') {
    throw new PluginLoadError('INVALID_MANIFEST', 'Plugin name is required');
  }

  if (!manifest.version || typeof manifest.version !== 'string') {
    throw new PluginLoadError('INVALID_MANIFEST', 'Plugin version is required');
  }

  if (!manifest.entry || typeof manifest.entry !== 'string') {
    throw new PluginLoadError('INVALID_MANIFEST', 'Plugin entry script path is required');
  }

  if (!files.has(manifest.entry)) {
    throw new PluginLoadError('MISSING_ENTRY_SCRIPT', `Entry script "${manifest.entry}" not found in archive`);
  }

  const permissions = manifest.permissions || [];
  for (const perm of permissions) {
    if (!KNOWN_PERMISSIONS.has(perm)) {
      throw new PluginLoadError('UNKNOWN_PERMISSION', `Unknown permission: "${perm}"`);
    }
  }

  const styles = manifest.styles || [];
  for (const s of styles) {
    const path = typeof s === 'string' ? s : s.path;
    if (!files.has(path)) {
      throw new PluginLoadError('MISSING_FILE', `Style file "${path}" not found in archive`);
    }
  }

  const components = manifest.components || [];
  for (const c of components) {
    if (c.mountPoint && !KNOWN_MOUNT_POINTS.has(c.mountPoint)) {
      throw new PluginLoadError('UNKNOWN_MOUNT_POINT', `Unknown mount point: "${c.mountPoint}"`);
    }
  }

  for (const [path, content] of files.entries()) {
    if (content.length > MAX_FILE_BYTES) {
      throw new PluginLoadError('SIZE_EXCEEDED', `File "${path}" exceeds 128 KB limit`);
    }
  }

  return true;
}

export const PERMISSION_LABELS = {
  'ui:mount': 'Добавление элементов в интерфейс',
  'ui:style': 'Изменение стилей и оформления',
  'stores:read': 'Чтение сообщений, чатов и профиля',
  'stores:write': 'Изменение состояния приложения',
  'api:call': 'Выполнение запросов к API мессенджера',
  'network': 'Внешние сетевые запросы',
  'crypto': 'Пользовательские алгоритмы шифрования',
  'tauri': 'Доступ к системным функциям устройства',
  'storage': 'Локальное сохранение данных на устройстве',
  'events': 'Отслеживание событий (сообщения, чаты)',
};

export const CATEGORY_LABELS = {
  'function': 'Функция',
  'style': 'Стиль',
  'integration': 'Интеграция',
  'crypto': 'Шифрование',
};

