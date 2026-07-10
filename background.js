const TST_ID = 'treestyletab@piro.sakura.ne.jp';
const DEFAULTS = {
  topLeftDisplay: 'nested',
  topRightDisplay: 'nothing',
  autoTextColor: true,
  textColor: '#ffffff',
  fontSize: 10,
  separator: '.',
  boldText: false
};
const ALL_PLACES = ['tab-front', 'tab-behind', 'tab-above', 'tab-below', 'tab-indent'];

let opts = { ...DEFAULTS };
let refreshTimer = null;
let themeColors = null;

function parseHexColor(color) {
  if (!color || typeof color !== 'string') return null;
  const hex = color.match(/^#([0-9a-f]{6})$/i);
  if (!hex) return null;
  const value = parseInt(hex[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function relativeLuminance(r, g, b) {
  const channel = c => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastTextColor(bgColor) {
  const rgb = parseHexColor(bgColor);
  if (!rgb) return null;
  return relativeLuminance(...rgb) > 0.45 ? '#1a1a1a' : '#e8e8e8';
}

async function loadThemeColors() {
  try {
    const theme = await browser.theme.getCurrent();
    themeColors = theme.colors || null;
  } catch (e) {
    themeColors = null;
  }
}

function getAutoTextColor(tab) {
  const isActive = tab.active || tab.highlighted;
  const c = themeColors;
  if (!c || !Object.keys(c).length) return null;

  const explicit = isActive
    ? (c.tab_text || c.toolbar_text)
    : c.tab_background_text;
  if (explicit) return explicit;

  const bg = isActive
    ? (c.tab_selected || c.toolbar || c.frame)
    : (c.tab || c.frame);
  return contrastTextColor(bg);
}

function migrateOptions(stored) {
  if (stored.topLeftDisplay !== undefined || stored.topRightDisplay !== undefined || stored.bottomLeftDisplay !== undefined) {
    const migrated = { ...DEFAULTS, ...stored };
    if (stored.topRightDisplay === undefined && stored.bottomLeftDisplay !== undefined) {
      migrated.topRightDisplay = stored.bottomLeftDisplay;
    }
    if (stored.autoTextColor === undefined && stored.textColor && stored.textColor !== DEFAULTS.textColor) {
      migrated.autoTextColor = false;
    }
    return migrated;
  }

  const topPlaces = ['tab-front', 'tab-above', 'tab-indent'];
  const bottomPlaces = ['tab-behind', 'tab-below'];
  let topLeftDisplay = 'nothing';
  let topRightDisplay = 'nothing';

  if (stored.showNested) {
    if (topPlaces.includes(stored.nestedPosition)) topLeftDisplay = 'nested';
    else if (bottomPlaces.includes(stored.nestedPosition)) topRightDisplay = 'nested';
    else topLeftDisplay = 'nested';
  }
  if (stored.showFlat) {
    if (topPlaces.includes(stored.flatPosition) && topLeftDisplay === 'nothing') {
      topLeftDisplay = 'flat';
    } else if (bottomPlaces.includes(stored.flatPosition) && topRightDisplay === 'nothing') {
      topRightDisplay = 'flat';
    } else if (topPlaces.includes(stored.flatPosition)) {
      topLeftDisplay = 'flat';
    } else {
      topRightDisplay = 'flat';
    }
  }

  const migrated = { ...DEFAULTS, ...stored, topLeftDisplay, topRightDisplay };
  if (stored.autoTextColor === undefined && stored.textColor && stored.textColor !== DEFAULTS.textColor) {
    migrated.autoTextColor = false;
  }
  return migrated;
}

async function loadOptions() {
  const stored = await browser.storage.local.get(null);
  opts = migrateOptions(stored);
}

function buildCornerColorRules() {
  if (opts.autoTextColor) {
    return `
      tab-item ::part(%EXTRA_CONTENTS_PART% corner-top-left),
      tab-item ::part(%EXTRA_CONTENTS_PART% corner-top-right) {
        color: var(--tab-text-regular, var(--browser-fg, CanvasText));
      }
      tab-item.active ::part(%EXTRA_CONTENTS_PART% corner-top-left),
      tab-item.active ::part(%EXTRA_CONTENTS_PART% corner-top-right),
      tab-item.bundled-active ::part(%EXTRA_CONTENTS_PART% corner-top-left),
      tab-item.bundled-active ::part(%EXTRA_CONTENTS_PART% corner-top-right),
      tab-item.highlighted ::part(%EXTRA_CONTENTS_PART% corner-top-left),
      tab-item.highlighted ::part(%EXTRA_CONTENTS_PART% corner-top-right) {
        color: var(--tab-text-active, var(--browser-fg-active, var(--tab-text-regular, CanvasText)));
      }
      tab-item.discarded ::part(%EXTRA_CONTENTS_PART% corner-top-left),
      tab-item.discarded ::part(%EXTRA_CONTENTS_PART% corner-top-right) {
        opacity: 0.75;
      }
    `;
  }

  return `
    ::part(%EXTRA_CONTENTS_PART% corner-top-left),
    ::part(%EXTRA_CONTENTS_PART% corner-top-right) {
      color: ${opts.textColor};
    }
  `;
}

function buildStyle() {
  const weight = opts.boldText ? 'bold' : 'normal';
  return `
    ::part(%EXTRA_CONTENTS_PART% corners) {
      position: absolute;
      inset: 0;
      pointer-events: none;
    }
    ::part(%EXTRA_CONTENTS_PART% corner-top-left),
    ::part(%EXTRA_CONTENTS_PART% corner-top-right) {
      font-size: ${opts.fontSize}px;
      font-weight: ${weight};
      white-space: nowrap;
      line-height: 1;
      position: absolute;
      top: 0;
    }
    ::part(%EXTRA_CONTENTS_PART% corner-top-left) {
      left: 0;
    }
    ::part(%EXTRA_CONTENTS_PART% corner-top-right) {
      right: 0;
    }
    ${buildCornerColorRules()}
  `;
}

async function registerToTST() {
  try {
    await browser.runtime.sendMessage(TST_ID, {
      type: 'register-self',
      name: 'Nested tab numbering',
      listeningTypes: [
        'tab-attached', 'tab-detached', 'tab-moved',
        'tabs-rendered', 'sidebar-show'
      ],
      permissions: ['tabs'],
      style: buildStyle()
    });
  } catch (e) {
    // TST not available
  }
}

function scheduleRefresh(windowId) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => refreshWindow(windowId), 150);
}

async function refreshWindow(windowId) {
  let tree;
  try {
    tree = await browser.runtime.sendMessage(TST_ID, {
      type: 'get-tree',
      window: windowId
    });
  } catch (e) {
    return;
  }
  if (!tree) return;

  const flatTabIds = [];
  collectTabIds(tree, flatTabIds);

  for (const tabId of flatTabIds) {
    for (const place of ALL_PLACES) {
      setLabel(tabId, place, null);
    }
  }

  let flatCounter = 0;
  assignLabels(tree, '', () => ++flatCounter);
}

function collectTabIds(tabsArray, out) {
  tabsArray.forEach(tab => {
    out.push(tab.id);
    if (tab.children && tab.children.length) {
      collectTabIds(tab.children, out);
    }
  });
}

function assignLabels(tabsArray, prefix, nextFlat) {
  tabsArray.forEach((tab, i) => {
    const nestedLabel = prefix ? `${prefix}${opts.separator}${i + 1}` : `${i + 1}`;
    const flatLabel = String(nextFlat());

    setCornerLabels(tab, nestedLabel, flatLabel);

    if (tab.children && tab.children.length) {
      assignLabels(tab.children, nestedLabel, nextFlat);
    }
  });
}

function cornerStyleAttr(tab) {
  const color = opts.autoTextColor ? getAutoTextColor(tab) : opts.textColor;
  return color ? ` style="color: ${color}"` : '';
}

function setCornerLabels(tab, nestedLabel, flatLabel) {
  const topLeft = opts.topLeftDisplay;
  const topRight = opts.topRightDisplay;

  if (topLeft === 'nothing' && topRight === 'nothing') return;

  const topLeftLabel = topLeft === 'nested' ? nestedLabel : topLeft === 'flat' ? flatLabel : null;
  const topRightLabel = topRight === 'nested' ? nestedLabel : topRight === 'flat' ? flatLabel : null;
  const styleAttr = cornerStyleAttr(tab);

  const parts = [];
  if (topLeftLabel !== null) parts.push(`<span part="corner-top-left"${styleAttr}>${topLeftLabel}</span>`);
  if (topRightLabel !== null) parts.push(`<span part="corner-top-right"${styleAttr}>${topRightLabel}</span>`);

  setLabel(tab.id, 'tab-behind', `<div part="corners">${parts.join('')}</div>`);
}

function setLabel(tabId, place, contents) {
  browser.runtime.sendMessage(TST_ID, {
    type: 'set-extra-contents',
    tab: tabId,
    place,
    contents
  }).catch(() => {});
}

function refreshAllWindows() {
  browser.windows.getAll().then(wins => {
    wins.forEach(w => refreshWindow(w.id));
  });
}

browser.runtime.onMessageExternal.addListener((message, sender) => {
  if (sender.id !== TST_ID) return;
  if (message.type === 'ready') {
    registerToTST().then(refreshAllWindows);
  } else {
    scheduleRefresh(message.windowId);
  }
});

browser.tabs.onCreated.addListener(tab => scheduleRefresh(tab.windowId));
browser.tabs.onRemoved.addListener((tabId, removeInfo) => scheduleRefresh(removeInfo.windowId));
browser.tabs.onMoved.addListener((tabId, moveInfo) => scheduleRefresh(moveInfo.windowId));
browser.tabs.onAttached.addListener((tabId, attachInfo) => scheduleRefresh(attachInfo.newWindowId));
browser.tabs.onDetached.addListener((tabId, detachInfo) => scheduleRefresh(detachInfo.oldWindowId));

browser.tabs.onActivated.addListener(info => scheduleRefresh(info.windowId));
browser.tabs.onHighlighted.addListener(info => scheduleRefresh(info.windowId));

if (browser.theme && browser.theme.onUpdated) {
  browser.theme.onUpdated.addListener(async () => {
    await loadThemeColors();
    refreshAllWindows();
  });
}

browser.storage.onChanged.addListener(async () => {
  await loadOptions();
  await loadThemeColors();
  await registerToTST();
  refreshAllWindows();
});

(async () => {
  await loadOptions();
  await loadThemeColors();
  await registerToTST();
  refreshAllWindows();
})();
