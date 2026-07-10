const DEFAULTS = {
  topLeftDisplay: 'nested',
  topRightDisplay: 'nothing',
  autoTextColor: true,
  textColor: '#ffffff',
  fontSize: 10,
  separator: '.',
  boldText: false
};

function updateTextColorRow() {
  const auto = document.getElementById('autoTextColor').checked;
  const row = document.getElementById('textColorRow');
  row.style.opacity = auto ? '0.5' : '1';
  row.querySelector('input').disabled = auto;
}

function load() {
  browser.storage.local.get(DEFAULTS).then(opts => {
    document.getElementById('topLeftDisplay').value = opts.topLeftDisplay;
    document.getElementById('topRightDisplay').value = opts.topRightDisplay ?? opts.bottomLeftDisplay ?? 'nothing';
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
load();
