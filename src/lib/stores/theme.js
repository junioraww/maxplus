import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';

const STORAGE_KEY = 'maxplus-theme';

function createThemeStore() {
  const initial = browser ? localStorage.getItem(STORAGE_KEY) || 'light' : 'light';
  const store = writable(initial);

  function setTheme(value) {
    store.set(value);
    if (browser) {
      localStorage.setItem(STORAGE_KEY, value);
      applyTheme(value);
    }
  }

  return {
    subscribe: store.subscribe,
    set: setTheme,
    toggle() {
      const current = get(store);
      setTheme(current === 'dark' ? 'light' : 'dark');
    }
  };
}

function applyTheme(theme) {
  if (!browser) return;
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

export const theme = createThemeStore();

if (browser) {
  applyTheme(localStorage.getItem(STORAGE_KEY) || 'light');
}
