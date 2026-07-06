// ==UserScript==
// @name         Web Draft: 1 Line Maker
// @namespace    local.draft-web-for-1row
// @version      0.2.0
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
    requestWaitMs: 1200,
    overallWaitMs: 16000,
    minRectWidth: 1,
    minRectHeight: 1,
    lineTolerancePx: 2,
  };

  const UI_ID = 'draft-web-for-1row-panel';
  const SOURCE = 'draft-web-for-1row';
  const MESSAGE = {
    run: 'run',
    abort: 'abort',
    status: 'status',
  };
  const INSTANCE_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

  let lastSelection = null;
  let running = false;
  let abortRequested = false;
  let currentRequestId = null;

  const handledRequests = new Set();
  const listenedDocuments = new WeakSet();
  const pendingTopRuns = new Map();

  window.addEventListener('message', handleFrameMessage, false);
  registerSelectionListeners();
  setInterval(registerSelectionListeners, 1500);

  if (isTopFrame()) {
    createPanel();
  }

  function isTopFrame() {
    return window.parent === window;
  }

  function createPanel() {
    if (document.getElementById(UI_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.textContent = `
      #${UI_ID} {
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

      #${UI_ID} button {
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

      #${UI_ID} button:hover {
        background: #1e40af;
      }

      #${UI_ID} button[data-running="true"] {
        background: #9f1239;
      }

      #${UI_ID} .status {
        max-width: 300px;
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
    panel.id = UI_ID;

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
        broadcastToChildFrames({
          source: SOURCE,
          type: MESSAGE.abort,
          requestId: currentRequestId,
          instanceId: INSTANCE_ID,
        });
        setStatus('중지 중...');
        return;
      }

      running = true;
      abortRequested = false;
      button.dataset.running = 'true';
      button.textContent = '중지';

      try {
        await requestOneLineFromAllFrames();
      } finally {
        running = false;
        abortRequested = false;
        currentRequestId = null;
        button.dataset.running = 'false';
        button.textContent = '1줄로 만들기';
      }
    });
  }

  function requestOneLineFromAllFrames() {
    const requestId = createRequestId();
    currentRequestId = requestId;
    handledRequests.add(requestId);

    setStatus(`선택 영역 찾는 중... iframe ${window.frames.length}개 확인`);

    broadcastToChildFrames({
      source: SOURCE,
      type: MESSAGE.run,
      requestId,
      instanceId: INSTANCE_ID,
    });

    return new Promise((resolve) => {
      const pending = {
        claimed: false,
        resolved: false,
        resolve,
        waitTimer: null,
        overallTimer: null,
      };

      pendingTopRuns.set(requestId, pending);

      pending.waitTimer = setTimeout(async () => {
        if (pending.claimed || pending.resolved) {
          return;
        }

        const fallback = await makeSelectedTextOneLine(requestId, {
          includeReachableFrames: true,
          silentNoSelection: true,
        });

        if (fallback.found) {
          markPendingClaimed(requestId);

          if (fallback.terminal) {
            finishPendingRun(requestId);
          }

          return;
        }

        setStatus(`선택 영역을 찾지 못했습니다. iframe ${window.frames.length}개 안쪽 선택 영역을 아직 못 보고 있습니다.`);
        finishPendingRun(requestId);
      }, CONFIG.requestWaitMs);

      pending.overallTimer = setTimeout(() => {
        const current = pendingTopRuns.get(requestId);

        if (!current || current.resolved) {
          return;
        }

        setStatus('작업 응답이 끊겼습니다. 다시 시도해 주세요.');
        finishPendingRun(requestId);
      }, CONFIG.overallWaitMs);

      makeSelectedTextOneLine(requestId, {
        includeReachableFrames: false,
        silentNoSelection: true,
      })
        .then((result) => {
          if (!pendingTopRuns.has(requestId) || !result.found) {
            return;
          }

          markPendingClaimed(requestId);

          if (result.terminal) {
            finishPendingRun(requestId);
          }
        })
        .catch((error) => {
          console.error('[draft-web-for-1row] failed to process top selection', error);
          setStatus('오류가 발생했습니다. 콘솔 로그를 확인해 주세요.');
          finishPendingRun(requestId);
        });
    });
  }

  async function makeSelectedTextOneLine(requestId, options = {}) {
    const selected = getCurrentSelection(options) || restoreLastSelection(options);

    if (!selected) {
      if (!options.silentNoSelection) {
        setStatus('선택 영역을 찾지 못했습니다.', { requestId, found: false, terminal: true });
      }

      return { found: false, terminal: true };
    }

    rememberSelection(selected.win);
    let lines = countSelectionLines(selected.range);

    if (lines <= 0) {
      setStatus('선택 영역의 줄 수를 읽지 못했습니다.', { requestId, found: true, terminal: true });
      return { found: true, terminal: true };
    }

    if (lines <= 1) {
      setStatus('이미 1줄입니다.', { requestId, found: true, terminal: true });
      return { found: true, terminal: true };
    }

    setStatus(`선택 영역 확인: ${lines}줄`, { requestId, found: true });

    let previousSignature = getRangeSignature(selected.range);
    let stalledCount = 0;

    for (let pressCount = 1; pressCount <= CONFIG.maxPresses; pressCount += 1) {
      if (abortRequested) {
        setStatus(`중지했습니다. 현재 ${lines}줄입니다.`, { requestId, found: true, terminal: true });
        return { found: true, terminal: true };
      }

      const activeSelection = getCurrentSelection(options) || restoreLastSelection(options);

      if (!activeSelection) {
        setStatus('반복 중 선택 영역이 사라졌습니다.', { requestId, found: true, terminal: true });
        return { found: true, terminal: true };
      }

      dispatchAltShiftN(activeSelection);
      await sleep(CONFIG.settleMs);

      const nextSelection = getCurrentSelection(options) || activeSelection;
      rememberSelection(nextSelection.win);
      lines = countSelectionLines(nextSelection.range);

      if (lines <= 1) {
        setStatus(`완료: ${pressCount}회 적용했습니다.`, { requestId, found: true, terminal: true });
        return { found: true, terminal: true };
      }

      const nextSignature = getRangeSignature(nextSelection.range);

      if (nextSignature === previousSignature) {
        stalledCount += 1;
      } else {
        stalledCount = 0;
        previousSignature = nextSignature;
      }

      setStatus(`조정 중: ${lines}줄, ${pressCount}회 적용`, { requestId, found: true });

      if (stalledCount >= CONFIG.stalledLimit) {
        setStatus('단축키 반응이 없거나 더 줄어들지 않습니다.', { requestId, found: true, terminal: true });
        return { found: true, terminal: true };
      }
    }

    setStatus(`최대 ${CONFIG.maxPresses}회까지 적용했지만 ${lines}줄입니다.`, { requestId, found: true, terminal: true });
    return { found: true, terminal: true };
  }

  function handleFrameMessage(event) {
    const message = event.data;

    if (!message || message.source !== SOURCE || message.instanceId === INSTANCE_ID) {
      return;
    }

    if (message.type === MESSAGE.run) {
      handleRunMessage(message);
      return;
    }

    if (message.type === MESSAGE.abort) {
      handleAbortMessage(message);
      return;
    }

    if (message.type === MESSAGE.status) {
      handleStatusMessage(message);
    }
  }

  function handleRunMessage(message) {
    if (!message.requestId || handledRequests.has(message.requestId)) {
      return;
    }

    handledRequests.add(message.requestId);
    broadcastToChildFrames(message);

    if (running) {
      return;
    }

    running = true;
    abortRequested = false;
    currentRequestId = message.requestId;

    makeSelectedTextOneLine(message.requestId, {
      includeReachableFrames: false,
      silentNoSelection: true,
    })
      .catch((error) => {
        console.error('[draft-web-for-1row] failed to process frame selection', error);
        setStatus('iframe 안쪽 처리 중 오류가 발생했습니다.', {
          requestId: message.requestId,
          found: true,
          terminal: true,
        });
      })
      .finally(() => {
        running = false;
        abortRequested = false;
        currentRequestId = null;
      });
  }

  function handleAbortMessage(message) {
    if (message.requestId && message.requestId === currentRequestId) {
      abortRequested = true;
    }

    broadcastToChildFrames(message);
  }

  function handleStatusMessage(message) {
    if (!isTopFrame()) {
      window.parent.postMessage(message, '*');
      return;
    }

    const pending = pendingTopRuns.get(message.requestId);

    if (!pending || pending.resolved) {
      return;
    }

    if (message.found !== false) {
      markPendingClaimed(message.requestId);
    }

    setStatus(message.message);

    if (message.terminal) {
      finishPendingRun(message.requestId);
    }
  }

  function markPendingClaimed(requestId) {
    const pending = pendingTopRuns.get(requestId);

    if (!pending || pending.claimed) {
      return;
    }

    pending.claimed = true;
    clearTimeout(pending.waitTimer);
  }

  function finishPendingRun(requestId) {
    const pending = pendingTopRuns.get(requestId);

    if (!pending || pending.resolved) {
      return;
    }

    pending.resolved = true;
    clearTimeout(pending.waitTimer);
    clearTimeout(pending.overallTimer);
    pendingTopRuns.delete(requestId);
    pending.resolve();
  }

  function broadcastToChildFrames(message) {
    for (let index = 0; index < window.frames.length; index += 1) {
      try {
        window.frames[index].postMessage(message, '*');
      } catch (_error) {
        // Some frames may disappear while the broadcast is in progress.
      }
    }
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

  function getCurrentSelection(options = {}) {
    const localSelection = getSelectionFromWindow(window);

    if (localSelection) {
      return localSelection;
    }

    if (!options.includeReachableFrames) {
      return null;
    }

    const windows = collectReachableWindows(window);

    for (const win of windows) {
      if (win === window) {
        continue;
      }

      const selection = getSelectionFromWindow(win);

      if (selection) {
        return selection;
      }
    }

    return null;
  }

  function restoreLastSelection(options = {}) {
    if (!lastSelection) {
      return null;
    }

    if (!options.includeReachableFrames && lastSelection.win !== window) {
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
      ranges: Array.from(
        { length: selection.selection.rangeCount },
        (_value, index) => selection.selection.getRangeAt(index).cloneRange(),
      ),
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

  function setStatus(message, meta = {}) {
    if (isTopFrame()) {
      const panel = document.getElementById(UI_ID);
      const status = panel ? panel.querySelector('.status') : null;

      if (status) {
        status.textContent = message;
      }

      return;
    }

    const requestId = meta.requestId || currentRequestId;

    if (!requestId) {
      return;
    }

    window.parent.postMessage({
      source: SOURCE,
      type: MESSAGE.status,
      requestId,
      message,
      found: meta.found !== false,
      terminal: Boolean(meta.terminal),
      instanceId: INSTANCE_ID,
    }, '*');
  }

  function createRequestId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function sleep(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
})();
