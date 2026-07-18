const DEFAULTS = {
  topLeftDisplay: 'nested',
  topRightDisplay: 'nothing',
  autoTextColor: true,
  textColor: '#ffffff',
  fontSize: 10,
  separator: '.',
  boldText: false
};

// Fallback to Photon when theme colors are unavailable
const BUILTIN = {
  light: {
    popup: '#ffffff',
    popup_text: 'rgb(21, 20, 26)',
    popup_border: 'rgb(240, 240, 244)',
    popup_highlight: '#e0e0e6',
    popup_highlight_text: '#15141a'
  },
  dark: {
    popup: 'rgb(66, 65, 77)',
    popup_text: 'rgb(251, 251, 254)',
    popup_border: 'rgb(82, 82, 94)',
    popup_highlight: 'rgb(43, 42, 51)',
    popup_highlight_text: 'rgb(251, 251, 254)'
  }
};

const BUILTIN_THEME_IDS = {
  'firefox-compact-light@mozilla.org': 'light',
  'firefox-compact-dark@mozilla.org': 'dark',
  'default-theme@mozilla.org': null // system — follow chromePrefersDark()
};

function colorToCSS(color) {
  if (color == null) return null;
  if (typeof color === 'string') return color;
  if (Array.isArray(color)) {
    const [r, g, b, a] = color;
    if (a === undefined) return `rgb(${r}, ${g}, ${b})`;
    const alpha = a > 1 ? a / 255 : a;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (typeof color === 'object') {
    const { r, g, b, a } = color;
    if (r === undefined || g === undefined || b === undefined) return null;
    if (a === undefined) return `rgb(${r}, ${g}, ${b})`;
    const alpha = a > 1 ? a / 255 : a;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return null;
}

function luminance(color) {
  const css = colorToCSS(color);
  if (!css) return null;
  const m = css.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  let r, g, b;
  if (m) {
    r = +m[1];
    g = +m[2];
    b = +m[3];
  } else if (css[0] === '#') {
    let hex = css.slice(1);
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    if (hex.length < 6) return null;
    r = parseInt(hex.slice(0, 2), 16);
    g = parseInt(hex.slice(2, 4), 16);
    b = parseInt(hex.slice(4, 6), 16);
  } else {
    return null;
  }
  const toLin = c => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
}

function isDarkColor(color) {
  const lum = luminance(color);
  return lum != null && lum <= 0.4;
}

function chromePrefersDark() {
  const queries = [
    '(prefers-color-scheme: dark)',
    '(-moz-chrome-prefers-color-scheme: dark)'
  ];
  for (const q of queries) {
    try {
      if (window.matchMedia(q).matches) return true;
    } catch {
      /* unsupported query */
    }
  }
  return false;
}

function setVar(name, value) {
  const css = colorToCSS(value);
  if (css) document.documentElement.style.setProperty(name, css);
  else document.documentElement.style.removeProperty(name);
}

function pickPopupColors(colors, fallback) {
  if (!colors) return fallback;
  return {
    popup: colors.popup ?? fallback.popup,
    popup_text: colors.popup_text ?? fallback.popup_text,
    popup_border: colors.popup_border ?? fallback.popup_border,
    popup_highlight: colors.popup_highlight ?? fallback.popup_highlight,
    popup_highlight_text: colors.popup_highlight_text ?? fallback.popup_highlight_text
  };
}

function hasPopupColors(colors) {
  return colors != null && (colors.popup != null || colors.popup_text != null);
}

function applyColors(colors) {
  const scheme = isDarkColor(colors.popup) || (!colors.popup && chromePrefersDark())
    ? 'dark'
    : 'light';
  document.documentElement.style.colorScheme = scheme;

  setVar('--popup-bg', colors.popup);
  setVar('--popup-text', colors.popup_text);
  setVar('--popup-border', colors.popup_border);
  setVar('--popup-highlight', colors.popup_highlight);
  setVar('--popup-highlight-text', colors.popup_highlight_text);

  const bg = colorToCSS(colors.popup);
  document.documentElement.style.backgroundColor = bg || '';
  document.body.style.backgroundColor = bg || '';
  document.body.style.color = colorToCSS(colors.popup_text) || '';
}

/** Minimal ZIP reader: locate and inflate a single file (for theme XPIs). */
async function readZipFile(buffer, fileName) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const nameBytes = new TextEncoder().encode(fileName);

  // Find End of Central Directory
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;

  const cdOffset = view.getUint32(eocd + 16, true);
  let offset = cdOffset;
  while (offset + 46 <= bytes.length) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const method = view.getUint16(offset + 10, true);
    const compSize = view.getUint32(offset + 20, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localHeader = view.getUint32(offset + 42, true);
    const entryName = bytes.subarray(offset + 46, offset + 46 + nameLen);

    let match = entryName.length === nameBytes.length;
    if (match) {
      for (let i = 0; i < nameBytes.length; i++) {
        if (entryName[i] !== nameBytes[i]) {
          match = false;
          break;
        }
      }
    }

    if (match) {
      const nameLenLocal = view.getUint16(localHeader + 26, true);
      const extraLenLocal = view.getUint16(localHeader + 28, true);
      const dataStart = localHeader + 30 + nameLenLocal + extraLenLocal;
      const compressed = bytes.subarray(dataStart, dataStart + compSize);
      if (method === 0) return compressed;
      if (method === 8) {
        const ds = new DecompressionStream('deflate-raw');
        const stream = new Blob([compressed]).stream().pipeThrough(ds);
        return new Uint8Array(await new Response(stream).arrayBuffer());
      }
      return null;
    }

    offset += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

async function fetchManifestFromAmo(themeId) {
  const apiUrl =
    'https://addons.mozilla.org/api/v5/addons/addon/' +
    encodeURIComponent(themeId) +
    '/';
  const info = await fetch(apiUrl).then(r => (r.ok ? r.json() : null));
  const fileUrl = info?.current_version?.file?.url;
  if (!fileUrl) return null;
  const xpi = await fetch(fileUrl).then(r => (r.ok ? r.arrayBuffer() : null));
  if (!xpi) return null;
  const raw = await readZipFile(xpi, 'manifest.json');
  if (!raw) return null;
  return JSON.parse(new TextDecoder().decode(raw));
}

async function loadDarkThemeColors() {
  if (!browser.management?.getAll) return null;

  let theme;
  try {
    const addons = await browser.management.getAll();
    theme = addons.find(a => a.type === 'theme' && a.enabled);
  } catch {
    return null;
  }
  if (!theme) return null;

  const builtin = BUILTIN_THEME_IDS[theme.id];
  if (builtin === 'dark') return BUILTIN.dark;
  if (builtin === 'light') return BUILTIN.light;
  if (builtin === null) return BUILTIN[chromePrefersDark() ? 'dark' : 'light'];

  const cacheKey = `darkThemeColors:${theme.id}:${theme.version}`;
  try {
    const cached = await browser.storage.local.get(cacheKey);
    if (cached[cacheKey]) return cached[cacheKey];
  } catch {
    /* ignore */
  }

  try {
    const manifest = await fetchManifestFromAmo(theme.id);
    const colors = manifest?.dark_theme?.colors;
    if (!colors) return null;
    const picked = {
      popup: colors.popup ?? null,
      popup_text: colors.popup_text ?? null,
      popup_border: colors.popup_border ?? null,
      popup_highlight: colors.popup_highlight ?? null,
      popup_highlight_text: colors.popup_highlight_text ?? null
    };
    await browser.storage.local.set({ [cacheKey]: picked });
    return picked;
  } catch {
    return null;
  }
}

async function applyTheme(theme) {
  const c = theme?.colors;
  const darkUI = chromePrefersDark();
  const fallback = BUILTIN[darkUI ? 'dark' : 'light'];

  if (darkUI) {
    // getCurrent() only returns the light half for dual-mode themes
    const darkColors = await loadDarkThemeColors();
    if (hasPopupColors(darkColors)) {
      applyColors(pickPopupColors(darkColors, fallback));
      return;
    }
    // No dark_theme, use getCurrent() colors
    if (hasPopupColors(c)) {
      applyColors(pickPopupColors(c, BUILTIN.light));
      return;
    }
    applyColors(fallback);
    return;
  }

  if (hasPopupColors(c)) {
    applyColors(pickPopupColors(c, BUILTIN.light));
    return;
  }
  applyColors(BUILTIN.light);
}

function loadTheme() {
  if (!browser.theme?.getCurrent) {
    applyColors(BUILTIN[chromePrefersDark() ? 'dark' : 'light']);
    return;
  }
  browser.theme
    .getCurrent()
    .then(theme => applyTheme(theme))
    .catch(() => {
      applyColors(BUILTIN[chromePrefersDark() ? 'dark' : 'light']);
    });
}

function updateTextColorRow() {
  const auto = document.getElementById('autoTextColor').checked;
  const row = document.getElementById('textColorRow');
  row.style.opacity = auto ? '0.5' : '1';
  row.querySelector('input').disabled = auto;
}

function load() {
  browser.storage.local.get(DEFAULTS).then(opts => {
    document.getElementById('topLeftDisplay').value = opts.topLeftDisplay;
    document.getElementById('topRightDisplay').value =
      opts.topRightDisplay ?? opts.bottomLeftDisplay ?? 'nothing';
    document.getElementById('autoTextColor').checked = opts.autoTextColor;
    document.getElementById('textColor').value = opts.textColor;
    document.getElementById('fontSize').value = opts.fontSize;
    document.getElementById('separator').value = opts.separator;
    document.getElementById('boldText').checked = opts.boldText;
    updateTextColorRow();
  });
}

function save() {
  const opts = {
    topLeftDisplay: document.getElementById('topLeftDisplay').value,
    topRightDisplay: document.getElementById('topRightDisplay').value,
    autoTextColor: document.getElementById('autoTextColor').checked,
    textColor: document.getElementById('textColor').value,
    fontSize: parseInt(document.getElementById('fontSize').value, 10) || 10,
    separator: document.getElementById('separator').value || '.',
    boldText: document.getElementById('boldText').checked
  };
  browser.storage.local.set(opts).then(() => {
    const status = document.getElementById('status');
    status.textContent = 'Saved.';
    setTimeout(() => (status.textContent = ''), 1500);
  });
}

document.getElementById('autoTextColor').addEventListener('change', updateTextColorRow);
document.getElementById('save').addEventListener('click', save);

if (browser.theme?.onUpdated) {
  browser.theme.onUpdated.addListener(({ theme }) => {
    applyTheme(theme);
  });
}

for (const q of [
  '(prefers-color-scheme: dark)',
  '(-moz-chrome-prefers-color-scheme: dark)'
]) {
  try {
    window.matchMedia(q).addEventListener('change', loadTheme);
  } catch {
    /* unsupported */
  }
}

loadTheme();
load();
