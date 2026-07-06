// ==UserScript==
// @name         Web Draft: 1 Line Maker
// @namespace    local.draft-web-for-1row
// @version      0.1.0
// @description  Selected text in a web draft editor is tightened with Alt+Shift+N until it visually becomes one line.
// @match        *://*/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const CONFIG = {
    maxPresses: 60,
    settleMs: 80,
    stalledLimit: 8,
    minRectWidth: 1,
    minRectHeight: 1,
    lineTolerancePx: 2,
  };

  const ID = 'draft-web-for-1row-panel';

  // Same-origin frames are handled by the top window. Cross-origin frames need
  // their own copy because the parent page cannot inspect their selections.
  if (isSameOriginChildFrame()) {
    return;
  }

  let lastSelection = null;
  let running = false;
  let abortRequested = false;
  const listenedDocuments = new WeakSet();

  createPanel();
  registerSelectionListeners();
  setInterval(registerSelectionListeners, 1500);

  function isSameOriginChildFrame() {
    if (window.top === window) {
      return false;
    }

    try {
      return Boolean(window.top.document);
    } catch (_error) {
      return false;
    }
  }

  function createPanel() {
    if (document.getElementById(ID)) {
      return;
    }

    const style = document.createElement('style');
    style.textContent = `
      #${ID} {
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 2147483647;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 6px;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        user-select: none;
      }

      #${ID} button {
        min-width: 118px;
        height: 36px;
        padding: 0 13px;
        border: 1px solid rgba(0, 0, 0, 0.2);
        border-radius: 8px;
        background: #1d4ed8;
        color: #fff;
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
        cursor: pointer;
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0;
        white-space: nowrap;
      }

      #${ID} button:hover {
        background: #1e40af;
      }

      #${ID} button[data-running="true"] {
        background: #9f1239;
      }

      #${ID} .status {
        max-width: 260px;
        padding: 5px 8px;
        border: 1px solid rgba(0, 0, 0, 0.14);
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.96);
        color: #111827;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
        font-size: 12px;
        line-height: 1.35;
        text-align: right;
        white-space: normal;
      }
    `;

    const panel = document.createElement('div');
    panel.id = ID;

    const status = document.createElement('div');
    status.className = 'status';
    status.textContent = '텍스트를 드래그한 뒤 누르세요.';

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '1줄로 만들기';
    button.title = '선택한 텍스트에 Alt+Shift+N을 반복 적용합니다.';

    panel.append(status, button);
    document.documentElement.append(style, panel);

    panel.addEventListener('mousedown', (event) => event.preventDefault(), true);

    button.addEventListener('click', async () => {
      if (running) {
        abortRequested = true;
        setStatus('중지 중...');
        return;
      }

      running = true;
      abortRequested = false;
      button.dataset.running = 'true';
      button.textContent = '중지';

      try {
        await makeSelectedTextOneLine();
      } finally {
        running = false;
        abortRequested = false;
        button.dataset.running = 'false';
        button.textContent = '1줄로 만들기';
      }
    });
  }

  async function makeSelectedTextOneLine() {
    const selected = getCurrentSelection() || restoreLastSelection();

    if (!selected) {
      setStatus('선택 영역을 찾지 못했습니다.');
      return;
    }

    rememberSelection(selected.win);
    let lines = countSelectionLines(selected.range);

    if (lines <= 0) {
      setStatus('선택 영역의 줄 수를 읽지 못했습니다.');
      return;
    }

    if (lines <= 1) {
      setStatus('이미 1줄입니다.');
      return;
    }

    let previousSignature = getRangeSignature(selected.range);
    let stalledCount = 0;

    for (let pressCount = 1; pressCount <= CONFIG.maxPresses; pressCount += 1) {
      if (abortRequested) {
        setStatus(`중지했습니다. 현재 ${lines}줄입니다.`);
        return;
      }

      const activeSelection = getCurrentSelection() || restoreLastSelection();

      if (!activeSelection) {
        setStatus('반복 중 선택 영역이 사라졌습니다.');
        return;
      }

      dispatchAltShiftN(activeSelection);
      await sleep(CONFIG.settleMs);

      const nextSelection = getCurrentSelection() || activeSelection;
      rememberSelection(nextSelection.win);
      lines = countSelectionLines(nextSelection.range);

      if (lines <= 1) {
        setStatus(`완료: ${pressCount}회 적용했습니다.`);
        return;
      }

      const nextSignature = getRangeSignature(nextSelection.range);

      if (nextSignature === previousSignature) {
        stalledCount += 1;
      } else {
        stalledCount = 0;
        previousSignature = nextSignature;
      }

      setStatus(`조정 중: ${lines}줄, ${pressCount}회 적용`);

      if (stalledCount >= CONFIG.stalledLimit) {
        setStatus('단축키 반응이 없거나 더 줄어들지 않습니다.');
        return;
      }
    }

    setStatus(`최대 ${CONFIG.maxPresses}회까지 적용했지만 ${lines}줄입니다.`);
  }

  function dispatchAltShiftN(selectionInfo) {
    const { win, range } = selectionInfo;
    const target = findKeyboardTarget(win, range);

    if (target && typeof target.focus === 'function') {
      try {
        target.focus({ preventScroll: true });
      } catch (_error) {
        target.focus();
      }
    }

    try {
      win.focus();
    } catch (_error) {
      // Some embedded frames do not allow focus calls from script.
    }

    const eventInit = {
      key: 'N',
      code: 'KeyN',
      location: 0,
      altKey: true,
      shiftKey: true,
      ctrlKey: false,
      metaKey: false,
      repeat: false,
      bubbles: true,
      cancelable: true,
      composed: true,
    };

    dispatchKeyboardEvent(target, 'keydown', eventInit);
    dispatchKeyboardEvent(target, 'keyup', eventInit);
  }

  function dispatchKeyboardEvent(target, type, eventInit) {
    const event = new KeyboardEvent(type, eventInit);

    defineReadonlyEventValue(event, 'keyCode', 78);
    defineReadonlyEventValue(event, 'which', 78);
    defineReadonlyEventValue(event, 'charCode', 0);

    target.dispatchEvent(event);
  }

  function defineReadonlyEventValue(event, key, value) {
    try {
      Object.defineProperty(event, key, { get: () => value });
    } catch (_error) {
      // Modern editors usually read key/code. This is only for older handlers.
    }
  }

  function findKeyboardTarget(win, range) {
    const doc = win.document;
    const active = doc.activeElement;
    const selectedElement = getElementFromRange(range);
    const editable = selectedElement
      ? selectedElement.closest('[contenteditable]:not([contenteditable="false"]), textarea, input')
      : null;

    return editable || active || doc.body || doc.documentElement;
  }

  function getElementFromRange(range) {
    let node = range.commonAncestorContainer;

    if (!node) {
      return null;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      node = node.parentElement;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }

    return node;
  }

  function getCurrentSelection() {
    const windows = collectReachableWindows(window);

    for (const win of windows) {
      const selection = getSelectionFromWindow(win);

      if (selection) {
        return selection;
      }
    }

    return null;
  }

  function restoreLastSelection() {
    if (!lastSelection) {
      return null;
    }

    try {
      const selection = lastSelection.win.getSelection();

      if (!selection || !lastSelection.ranges.length) {
        return null;
      }

      selection.removeAllRanges();
      lastSelection.ranges.forEach((range) => selection.addRange(range));
      lastSelection.win.focus();

      return {
        win: lastSelection.win,
        selection,
        range: selection.getRangeAt(0),
      };
    } catch (_error) {
      return null;
    }
  }

  function rememberSelection(win) {
    const selection = getSelectionFromWindow(win);

    if (!selection) {
      return;
    }

    lastSelection = {
      win,
      ranges: Array.from({ length: selection.selection.rangeCount }, (_value, index) => selection.selection.getRangeAt(index).cloneRange()),
    };
  }

  function getSelectionFromWindow(win) {
    try {
      const selection = win.getSelection();

      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        return null;
      }

      return {
        win,
        selection,
        range: selection.getRangeAt(0),
      };
    } catch (_error) {
      return null;
    }
  }

  function countSelectionLines(range) {
    const rects = getUsefulRects(range);

    if (!rects.length) {
      return 0;
    }

    const lines = [];

    rects
      .sort((a, b) => a.top - b.top || a.left - b.left)
      .forEach((rect) => {
        const centerY = rect.top + rect.height / 2;
        const tolerance = Math.max(CONFIG.lineTolerancePx, rect.height * 0.35);
        const existing = lines.find((line) => Math.abs(line.centerY - centerY) <= tolerance);

        if (existing) {
          existing.centerY = (existing.centerY + centerY) / 2;
          existing.top = Math.min(existing.top, rect.top);
          existing.bottom = Math.max(existing.bottom, rect.bottom);
        } else {
          lines.push({
            centerY,
            top: rect.top,
            bottom: rect.bottom,
          });
        }
      });

    return lines.length;
  }

  function getRangeSignature(range) {
    const rects = getUsefulRects(range);

    if (!rects.length) {
      return 'empty';
    }

    const first = rects[0];
    const last = rects[rects.length - 1];
    const box = range.getBoundingClientRect();

    return [
      countSelectionLines(range),
      Math.round(box.width * 10),
      Math.round(box.height * 10),
      Math.round(first.left * 10),
      Math.round(first.top * 10),
      Math.round(last.right * 10),
      Math.round(last.bottom * 10),
    ].join(':');
  }

  function getUsefulRects(range) {
    try {
      return Array.from(range.getClientRects()).filter((rect) => {
        return rect.width > CONFIG.minRectWidth && rect.height > CONFIG.minRectHeight;
      });
    } catch (_error) {
      return [];
    }
  }

  function registerSelectionListeners() {
    const windows = collectReachableWindows(window);

    windows.forEach((win) => {
      try {
        const doc = win.document;

        if (listenedDocuments.has(doc)) {
          return;
        }

        listenedDocuments.add(doc);
        doc.addEventListener('selectionchange', () => rememberSelection(win), true);
        doc.addEventListener('mouseup', () => rememberSelection(win), true);
        doc.addEventListener('keyup', () => rememberSelection(win), true);
      } catch (_error) {
        // Cross-origin children are handled by their own userscript instance.
      }
    });
  }

  function collectReachableWindows(rootWin, result = [], seen = new Set()) {
    if (seen.has(rootWin)) {
      return result;
    }

    seen.add(rootWin);
    result.push(rootWin);

    for (let index = 0; index < rootWin.frames.length; index += 1) {
      try {
        const child = rootWin.frames[index];
        void child.document;
        collectReachableWindows(child, result, seen);
      } catch (_error) {
        // Ignore cross-origin frames from this window.
      }
    }

    return result;
  }

  function setStatus(message) {
    const panel = document.getElementById(ID);
    const status = panel ? panel.querySelector('.status') : null;

    if (status) {
      status.textContent = message;
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
})();
