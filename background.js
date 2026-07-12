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
const windowTabIds = new Map();
const RECONNECT_INTERVAL_MS = 30000;
let tstConnected = false;
let lastConnectAttempt = 0;

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

  if (!stored.showNested && !stored.showFlat) {
    return { ...DEFAULTS };
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
  if (Object.keys(stored).length === 0) {
    opts = { ...DEFAULTS };
    await browser.storage.local.set(DEFAULTS);
    return;
  }
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
  await browser.runtime.sendMessage(TST_ID, {
    type: 'register-self',
    name: 'Nested tab numbering',
    listeningTypes: [
      'tree-attached', 'tree-detached',
      'tabs-rendered', 'sidebar-show'
    ],
    permissions: ['tabs'],
    style: buildStyle()
  });
}

function markDisconnected() {
  tstConnected = false;
  for (const timer of refreshTimers.values()) clearTimeout(timer);
  refreshTimers.clear();
}

async function tryConnect() {
  lastConnectAttempt = Date.now();
  try {
    await registerToTST();
    tstConnected = true;
    refreshAllWindows();
    return true;
  } catch (e) {
    markDisconnected();
    return false;
  }
}

function maybeConnect() {
  if (tstConnected) return Promise.resolve(true);
  if (Date.now() - lastConnectAttempt < RECONNECT_INTERVAL_MS) {
    return Promise.resolve(false);
  }
  return tryConnect();
}

function messageWindowId(message) {
  return message.windowId ?? message.window
    ?? message.tabs?.[0]?.windowId ?? message.tab?.windowId;
}

function scheduleRefresh(windowId) {
  if (windowId == null) return;
  if (!tstConnected) {
    maybeConnect();
    return;
  }
  clearTimeout(refreshTimers.get(windowId));
  refreshTimers.set(windowId, setTimeout(() => {
    refreshTimers.delete(windowId);
    refreshWindow(windowId);
  }, 200));
}

function normalizeTree(tree) {
  if (Array.isArray(tree)) return tree;
  if (tree && typeof tree === 'object' && tree.id != null) return [tree];
  return null;
}

async function refreshWindow(windowId) {
  let tree;
  try {
    tree = await browser.runtime.sendMessage(TST_ID, {
      type: 'get-tree',
      window: windowId
    });
  } catch (e) {
    markDisconnected();
    return;
  }

  tree = normalizeTree(tree);
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

async function refreshRenderedTabs(windowId, tabIds) {
  if (!tstConnected) return;

  let tree;
  try {
    tree = await browser.runtime.sendMessage(TST_ID, {
      type: 'get-tree',
      window: windowId
    });
  } catch (e) {
    markDisconnected();
    return;
  }

  tree = normalizeTree(tree);
  if (!tree || !tabIds.length) return;

  const labels = new Map();
  let flatCounter = 0;
  collectLabels(tree, '', () => ++flatCounter, labels);

  for (const tabId of tabIds) {
    const label = labels.get(tabId);
    if (label !== undefined) {
      setLabel(tabId, 'tab-behind', label);
    }
  }
}

function collectTabIds(tabsArray, out) {
  tabsArray.forEach(tab => {
    out.push(tab.id);
    if (tab.children && tab.children.length) {
      collectTabIds(tab.children, out);
    }
  });
}

function collectLabels(tabsArray, prefix, nextFlat, out) {
  tabsArray.forEach((tab, i) => {
    const nestedLabel = prefix ? `${prefix}${opts.separator}${i + 1}` : `${i + 1}`;
    const flatLabel = String(nextFlat());
    const html = buildLabelHtml(nestedLabel, flatLabel);
    if (html !== null) out.set(tab.id, html);

    if (tab.children && tab.children.length) {
      collectLabels(tab.children, nestedLabel, nextFlat, out);
    }
  });
}

function assignLabels(tabsArray, prefix, nextFlat) {
  tabsArray.forEach((tab, i) => {
    const nestedLabel = prefix ? `${prefix}${opts.separator}${i + 1}` : `${i + 1}`;
    const flatLabel = String(nextFlat());
    const html = buildLabelHtml(nestedLabel, flatLabel);
    if (html !== null) setLabel(tab.id, 'tab-behind', html);

    if (tab.children && tab.children.length) {
      assignLabels(tab.children, nestedLabel, nextFlat);
    }
  });
}

function cornerStyleAttr() {
  if (opts.autoTextColor) return '';
  return ` style="color: ${opts.textColor}"`;
}

function buildLabelHtml(nestedLabel, flatLabel) {
  const topLeft = opts.topLeftDisplay;
  const topRight = opts.topRightDisplay;
  if (topLeft === 'nothing' && topRight === 'nothing') return null;

  const topLeftLabel = topLeft === 'nested' ? nestedLabel : topLeft === 'flat' ? flatLabel : null;
  const topRightLabel = topRight === 'nested' ? nestedLabel : topRight === 'flat' ? flatLabel : null;
  const styleAttr = cornerStyleAttr();

  const parts = [];
  if (topLeftLabel !== null) parts.push(`<span part="corner-top-left"${styleAttr}>${topLeftLabel}</span>`);
  if (topRightLabel !== null) parts.push(`<span part="corner-top-right"${styleAttr}>${topRightLabel}</span>`);

  return `<div part="corners">${parts.join('')}</div>`;
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
  if (!tstConnected) return;
  windowTabIds.clear();
  browser.windows.getAll().then(wins => {
    wins.forEach(w => refreshWindow(w.id));
  });
}

browser.runtime.onMessageExternal.addListener((message, sender) => {
  if (sender.id !== TST_ID) return;

  tstConnected = true;

  if (message.type === 'ready') {
    loadOptions().then(tryConnect);
    return;
  }

  const windowId = messageWindowId(message);

  if (message.type === 'sidebar-show') {
    if (windowId != null) refreshWindow(windowId);
    else refreshAllWindows();
    return;
  }

  if (message.type === 'tree-attached' || message.type === 'tree-detached') {
    if (windowId != null) scheduleRefresh(windowId);
    return;
  }

  if (message.type === 'tabs-rendered' && message.tabs?.length && windowId != null) {
    refreshRenderedTabs(windowId, message.tabs.map(tab => tab.id));
    return;
  }

  if (windowId != null) {
    scheduleRefresh(windowId);
  } else {
    refreshAllWindows();
  }
});

browser.tabs.onCreated.addListener(tab => scheduleRefresh(tab.windowId));
browser.tabs.onRemoved.addListener((tabId, removeInfo) => scheduleRefresh(removeInfo.windowId));
browser.tabs.onMoved.addListener((tabId, moveInfo) => scheduleRefresh(moveInfo.windowId));
browser.tabs.onAttached.addListener((tabId, attachInfo) => scheduleRefresh(attachInfo.newWindowId));
browser.tabs.onDetached.addListener((tabId, detachInfo) => scheduleRefresh(detachInfo.oldWindowId));

browser.storage.onChanged.addListener(() => {
  loadOptions().then(() => {
    if (tstConnected) {
      registerToTST().then(() => refreshAllWindows()).catch(() => markDisconnected());
    } else {
      tryConnect();
    }
  });
});

(async () => {
  await loadOptions();
  await tryConnect();
})();
