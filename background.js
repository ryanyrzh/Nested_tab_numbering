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

let opts = { ...DEFAULTS };
const refreshTimers = new Map();
const labelCache = new Map();
const windowTabIds = new Map();

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
        color: inherit;
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
      transition: color 0.2s ease, opacity 0.2s ease;
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
  clearTimeout(refreshTimers.get(windowId));
  refreshTimers.set(windowId, setTimeout(() => {
    refreshTimers.delete(windowId);
    refreshWindow(windowId);
  }, 200));
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
  const currentIds = new Set(flatTabIds);
  const prevIds = windowTabIds.get(windowId);
  if (prevIds) {
    for (const tabId of prevIds) {
      if (!currentIds.has(tabId)) {
        setLabel(tabId, 'tab-behind', null);
      }
    }
  }
  windowTabIds.set(windowId, currentIds);

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

function cornerStyleAttr() {
  if (opts.autoTextColor) return '';
  return ` style="color: ${opts.textColor}"`;
}

function setCornerLabels(tab, nestedLabel, flatLabel) {
  const topLeft = opts.topLeftDisplay;
  const topRight = opts.topRightDisplay;

  if (topLeft === 'nothing' && topRight === 'nothing') return;

  const topLeftLabel = topLeft === 'nested' ? nestedLabel : topLeft === 'flat' ? flatLabel : null;
  const topRightLabel = topRight === 'nested' ? nestedLabel : topRight === 'flat' ? flatLabel : null;
  const styleAttr = cornerStyleAttr();

  const parts = [];
  if (topLeftLabel !== null) parts.push(`<span part="corner-top-left"${styleAttr}>${topLeftLabel}</span>`);
  if (topRightLabel !== null) parts.push(`<span part="corner-top-right"${styleAttr}>${topRightLabel}</span>`);

  setLabel(tab.id, 'tab-behind', `<div part="corners">${parts.join('')}</div>`);
}

function setLabel(tabId, place, contents) {
  const key = `${tabId}:${place}`;
  const prev = labelCache.get(key);
  if (prev === contents || (prev === undefined && contents === null)) return;
  if (contents === null) labelCache.delete(key);
  else labelCache.set(key, contents);

  browser.runtime.sendMessage(TST_ID, {
    type: 'set-extra-contents',
    tab: tabId,
    place,
    contents
  }).catch(() => {});
}

function refreshAllWindows() {
  labelCache.clear();
  windowTabIds.clear();
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

browser.storage.onChanged.addListener(async () => {
  await loadOptions();
  await registerToTST();
  refreshAllWindows();
});

(async () => {
  await loadOptions();
  await registerToTST();
  refreshAllWindows();
})();
