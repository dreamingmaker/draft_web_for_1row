// ==UserScript==
// @name         Web Draft: 1 Line Maker
// @namespace    local.draft-web-for-1row
// @version      0.8.4
// @description  Adds fixed HWP letter-spacing buttons for selected text in a web draft editor.
// @match        *://*/*
// @include      about:blank
// @include      about:srcdoc
// @include      blob:*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_VERSION = '0.8.4';

  const CONFIG = {
    maxPresses: 60,
    settleMs: 80,
    stalledLimit: 8,
    requestWaitMs: 1200,
    overallWaitMs: 16000,
    diagnoseWaitMs: 1800,
    apiFallbackPresses: 4,
    apiExpandPresses: 2,
    apiDebugPresses: 1,
    apiFallbackDelayMs: 70,
    stopApiFallbackOnLineChange: true,
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
    diagnose: 'diagnose',
    diagnostic: 'diagnostic',
  };
  const INSTANCE_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

  let lastSelection = null;
  let running = false;
  let abortRequested = false;
  let currentRequestId = null;
  let lastDiagnosticText = '';

  const handledRequests = createValueStore();
  const handledDiagnosticRequests = createValueStore();
  const listenedDocuments = createValueStore();
  const pendingTopRuns = createKeyValueStore();
  const pendingDiagnostics = createKeyValueStore();

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

      #${UI_ID} .actions {
        display: flex;
        justify-content: flex-end;
        flex-wrap: wrap;
        gap: 6px;
      }

      #${UI_ID} button {
        min-width: 96px;
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

      #${UI_ID} button.increase {
        min-width: 96px;
        background: #166534;
      }

      #${UI_ID} button.increase:hover {
        background: #14532d;
      }

      #${UI_ID} button[data-running="true"] {
        background: #9f1239;
      }

      #${UI_ID} .status {
        display: none;
      }

      #${UI_ID} .debug {
        box-sizing: border-box;
        width: min(420px, calc(100vw - 36px));
        max-height: 220px;
        margin: 0;
        padding: 8px;
        overflow: auto;
        border: 1px solid rgba(0, 0, 0, 0.14);
        border-radius: 6px;
        background: rgba(17, 24, 39, 0.96);
        color: #f9fafb;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 11px;
        line-height: 1.45;
        text-align: left;
        user-select: text;
        white-space: pre-wrap;
      }

      #${UI_ID} .debug[hidden] {
        display: none;
      }
    `;

    const panel = document.createElement('div');
    panel.id = UI_ID;

    const status = document.createElement('div');
    status.className = 'status';
    status.hidden = true;
    status.setAttribute('aria-hidden', 'true');
    status.textContent = '텍스트를 드래그한 뒤 누르세요.';

    const actions = document.createElement('div');
    actions.className = 'actions';

    const runButton = document.createElement('button');
    runButton.type = 'button';
    runButton.textContent = '4칸 단축';
    runButton.title = '선택한 텍스트의 자간을 4칸 좁힙니다.';

    const increaseButton = document.createElement('button');
    increaseButton.type = 'button';
    increaseButton.className = 'increase';
    increaseButton.textContent = '2칸 늘리기';
    increaseButton.title = '선택한 텍스트의 자간을 2칸 넓힙니다.';

    const debug = document.createElement('pre');
    debug.className = 'debug';
    debug.hidden = true;

    actions.append(runButton, increaseButton);

    panel.append(status, actions, debug);
    document.documentElement.append(style, panel);

    panel.addEventListener('mousedown', (event) => event.preventDefault(), true);

    runButton.addEventListener('click', async () => {
      if (running) {
        requestAbort();
        return;
      }

      running = true;
      abortRequested = false;
      runButton.dataset.running = 'true';
      runButton.textContent = '중지';

      try {
        await runFixedHwpSpacingAction({
          button: runButton,
          actionId: 'CharShapeSpacingDecrease',
          label: '4칸 단축',
          presses: CONFIG.apiFallbackPresses,
        });
      } finally {
        running = false;
        abortRequested = false;
        currentRequestId = null;
        runButton.dataset.running = 'false';
        runButton.textContent = '4칸 단축';
      }
    });

    increaseButton.addEventListener('click', async () => {
      if (running) {
        requestAbort();
        return;
      }

      running = true;
      abortRequested = false;
      increaseButton.dataset.running = 'true';
      increaseButton.textContent = '중지';

      try {
        await runFixedHwpSpacingAction({
          button: increaseButton,
          actionId: 'CharShapeSpacingIncrease',
          label: '2칸 늘리기',
          presses: CONFIG.apiExpandPresses,
        });
      } finally {
        running = false;
        abortRequested = false;
        currentRequestId = null;
        increaseButton.dataset.running = 'false';
        increaseButton.textContent = '2칸 늘리기';
      }
    });
  }

  function requestAbort() {
    abortRequested = true;
    broadcastToChildFrames({
      source: SOURCE,
      type: MESSAGE.abort,
      requestId: currentRequestId,
      instanceId: INSTANCE_ID,
    });
    setStatus('중지 중...');
    console.info('[draft-web-for-1row] abort requested');
  }

  async function runFixedHwpSpacingAction({ actionId, label, presses }) {
    const requestId = createRequestId();
    currentRequestId = requestId;

    clearDebug();
    setStatus(`${label} 실행 중...`);

    const result = await applyHwpApiFallback(requestId, {
      includeReachableFrames: true,
      silentNoSelection: true,
      presses,
      actionId,
      debugLabel: label,
      forceDebug: false,
      silentReport: true,
      stopOnLineChange: CONFIG.stopApiFallbackOnLineChange,
    });

    if (!result.applied) {
      const text = [
        `${label} 실패`,
        `- 이유: ${result.reason || 'candidate-not-found'}`,
        '- HWP API 후보를 찾지 못했거나 실행이 실패했습니다.',
      ].join('\n');

      lastDiagnosticText = text;
      setStatus(`${label} 실패`);
      clearDebug();
      console.warn('[draft-web-for-1row] fixed HWP spacing action failed', result);
    }
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

  function runDiagnostic() {
    const requestId = createRequestId();
    const directFrames = getDirectFrameElementSnapshots();
    const sameOriginSnapshots = collectSameOriginWindowSnapshots();
    const responses = [
      buildDiagnosticSnapshot({
        requestId,
        framePath: [],
        channel: 'top-userscript',
      }),
    ];

    pendingDiagnostics.set(requestId, {
      responses,
      directFrames,
      sameOriginSnapshots,
      startedAt: Date.now(),
    });

    clearDebug();
    setStatus(`진단 중... iframe ${window.frames.length}개 확인`);

    broadcastDiagnosticToChildFrames({
      source: SOURCE,
      type: MESSAGE.diagnose,
      requestId,
      instanceId: INSTANCE_ID,
      framePath: [],
    });

    return new Promise((resolve) => {
      setTimeout(() => {
        const pending = pendingDiagnostics.get(requestId);

        if (!pending) {
          resolve(null);
          return;
        }

        const report = buildDiagnosticReport(requestId, pending);
        lastDiagnosticText = report.text;

        setStatus(report.status);
        showDebug(report.summary);

        console.groupCollapsed('[draft-web-for-1row] diagnostic report');
        console.log(report.data);
        console.log(report.text);
        console.groupEnd();

        pendingDiagnostics.delete(requestId);
        resolve(report);
      }, CONFIG.diagnoseWaitMs);
    });
  }

  async function copyLastDiagnostic() {
    if (!lastDiagnosticText) {
      setStatus('먼저 진단 버튼을 눌러 주세요.');
      return;
    }

    try {
      await navigator.clipboard.writeText(lastDiagnosticText);
      setStatus('진단 결과를 클립보드에 복사했습니다.');
    } catch (_error) {
      showDebug(`${lastDiagnosticText}\n\n클립보드 복사 권한이 없어 콘솔/패널에서 복사해 주세요.`);
      setStatus('복사 권한이 없어 패널과 콘솔에만 표시했습니다.');
    }
  }

  async function runHwpApiDebugPress() {
    const requestId = createRequestId();

    clearDebug();
    setStatus('HWP API 1회 테스트 중...');

    const result = await applyHwpApiFallback(requestId, {
      includeReachableFrames: true,
      silentNoSelection: true,
      presses: CONFIG.apiDebugPresses,
      debugLabel: 'HWP API 1회 테스트',
      forceDebug: true,
    });

    if (!result.applied) {
      const text = [
        'HWP API 1회 테스트 실패',
        `- 이유: ${result.reason || 'candidate-not-found'}`,
        '- 진단 버튼으로 HWP API 후보 수를 확인해 주세요.',
      ].join('\n');

      lastDiagnosticText = text;
      setStatus('HWP API 1회 테스트 실패');
      showDebug(text);
      console.warn('[draft-web-for-1row] HWP API debug press failed', result);
    }
  }

  async function makeSelectedTextOneLine(requestId, options = {}) {
    const selected = getCurrentSelection(options) || restoreLastSelection(options);

    if (!selected) {
      const apiFallback = await applyHwpApiFallback(requestId, options);

      if (apiFallback.applied) {
        return { found: true, terminal: true };
      }

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

    const initialLines = lines;
    const targetLines = Math.max(1, initialLines - 1);

    if (initialLines <= 1) {
      setStatus('이미 1줄입니다.', { requestId, found: true, terminal: true });
      return { found: true, terminal: true };
    }

    setStatus(`선택 영역 확인: ${initialLines}줄 -> 목표 ${targetLines}줄`, { requestId, found: true });

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

      if (lines <= targetLines) {
        setStatus(`완료: ${initialLines}줄 -> ${lines}줄, ${pressCount}회 적용했습니다.`, {
          requestId,
          found: true,
          terminal: true,
        });
        return { found: true, terminal: true };
      }

      const nextSignature = getRangeSignature(nextSelection.range);

      if (nextSignature === previousSignature) {
        stalledCount += 1;
      } else {
        stalledCount = 0;
        previousSignature = nextSignature;
      }

      setStatus(`조정 중: ${initialLines}줄 -> 목표 ${targetLines}줄, 현재 ${lines}줄, ${pressCount}회 적용`, {
        requestId,
        found: true,
      });

      if (stalledCount >= CONFIG.stalledLimit) {
        setStatus('단축키 반응이 없거나 더 줄어들지 않습니다.', { requestId, found: true, terminal: true });
        return { found: true, terminal: true };
      }
    }

    setStatus(`최대 ${CONFIG.maxPresses}회까지 적용했지만 ${lines}줄입니다. 목표는 ${targetLines}줄입니다.`, {
      requestId,
      found: true,
      terminal: true,
    });
    return { found: true, terminal: true };
  }

  async function applyHwpApiFallback(requestId, options = {}) {
    const target = findBestHwpActionTarget(options);
    const presses = normalizePressCount(options.presses, CONFIG.apiFallbackPresses);
    const actionId = options.actionId || 'CharShapeSpacingDecrease';
    const actionName = actionId === 'CharShapeSpacingIncrease' ? '자간 넓히기' : '자간 좁히기';
    const stopOnLineChange = options.stopOnLineChange !== undefined
      ? Boolean(options.stopOnLineChange)
      : CONFIG.stopApiFallbackOnLineChange;
    const label = options.debugLabel || 'HWP API fallback';
    const startedAt = Date.now();
    const actionResults = [];

    if (!target) {
      return {
        applied: false,
        reason: 'candidate-not-found',
        presses,
      };
    }

    let applied = 0;
    setStatus(`HWP API로 ${actionName} ${presses}회 시도 중...`, {
      requestId,
      found: true,
    });

    for (let index = 0; index < presses; index += 1) {
      if (abortRequested) {
        const report = buildApiFallbackReport({
          label,
          target,
          actionId,
          requestedPresses: presses,
          applied,
          actionResults,
          startedAt,
          stopped: true,
          stopOnLineChange,
        });

        finishApiFallbackReport(report, requestId, `중지했습니다. HWP API ${applied}회 적용했습니다.`, options);
        return { applied: applied > 0, report };
      }

      const beforeObservation = getHwpLayoutObservation(target.controller, {
        includeSelectionSpan: stopOnLineChange,
      });
      const actionStartedAt = Date.now();
      const result = runHwpAction(target.controller, actionId);
      const actionRecord = {
        index: index + 1,
        elapsedMs: Date.now() - actionStartedAt,
        ok: result.ok,
        via: result.via || null,
        reason: result.reason || null,
        before: beforeObservation,
        after: null,
        lineChanged: false,
      };
      actionResults.push(actionRecord);

      if (!result.ok) {
        console.warn('[draft-web-for-1row] HWP action failed', {
          target: target.description,
          result,
        });

        if (applied === 0) {
          const report = buildApiFallbackReport({
            label,
            target,
            actionId,
            requestedPresses: presses,
            applied,
            actionResults,
            startedAt,
            failure: result.reason,
            stopOnLineChange,
          });

          if (!options.silentReport && (options.forceDebug || options.includeReachableFrames)) {
            publishApiFallbackReport(report, requestId, `HWP API 후보는 찾았지만 실행 실패: ${result.reason}`);
          }

          return { applied: false, reason: result.reason, report };
        }

        break;
      }

      applied += 1;
      await sleep(CONFIG.apiFallbackDelayMs);

      actionRecord.after = getHwpLayoutObservation(target.controller, {
        includeSelectionSpan: stopOnLineChange,
      });
      actionRecord.lineChanged = didHwpLineChange(actionRecord.before, actionRecord.after);

      if (stopOnLineChange && actionRecord.lineChanged) {
        const report = buildApiFallbackReport({
          label,
          target,
          actionId,
          requestedPresses: presses,
          applied,
          actionResults,
          startedAt,
          stopReason: 'line-changed',
          stopOnLineChange,
        });
        const beforeLabel = describeLineSignature(actionRecord.before);
        const afterLabel = describeLineSignature(actionRecord.after);

        finishApiFallbackReport(
          report,
          requestId,
          `줄 변화 감지: ${beforeLabel} -> ${afterLabel}. HWP API ${applied}회에서 멈췄습니다.`,
          options,
        );

        return { applied: true, report, stoppedByLineChange: true };
      }
    }

    const report = buildApiFallbackReport({
      label,
      target,
      actionId,
      requestedPresses: presses,
      applied,
      actionResults,
      startedAt,
      stopReason: null,
      stopOnLineChange,
    });
    const message = `HWP API로 ${actionName} ${applied}회 적용했습니다.`;

    finishApiFallbackReport(report, requestId, message, options);

    return { applied: applied > 0, report };
  }

  function normalizePressCount(value, fallback) {
    const numberValue = +value;

    if (!isFiniteNumber(numberValue)) {
      return fallback;
    }

    return Math.max(1, Math.min(CONFIG.maxPresses, Math.floor(numberValue)));
  }

  function buildApiFallbackReport({
    label,
    target,
    actionId = 'CharShapeSpacingDecrease',
    requestedPresses,
    applied,
    actionResults,
    startedAt,
    stopped = false,
    failure = null,
    stopReason = null,
    stopOnLineChange = CONFIG.stopApiFallbackOnLineChange,
  }) {
    const actionName = actionId === 'CharShapeSpacingIncrease' ? '자간 넓히기' : '자간 좁히기';
    const elapsedMs = Date.now() - startedAt;
    const okCount = actionResults.filter((result) => result.ok).length;
    const failCount = actionResults.length - okCount;
    const observableCount = actionResults.filter((result) => {
      return result.before && result.before.lineSignature && result.after && result.after.lineSignature;
    }).length;
    const lineChangedCount = actionResults.filter((result) => result.lineChanged).length;
    const selectionSpanObservableCount = actionResults.filter((result) => {
      return result.before && result.before.lineSignatureSource === 'selection-span';
    }).length;
    const avgMs = actionResults.length
      ? Math.round(actionResults.reduce((sum, result) => sum + result.elapsedMs, 0) / actionResults.length)
      : 0;
    const summaryLines = [
      label,
      `- 액션: ${actionName} (${actionId})`,
      `- 요청 횟수: ${requestedPresses}`,
      `- 적용 횟수: ${applied}`,
      `- 실패 횟수: ${failCount}`,
      `- 총 시간: ${elapsedMs}ms`,
      `- 액션 평균: ${avgMs}ms`,
      `- 줄 관측 가능: ${observableCount}/${actionResults.length}`,
      `- 선택 범위 관측: ${selectionSpanObservableCount}/${actionResults.length}`,
      `- 줄 변화 감지: ${lineChangedCount}회`,
      `- 실행 경로: ${target.description.hasRun ? 'Run' : target.description.hasHActionRun ? 'HAction.Run' : 'CreateAction.Run'}`,
      `- 포커스 후보: ${target.description.hasFocus && !target.description.focusDelegatedToIframe ? 'Y' : 'N'}`,
      `- 중지됨: ${stopped ? 'Y' : 'N'}`,
      `- 중지 사유: ${stopReason || 'none'}`,
      `- 실패 사유: ${failure || 'none'}`,
      stopOnLineChange
        ? 'KeyIndicator 줄 값이 바뀌면 자동으로 멈춥니다. 관측 불가이면 설정 횟수만큼 실행합니다.'
        : '고정 횟수 모드입니다. 설정 횟수만큼 실행합니다.',
    ];
    const data = {
      script: SOURCE,
      version: SCRIPT_VERSION,
      label,
      actionId,
      actionName,
      requestedPresses,
      applied,
      failCount,
      elapsedMs,
      avgActionMs: avgMs,
      observableCount,
      selectionSpanObservableCount,
      lineChangedCount,
      stopped,
      stopOnLineChange,
      stopReason,
      failure,
      target: target.description,
      actionResults,
      collectedAt: new Date().toISOString(),
    };

    return {
      summary: summaryLines.join('\n'),
      text: `${summaryLines.join('\n')}\n\nJSON:\n${JSON.stringify(data, null, 2)}`,
      data,
    };
  }

  function publishApiFallbackReport(report, requestId, statusMessage) {
    lastDiagnosticText = report.text;
    setStatus(statusMessage, {
      requestId,
      found: true,
      terminal: true,
    });
    showDebug(report.summary);

    console.groupCollapsed('[draft-web-for-1row] HWP API action report');
    console.log(report.data);
    console.log(report.text);
    console.groupEnd();
  }

  function finishApiFallbackReport(report, requestId, statusMessage, options = {}) {
    if (options.silentReport) {
      lastDiagnosticText = report.text;
      setStatus(statusMessage, {
        requestId,
        found: true,
        terminal: true,
      });
      clearDebug();

      console.groupCollapsed('[draft-web-for-1row] HWP API action report');
      console.log(report.data);
      console.log(report.text);
      console.groupEnd();
      return;
    }

    publishApiFallbackReport(report, requestId, statusMessage);
  }

  function getHwpLayoutObservation(controller, options = {}) {
    const keyIndicator = readHwpKeyIndicator(controller);
    const pos = readHwpPosition(controller, 'GetPos');
    const selectedPos = readHwpPosition(controller, 'GetSelectedPos');
    const cursorLineSignature = buildHwpLineSignature(keyIndicator);
    const selectionSpan = options.includeSelectionSpan
      ? readHwpSelectionLineSpan(controller, selectedPos)
      : {
        available: false,
        reason: 'selection-span-probe-disabled',
      };
    const lineSignature = selectionSpan.spanSignature || cursorLineSignature;

    return {
      available: Boolean(lineSignature),
      lineSignature,
      cursorLineSignature,
      lineSignatureSource: selectionSpan.spanSignature ? 'selection-span' : 'cursor',
      keyIndicator,
      pos,
      selectedPos,
      selectionSpan,
      collectedAtMs: Date.now(),
    };
  }

  function readHwpKeyIndicator(controller) {
    if (!controller || typeof controller.KeyIndicator !== 'function') {
      return {
        available: false,
        reason: 'missing-KeyIndicator',
      };
    }

    try {
      const value = controller.KeyIndicator();
      return normalizeKeyIndicatorValue(value);
    } catch (error) {
      return {
        available: false,
        reason: error.name || 'KeyIndicator-error',
        message: String(error.message || error),
      };
    }
  }

  function normalizeKeyIndicatorValue(value) {
    if (Array.isArray(value)) {
      return {
        available: true,
        rawType: 'array',
        seccnt: toMaybeNumber(value[0]),
        secno: toMaybeNumber(value[1]),
        prnpageno: toMaybeNumber(value[2]),
        colno: toMaybeNumber(value[3]),
        line: toMaybeNumber(value[4]),
        pos: toMaybeNumber(value[5]),
        over: toMaybeNumber(value[6]),
        ctrlnameHash: value.length > 7 && value[7] ? hashString(String(value[7])) : null,
        rawLength: value.length,
      };
    }

    if (value && typeof value === 'object') {
      return {
        available: true,
        rawType: 'object',
        seccnt: firstNumericProperty(value, ['seccnt', 'SecCnt', 'sectionCount']),
        secno: firstNumericProperty(value, ['secno', 'SecNo', 'section']),
        prnpageno: firstNumericProperty(value, ['prnpageno', 'PrnPageNo', 'page', 'Page']),
        colno: firstNumericProperty(value, ['colno', 'ColNo', 'column', 'Column']),
        line: firstNumericProperty(value, ['line', 'Line']),
        pos: firstNumericProperty(value, ['pos', 'Pos', 'working_pos', 'workingPos']),
        over: firstNumericProperty(value, ['over', 'Over']),
        ctrlnameHash: firstStringPropertyHash(value, ['ctrlname', 'CtrlName', 'ctrlName']),
        keys: safeObjectKeys(value).slice(0, 12),
      };
    }

    if (typeof value === 'string') {
      return {
        available: true,
        rawType: 'string',
        rawHash: hashString(value),
        rawLength: value.length,
      };
    }

    return {
      available: false,
      reason: `unsupported-return-${typeof value}`,
    };
  }

  function readHwpPosition(controller, methodName) {
    if (!controller || typeof controller[methodName] !== 'function') {
      return {
        available: false,
        reason: `missing-${methodName}`,
      };
    }

    try {
      const value = controller[methodName]();
      return normalizeHwpPositionValue(value);
    } catch (error) {
      return {
        available: false,
        reason: error.name || `${methodName}-error`,
        message: String(error.message || error),
      };
    }
  }

  function normalizeHwpPositionValue(value) {
    if (Array.isArray(value)) {
      return {
        available: true,
        rawType: 'array',
        list: toMaybeNumber(value[0]),
        para: toMaybeNumber(value[1]),
        pos: toMaybeNumber(value[2]),
        rawLength: value.length,
      };
    }

    if (value && typeof value === 'object') {
      const slist = firstNumericProperty(value, ['slist', 'SList']);
      const spara = firstNumericProperty(value, ['spara', 'SPara']);
      const spos = firstNumericProperty(value, ['spos', 'SPos']);
      const elist = firstNumericProperty(value, ['elist', 'EList']);
      const epara = firstNumericProperty(value, ['epara', 'EPara']);
      const epos = firstNumericProperty(value, ['epos', 'EPos']);

      return {
        available: true,
        rawType: 'object',
        list: firstNumericProperty(value, ['list', 'List']),
        para: firstNumericProperty(value, ['para', 'Para']),
        pos: firstNumericProperty(value, ['pos', 'Pos']),
        slist,
        spara,
        spos,
        elist,
        epara,
        epos,
        hasSelectionRange: hasNumericPositionTriplet(slist, spara, spos)
          && hasNumericPositionTriplet(elist, epara, epos)
          && `${slist}:${spara}:${spos}` !== `${elist}:${epara}:${epos}`,
        keys: safeObjectKeys(value).slice(0, 12),
      };
    }

    return {
      available: false,
      reason: `unsupported-return-${typeof value}`,
    };
  }

  function buildHwpLineSignature(keyIndicator) {
    if (!keyIndicator || !keyIndicator.available || typeof keyIndicator.line !== 'number') {
      return null;
    }

    return [
      typeof keyIndicator.prnpageno === 'number' ? keyIndicator.prnpageno : '?',
      typeof keyIndicator.colno === 'number' ? keyIndicator.colno : '?',
      keyIndicator.line,
    ].join(':');
  }

  function readHwpSelectionLineSpan(controller, selectedPos) {
    if (!selectedPos || !selectedPos.available || !selectedPos.hasSelectionRange) {
      return {
        available: false,
        reason: 'missing-selected-range',
      };
    }

    if (!controller || typeof controller.SetPos !== 'function') {
      return {
        available: false,
        reason: 'missing-SetPos',
      };
    }

    const start = {
      list: selectedPos.slist,
      para: selectedPos.spara,
      pos: selectedPos.spos,
    };
    const end = {
      list: selectedPos.elist,
      para: selectedPos.epara,
      pos: selectedPos.epos,
    };
    const startLine = readHwpLineAtPosition(controller, start);
    const endLine = readHwpLineAtPosition(controller, end);
    const restore = restoreHwpSelection(controller, selectedPos);

    if (!startLine.lineSignature || !endLine.lineSignature) {
      return {
        available: false,
        reason: 'line-read-failed',
        start,
        end,
        startLine,
        endLine,
        restore,
      };
    }

    return {
      available: true,
      start,
      end,
      startLine,
      endLine,
      restore,
      spanSignature: `${startLine.lineSignature}->${endLine.lineSignature}`,
    };
  }

  function readHwpLineAtPosition(controller, position) {
    if (!hasNumericPositionTriplet(position.list, position.para, position.pos)) {
      return {
        available: false,
        reason: 'invalid-position',
      };
    }

    try {
      controller.SetPos(position.list, position.para, position.pos);
    } catch (error) {
      return {
        available: false,
        reason: error.name || 'SetPos-error',
        message: String(error.message || error),
      };
    }

    const keyIndicator = readHwpKeyIndicator(controller);

    return {
      available: Boolean(buildHwpLineSignature(keyIndicator)),
      lineSignature: buildHwpLineSignature(keyIndicator),
      keyIndicator,
    };
  }

  function restoreHwpSelection(controller, selectedPos) {
    if (!controller || typeof controller.SelectText !== 'function') {
      return {
        ok: false,
        reason: 'missing-SelectText',
      };
    }

    try {
      return {
        ok: true,
        via: 'SelectText4',
        value: controller.SelectText(selectedPos.spara, selectedPos.spos, selectedPos.epara, selectedPos.epos),
      };
    } catch (firstError) {
      try {
        return {
          ok: true,
          via: 'SelectText6',
          value: controller.SelectText(
            selectedPos.slist,
            selectedPos.spara,
            selectedPos.spos,
            selectedPos.elist,
            selectedPos.epara,
            selectedPos.epos,
          ),
        };
      } catch (secondError) {
        return {
          ok: false,
          reason: secondError.name || firstError.name || 'SelectText-error',
          message: String(secondError.message || firstError.message || secondError || firstError),
        };
      }
    }
  }

  function didHwpLineChange(before, after) {
    if (!before || !after || !before.lineSignature || !after.lineSignature) {
      return false;
    }

    return before.lineSignature !== after.lineSignature;
  }

  function describeLineSignature(observation) {
    if (!observation || !observation.lineSignature) {
      return '관측 불가';
    }

    return observation.lineSignature;
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
      return;
    }

    if (message.type === MESSAGE.diagnose) {
      handleDiagnoseMessage(message);
      return;
    }

    if (message.type === MESSAGE.diagnostic) {
      handleDiagnosticMessage(message);
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

  function handleDiagnoseMessage(message) {
    if (!message.requestId || handledDiagnosticRequests.has(message.requestId)) {
      return;
    }

    handledDiagnosticRequests.add(message.requestId);

    postDiagnosticSnapshot(buildDiagnosticSnapshot({
      requestId: message.requestId,
      framePath: Array.isArray(message.framePath) ? message.framePath : [],
      channel: 'frame-userscript',
    }));

    broadcastDiagnosticToChildFrames(message);
  }

  function handleDiagnosticMessage(message) {
    if (!isTopFrame()) {
      window.parent.postMessage(message, '*');
      return;
    }

    const pending = pendingDiagnostics.get(message.requestId);

    if (!pending || !message.diagnostic) {
      return;
    }

    pending.responses.push(message.diagnostic);
    setStatus(`진단 중... 응답 ${pending.responses.length}개 수집`);
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

  function broadcastDiagnosticToChildFrames(message) {
    const basePath = Array.isArray(message.framePath) ? message.framePath : [];

    for (let index = 0; index < window.frames.length; index += 1) {
      try {
        window.frames[index].postMessage({
          ...message,
          framePath: basePath.concat(index),
        }, '*');
      } catch (_error) {
        // Some frames may disappear while the broadcast is in progress.
      }
    }
  }

  function postDiagnosticSnapshot(diagnostic) {
    const message = {
      source: SOURCE,
      type: MESSAGE.diagnostic,
      requestId: diagnostic.requestId,
      diagnostic,
      instanceId: INSTANCE_ID,
    };

    if (isTopFrame()) {
      handleDiagnosticMessage(message);
      return;
    }

    window.parent.postMessage(message, '*');
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

  function findBestHwpActionTarget(options = {}) {
    const windows = options.includeReachableFrames ? collectReachableWindows(window) : [window];
    const focused = [];
    const focusedDelegating = [];
    const fallback = [];

    windows.forEach((win) => {
      const focusDelegatedToIframe = isFocusDelegatingToChildFrame(win);

      if (focusDelegatedToIframe && !options.includeReachableFrames) {
        return;
      }

      const candidates = getHwpControllerCandidates(win);

      candidates.forEach((candidate) => {
        const item = {
          controller: candidate.value,
          description: describeHwpControllerCandidate(candidate),
        };

        if (safeDocumentHasFocus(win.document)) {
          if (focusDelegatedToIframe) {
            focusedDelegating.push(item);
          } else {
            focused.push(item);
          }
        } else {
          fallback.push(item);
        }
      });
    });

    return focused[0] || focusedDelegating[0] || fallback[0] || null;
  }

  function getHwpControllerCandidates(win) {
    const candidates = [];
    const seen = createValueStore();

    addKnownHwpControllerCandidates(win, candidates, seen);
    addNamedHwpControllerCandidates(win, candidates, seen);
    addDomHwpControllerCandidates(win, candidates, seen);

    return candidates.filter((candidate) => isRunnableHwpController(candidate.value));
  }

  function addKnownHwpControllerCandidates(win, candidates, seen) {
    [
      'HwpCtrl',
      'hwpCtrl',
      'HwpCtrl1',
      'hwpCtrl1',
      'HwpObject',
      'hwpObject',
      'hwp',
      'webHwp',
      'WebHwp',
    ].forEach((key) => {
      addHwpCandidate(candidates, seen, getWindowValue(win, key), {
        source: 'known-global',
        key,
        win,
      });
    });
  }

  function addNamedHwpControllerCandidates(win, candidates, seen) {
    getWindowKeys(win).forEach((key) => {
      if (!/hwp|webhwp|haction|hparameter/i.test(key)) {
        return;
      }

      addHwpCandidate(candidates, seen, getWindowValue(win, key), {
        source: 'named-global',
        key,
        win,
      });
    });
  }

  function addDomHwpControllerCandidates(win, candidates, seen) {
    const elements = getPotentialHwpElements(win.document);

    elements.forEach((element) => {
      addHwpCandidate(candidates, seen, element, {
        source: 'dom-element',
        key: element.tagName ? element.tagName.toLowerCase() : 'element',
        win,
      });
    });
  }

  function addHwpCandidate(candidates, seen, value, meta) {
    if (!value || seen.has(value) || !looksLikeHwpController(value)) {
      return;
    }

    seen.add(value);
    candidates.push({
      value,
      meta,
    });
  }

  function getWindowKeys(win) {
    try {
      return Object.getOwnPropertyNames(win);
    } catch (_error) {
      try {
        return Object.keys(win);
      } catch (__error) {
        return [];
      }
    }
  }

  function getWindowValue(win, key) {
    try {
      return win[key];
    } catch (_error) {
      return null;
    }
  }

  function safeObjectKeys(value) {
    try {
      return Object.keys(value);
    } catch (_error) {
      return [];
    }
  }

  function firstNumericProperty(value, keys) {
    for (let index = 0; index < keys.length; index += 1) {
      const raw = safeProperty(value, keys[index]);
      const numberValue = toMaybeNumber(raw);

      if (typeof numberValue === 'number') {
        return numberValue;
      }
    }

    return null;
  }

  function firstStringPropertyHash(value, keys) {
    for (let index = 0; index < keys.length; index += 1) {
      const raw = safeProperty(value, keys[index]);

      if (typeof raw === 'string' && raw) {
        return hashString(raw);
      }
    }

    return null;
  }

  function hasNumericPositionTriplet(list, para, pos) {
    return typeof list === 'number' && typeof para === 'number' && typeof pos === 'number';
  }

  function safeProperty(value, key) {
    try {
      return value[key];
    } catch (_error) {
      return undefined;
    }
  }

  function toMaybeNumber(value) {
    const numberValue = +value;
    return isFiniteNumber(numberValue) ? numberValue : null;
  }

  function isFiniteNumber(value) {
    return typeof value === 'number' && value === value && value !== Infinity && value !== -Infinity;
  }

  function getPotentialHwpElements(doc) {
    try {
      return Array.from(doc.querySelectorAll('object, embed, applet, [id], [name]')).filter((element) => {
        const text = `${element.id || ''} ${element.getAttribute('name') || ''} ${element.getAttribute('type') || ''}`;
        return /hwp|hancom|webhwp/i.test(text) || looksLikeHwpController(element);
      });
    } catch (_error) {
      return [];
    }
  }

  function looksLikeHwpController(value) {
    if (!value) {
      return false;
    }

    return isRunnableHwpController(value)
      || Boolean(value.HAction && typeof value.HAction.Run === 'function')
      || Boolean(value.HParameterSet)
      || Boolean(value.HwpCtrl)
      || Boolean(value.hwpCtrl);
  }

  function isRunnableHwpController(value) {
    if (!value) {
      return false;
    }

    return typeof value.Run === 'function'
      || Boolean(value.HAction && typeof value.HAction.Run === 'function')
      || typeof value.CreateAction === 'function';
  }

  function runHwpAction(controller, actionId) {
    try {
      if (controller && typeof controller.Run === 'function') {
        return {
          ok: true,
          via: 'Run',
          value: controller.Run(actionId),
        };
      }

      if (controller && controller.HAction && typeof controller.HAction.Run === 'function') {
        return {
          ok: true,
          via: 'HAction.Run',
          value: controller.HAction.Run(actionId),
        };
      }

      if (controller && typeof controller.CreateAction === 'function') {
        const action = controller.CreateAction(actionId);

        if (action && typeof action.Run === 'function') {
          return {
            ok: true,
            via: 'CreateAction.Run',
            value: action.Run(),
          };
        }
      }

      return {
        ok: false,
        reason: 'no-runnable-method',
      };
    } catch (error) {
      return {
        ok: false,
        reason: error.name || 'action-error',
        message: String(error.message || error),
      };
    }
  }

  function describeHwpControllerCandidate(candidate) {
    const value = candidate.value;
    const layoutObservation = getHwpLayoutObservation(value);

    return {
      source: candidate.meta.source,
      key: candidate.meta.key,
      hasRun: Boolean(value && typeof value.Run === 'function'),
      hasHActionRun: Boolean(value && value.HAction && typeof value.HAction.Run === 'function'),
      hasCreateAction: Boolean(value && typeof value.CreateAction === 'function'),
      hasKeyIndicator: Boolean(value && typeof value.KeyIndicator === 'function'),
      hasHParameterSet: Boolean(value && value.HParameterSet),
      hasHwpCtrl: Boolean(value && (value.HwpCtrl || value.hwpCtrl)),
      hasFocus: safeDocumentHasFocus(candidate.meta.win.document),
      focusDelegatedToIframe: isFocusDelegatingToChildFrame(candidate.meta.win),
      layoutObservable: Boolean(layoutObservation.lineSignature),
      lineSignature: layoutObservation.lineSignature,
      keyIndicatorReason: layoutObservation.keyIndicator && layoutObservation.keyIndicator.reason
        ? layoutObservation.keyIndicator.reason
        : null,
    };
  }

  function describeHwpControllerCandidates(win) {
    return getHwpControllerCandidates(win).map(describeHwpControllerCandidate);
  }

  function isFocusDelegatingToChildFrame(win) {
    try {
      const active = win.document.activeElement;
      return Boolean(active && active.tagName && active.tagName.toLowerCase() === 'iframe');
    } catch (_error) {
      return false;
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

  function buildDiagnosticSnapshot({ requestId, framePath, channel, win = window, inspectionIndex = null }) {
    const doc = win.document;
    const activeElement = doc.activeElement;

    return {
      requestId,
      version: SCRIPT_VERSION,
      channel,
      instanceId: INSTANCE_ID,
      framePath: formatFramePath(framePath),
      frameDepth: Array.isArray(framePath) ? framePath.length : null,
      inspectionIndex,
      isTopFrame: isWindowTop(win),
      url: sanitizeUrl(win.location.href),
      readyState: doc.readyState,
      hasFocus: safeDocumentHasFocus(doc),
      childFrameCount: win.frames.length,
      iframeElementCount: safeCountSelector(doc, 'iframe'),
      contentEditableCount: safeCountSelector(doc, '[contenteditable]:not([contenteditable="false"])'),
      textareaCount: safeCountSelector(doc, 'textarea'),
      inputCount: safeCountSelector(doc, 'input'),
      surfaceCounts: describeSurfaceCounts(doc),
      hwpControllerCandidates: describeHwpControllerCandidates(win),
      activeElement: describeElement(activeElement),
      textControlSelection: describeTextControlSelection(activeElement),
      selection: describeSelection(win),
      lastSelection: describeLastSelection(win),
      collectedAt: new Date().toISOString(),
    };
  }

  function describeSelection(win) {
    try {
      const selection = win.getSelection();

      if (!selection) {
        return {
          available: false,
          hasSelection: false,
          reason: 'no-selection-object',
        };
      }

      const textLength = selection.toString().length;
      const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

      return {
        available: true,
        hasSelection: !selection.isCollapsed && selection.rangeCount > 0,
        isCollapsed: selection.isCollapsed,
        rangeCount: selection.rangeCount,
        textLength,
        lineCount: range ? countSelectionLines(range) : 0,
        rectCount: range ? getUsefulRects(range).length : 0,
        rangeBox: range ? describeRect(range.getBoundingClientRect()) : null,
        commonAncestor: range ? describeNode(range.commonAncestorContainer) : null,
        anchorNode: describeNode(selection.anchorNode),
        focusNode: describeNode(selection.focusNode),
      };
    } catch (error) {
      return {
        available: false,
        hasSelection: false,
        reason: error.name || 'selection-error',
      };
    }
  }

  function describeLastSelection(win = window) {
    if (!lastSelection || !lastSelection.ranges.length) {
      return {
        available: false,
        hasSelection: false,
      };
    }

    if (lastSelection.win !== win) {
      return {
        available: false,
        hasSelection: false,
        reason: 'selection-belongs-to-another-window',
      };
    }

    try {
      const range = lastSelection.ranges[0];

      return {
        available: true,
        hasSelection: !range.collapsed,
        rangeCount: lastSelection.ranges.length,
        lineCount: countSelectionLines(range),
        rectCount: getUsefulRects(range).length,
        rangeBox: describeRect(range.getBoundingClientRect()),
        commonAncestor: describeNode(range.commonAncestorContainer),
      };
    } catch (error) {
      return {
        available: false,
        hasSelection: false,
        reason: error.name || 'last-selection-error',
      };
    }
  }

  function describeTextControlSelection(element) {
    if (!isTextControl(element)) {
      return {
        available: false,
        hasSelection: false,
      };
    }

    try {
      const start = element.selectionStart;
      const end = element.selectionEnd;

      if (typeof start !== 'number' || typeof end !== 'number') {
        return {
          available: false,
          hasSelection: false,
          reason: 'selectionStart-unavailable',
        };
      }

      return {
        available: true,
        hasSelection: end > start,
        selectionLength: Math.max(0, end - start),
        valueLength: typeof element.value === 'string' ? element.value.length : null,
      };
    } catch (error) {
      return {
        available: false,
        hasSelection: false,
        reason: error.name || 'text-control-selection-error',
      };
    }
  }

  function describeSurfaceCounts(doc) {
    return {
      canvas: safeCountSelector(doc, 'canvas'),
      object: safeCountSelector(doc, 'object'),
      embed: safeCountSelector(doc, 'embed'),
      applet: safeCountSelector(doc, 'applet'),
      svg: safeCountSelector(doc, 'svg'),
      video: safeCountSelector(doc, 'video'),
      customElements: countCustomElements(doc),
      hwpNamedElements: countHwpNamedElements(doc),
    };
  }

  function countCustomElements(doc) {
    try {
      return Array.from(doc.querySelectorAll('*')).filter((element) => {
        return element.tagName && element.tagName.indexOf('-') !== -1;
      }).length;
    } catch (_error) {
      return null;
    }
  }

  function countHwpNamedElements(doc) {
    try {
      return Array.from(doc.querySelectorAll('[id], [name], object, embed, applet')).filter((element) => {
        const text = `${element.id || ''} ${element.getAttribute('name') || ''} ${element.getAttribute('type') || ''}`;
        return /hwp|hancom|webhwp/i.test(text);
      }).length;
    } catch (_error) {
      return null;
    }
  }

  function getDirectFrameElementSnapshots() {
    const frames = Array.from(document.querySelectorAll('iframe'));

    return frames.map((frame, index) => {
      const rect = frame.getBoundingClientRect();
      const access = getFrameAccessInfo(index);

      return {
        index,
        src: sanitizeUrl(frame.getAttribute('src') || frame.src || ''),
        titleHash: frame.getAttribute('title') ? hashString(frame.getAttribute('title')) : null,
        nameHash: frame.getAttribute('name') ? hashString(frame.getAttribute('name')) : null,
        idHash: frame.id ? hashString(frame.id) : null,
        classHash: frame.className ? hashString(String(frame.className)) : null,
        sandbox: describeSandbox(frame),
        visible: rect.width > 0 && rect.height > 0,
        rect: describeRect(rect),
        accessible: access.accessible,
        access,
      };
    });
  }

  function collectSameOriginWindowSnapshots() {
    return collectReachableWindows(window)
      .filter((win) => win !== window)
      .map((win, index) => {
        try {
          return buildDiagnosticSnapshot({
            requestId: 'same-origin-inspection',
            framePath: null,
            channel: 'top-same-origin-inspection',
            win,
            inspectionIndex: index,
          });
        } catch (error) {
          return {
            channel: 'top-same-origin-inspection',
            inspectionIndex: index,
            error: error.name || 'inspection-error',
          };
        }
      });
  }

  function buildDiagnosticReport(requestId, pending) {
    const responses = pending.responses.slice();
    const sameOriginSnapshots = pending.sameOriginSnapshots.slice();
    const allSnapshots = responses.concat(sameOriginSnapshots);
    const directFrames = pending.directFrames;
    const elapsedMs = Date.now() - pending.startedAt;
    const topFrameCount = window.frames.length;
    const frameResponses = responses.filter((snapshot) => !snapshot.isTopFrame).length;
    const currentSelectionCount = allSnapshots.filter((snapshot) => hasCurrentDomSelection(snapshot)).length;
    const rememberedSelectionCount = allSnapshots.filter((snapshot) => hasRememberedSelection(snapshot)).length;
    const textControlSelectionCount = allSnapshots.filter((snapshot) => hasTextControlSelection(snapshot)).length;
    const accessibleDirectFrames = directFrames.filter((frame) => frame.accessible).length;
    const sandboxedFrames = directFrames.filter((frame) => frame.sandbox.present).length;
    const contentEditableTotal = sumSnapshots(allSnapshots, 'contentEditableCount');
    const hwpControllerTotal = sumArrayLengths(allSnapshots, 'hwpControllerCandidates');
    const focusedHwpControllerTotal = allSnapshots.reduce((sum, snapshot) => {
      const candidates = snapshot && Array.isArray(snapshot.hwpControllerCandidates) ? snapshot.hwpControllerCandidates : [];
      return sum + candidates.filter((candidate) => candidate.hasFocus && !candidate.focusDelegatedToIframe).length;
    }, 0);
    const layoutObservableHwpTotal = allSnapshots.reduce((sum, snapshot) => {
      const candidates = snapshot && Array.isArray(snapshot.hwpControllerCandidates) ? snapshot.hwpControllerCandidates : [];
      return sum + candidates.filter((candidate) => candidate.layoutObservable).length;
    }, 0);
    const surfaceTotals = sumSurfaceCounts(allSnapshots);
    const hints = buildDiagnosticHints({
      topFrameCount,
      frameResponses,
      currentSelectionCount,
      rememberedSelectionCount,
      textControlSelectionCount,
      accessibleDirectFrames,
      directFrameCount: directFrames.length,
      sandboxedFrames,
      contentEditableTotal,
      hwpControllerTotal,
      focusedHwpControllerTotal,
      layoutObservableHwpTotal,
      surfaceTotals,
    });

    const summaryLines = [
      `진단 완료 (${elapsedMs}ms)`,
      `- 상위 iframe: ${topFrameCount}개`,
      `- userscript 응답: ${responses.length}개 (iframe ${frameResponses}개)`,
      `- 현재 DOM 선택 발견: ${currentSelectionCount}개`,
      `- 저장된 선택 후보: ${rememberedSelectionCount}개`,
      `- input/textarea 선택: ${textControlSelectionCount}개`,
      `- 같은 출처 접근 가능 iframe: ${accessibleDirectFrames}/${directFrames.length}개`,
      `- contenteditable 후보: ${contentEditableTotal}개`,
      `- HWP API 후보: ${hwpControllerTotal}개 (포커스 후보 ${focusedHwpControllerTotal}개)`,
      `- HWP 줄 관측 후보: ${layoutObservableHwpTotal}개`,
      `- 렌더링 표면: canvas ${surfaceTotals.canvas}, object ${surfaceTotals.object}, embed ${surfaceTotals.embed}, HWP 이름 요소 ${surfaceTotals.hwpNamedElements}`,
      ...hints.map((hint) => `- ${hint}`),
      '상세 JSON은 콘솔에 기록했습니다. 필요하면 복사 버튼을 누르세요.',
    ];

    const data = {
      script: SOURCE,
      version: SCRIPT_VERSION,
      requestId,
      elapsedMs,
      summary: {
        topFrameCount,
        userscriptResponseCount: responses.length,
        frameResponseCount: frameResponses,
        currentSelectionCount,
        rememberedSelectionCount,
        textControlSelectionCount,
        accessibleDirectFrames,
        directFrameCount: directFrames.length,
        sandboxedFrames,
        contentEditableTotal,
        hwpControllerTotal,
        focusedHwpControllerTotal,
        layoutObservableHwpTotal,
        surfaceTotals,
      },
      hints,
      userscriptResponses: responses,
      sameOriginSnapshots,
      directFrames,
    };

    return {
      status: currentSelectionCount > 0 || rememberedSelectionCount > 0
        ? `진단 완료: 선택 후보 ${currentSelectionCount + rememberedSelectionCount}개 발견`
        : '진단 완료: 선택 영역 0개',
      summary: summaryLines.join('\n'),
      text: `${summaryLines.join('\n')}\n\nJSON:\n${JSON.stringify(data, null, 2)}`,
      data,
    };
  }

  function buildDiagnosticHints(info) {
    const hints = [];

    if (info.topFrameCount > 0 && info.frameResponses === 0) {
      hints.push('iframe userscript 응답이 없습니다. Tampermonkey가 iframe에서 실행되지 않거나 about:blank/blob/sandbox iframe일 수 있습니다.');
    }

    if (info.currentSelectionCount === 0 && info.rememberedSelectionCount === 0 && info.textControlSelectionCount === 0) {
      hints.push('DOM Selection API에서 선택 텍스트를 못 보고 있습니다. 편집기가 canvas/전용 렌더러일 가능성이 있습니다.');
    }

    if (info.hwpControllerTotal > 0 && info.currentSelectionCount === 0) {
      hints.push('HWP API 후보가 보입니다. DOM 선택 대신 HWP 액션 직접 실행 경로를 사용할 수 있습니다.');
    }

    if (info.focusedHwpControllerTotal > 0) {
      hints.push('포커스된 HWP API 후보가 있습니다. 4칸 단축/2칸 늘리기 버튼이 HWP API를 실행합니다.');
    }

    if (info.layoutObservableHwpTotal > 0) {
      hints.push('HWP 줄 관측 후보가 있습니다. API fallback은 줄 번호가 바뀌면 자동으로 멈춥니다.');
    } else if (info.hwpControllerTotal > 0) {
      hints.push('HWP API 후보는 있지만 줄 관측 후보가 없습니다. 이 경우 설정 횟수만큼 실행합니다.');
    }

    if (info.rememberedSelectionCount > 0 && info.currentSelectionCount === 0) {
      hints.push('선택이 한 번은 잡혔지만 버튼 클릭 후 사라집니다. focus/selection 복원 경로를 강화해야 합니다.');
    }

    if (info.currentSelectionCount > 0) {
      hints.push('선택 영역은 보입니다. 다음 문제는 Alt+Shift+N 이벤트가 에디터에 먹히는지입니다.');
    }

    if (info.directFrameCount > 0 && info.accessibleDirectFrames === 0) {
      hints.push('상위 페이지에서 직접 접근 가능한 iframe이 없습니다. iframe 내부 userscript 응답이 특히 중요합니다.');
    }

    if (info.sandboxedFrames > 0) {
      hints.push(`sandbox iframe ${info.sandboxedFrames}개가 있습니다. sandbox 설정이 스크립트 주입을 막을 수 있습니다.`);
    }

    if (info.contentEditableTotal === 0 && info.currentSelectionCount === 0) {
      hints.push('contenteditable 후보가 없습니다. 일반 웹 편집기가 아닌 렌더링 표면일 수 있습니다.');
    }

    return hints.slice(0, 5);
  }

  function hasCurrentDomSelection(snapshot) {
    return Boolean(snapshot && snapshot.selection && snapshot.selection.hasSelection);
  }

  function hasRememberedSelection(snapshot) {
    return Boolean(snapshot && snapshot.lastSelection && snapshot.lastSelection.hasSelection);
  }

  function hasTextControlSelection(snapshot) {
    return Boolean(snapshot && snapshot.textControlSelection && snapshot.textControlSelection.hasSelection);
  }

  function sumSnapshots(snapshots, key) {
    return snapshots.reduce((sum, snapshot) => {
      const value = snapshot && typeof snapshot[key] === 'number' ? snapshot[key] : 0;
      return sum + value;
    }, 0);
  }

  function sumArrayLengths(snapshots, key) {
    return snapshots.reduce((sum, snapshot) => {
      const value = snapshot && Array.isArray(snapshot[key]) ? snapshot[key].length : 0;
      return sum + value;
    }, 0);
  }

  function sumSurfaceCounts(snapshots) {
    return snapshots.reduce((sum, snapshot) => {
      const counts = snapshot && snapshot.surfaceCounts ? snapshot.surfaceCounts : {};

      sum.canvas += numberOrZero(counts.canvas);
      sum.object += numberOrZero(counts.object);
      sum.embed += numberOrZero(counts.embed);
      sum.applet += numberOrZero(counts.applet);
      sum.svg += numberOrZero(counts.svg);
      sum.video += numberOrZero(counts.video);
      sum.customElements += numberOrZero(counts.customElements);
      sum.hwpNamedElements += numberOrZero(counts.hwpNamedElements);

      return sum;
    }, {
      canvas: 0,
      object: 0,
      embed: 0,
      applet: 0,
      svg: 0,
      video: 0,
      customElements: 0,
      hwpNamedElements: 0,
    });
  }

  function numberOrZero(value) {
    return typeof value === 'number' ? value : 0;
  }

  function getFrameAccessInfo(index) {
    try {
      const child = window.frames[index];

      if (!child) {
        return {
          accessible: false,
          reason: 'missing-window',
        };
      }

      void child.document;

      return {
        accessible: true,
        url: sanitizeUrl(child.location.href),
        readyState: child.document.readyState,
        childFrameCount: child.frames.length,
      };
    } catch (error) {
      return {
        accessible: false,
        reason: error.name || 'blocked',
      };
    }
  }

  function describeSandbox(frame) {
    const value = frame.getAttribute('sandbox');

    if (value === null) {
      return {
        present: false,
        tokens: [],
      };
    }

    return {
      present: true,
      tokens: value.split(/\s+/).filter(Boolean).sort(),
    };
  }

  function describeElement(element) {
    if (!element) {
      return null;
    }

    return {
      tag: element.tagName ? element.tagName.toLowerCase() : null,
      idHash: element.id ? hashString(element.id) : null,
      classHash: element.className ? hashString(String(element.className)) : null,
      classCount: typeof element.className === 'string' && element.className.trim()
        ? element.className.trim().split(/\s+/).length
        : 0,
      role: element.getAttribute ? element.getAttribute('role') : null,
      contentEditable: element.getAttribute ? element.getAttribute('contenteditable') : null,
      isContentEditable: Boolean(element.isContentEditable),
      editableAncestor: describeEditableAncestor(element),
    };
  }

  function describeEditableAncestor(element) {
    try {
      const editable = element.closest('[contenteditable]:not([contenteditable="false"]), textarea, input');

      if (!editable) {
        return null;
      }

      return {
        tag: editable.tagName ? editable.tagName.toLowerCase() : null,
        idHash: editable.id ? hashString(editable.id) : null,
        classHash: editable.className ? hashString(String(editable.className)) : null,
        contentEditable: editable.getAttribute ? editable.getAttribute('contenteditable') : null,
      };
    } catch (_error) {
      return null;
    }
  }

  function describeNode(node) {
    if (!node) {
      return null;
    }

    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;

    return {
      nodeType: node.nodeType,
      nodeName: node.nodeName,
      parentElement: describeElement(element),
    };
  }

  function describeRect(rect) {
    if (!rect) {
      return null;
    }

    return {
      left: roundNumber(rect.left),
      top: roundNumber(rect.top),
      right: roundNumber(rect.right),
      bottom: roundNumber(rect.bottom),
      width: roundNumber(rect.width),
      height: roundNumber(rect.height),
    };
  }

  function isTextControl(element) {
    if (!element || !element.tagName) {
      return false;
    }

    const tag = element.tagName.toLowerCase();

    if (tag === 'textarea') {
      return true;
    }

    if (tag !== 'input') {
      return false;
    }

    const type = (element.getAttribute('type') || 'text').toLowerCase();
    return ['text', 'search', 'url', 'tel', 'password', 'email', 'number'].includes(type);
  }

  function isWindowTop(win) {
    try {
      return win.parent === win;
    } catch (_error) {
      return false;
    }
  }

  function safeDocumentHasFocus(doc) {
    try {
      return doc.hasFocus();
    } catch (_error) {
      return false;
    }
  }

  function safeCountSelector(doc, selector) {
    try {
      return doc.querySelectorAll(selector).length;
    } catch (_error) {
      return null;
    }
  }

  function sanitizeUrl(rawUrl) {
    if (!rawUrl) {
      return 'empty';
    }

    if (rawUrl === 'about:blank') {
      return 'about:blank';
    }

    if (rawUrl.startsWith('blob:')) {
      return 'blob:url';
    }

    if (rawUrl.startsWith('data:')) {
      return 'data:url';
    }

    try {
      const parsed = new URL(rawUrl, window.location.href);
      const pathDepth = parsed.pathname.split('/').filter(Boolean).length;

      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return `${parsed.protocol}//host(len:${parsed.hostname.length},parts:${parsed.hostname.split('.').length})/path(depth:${pathDepth})`;
      }

      return `${parsed.protocol}url/path(depth:${pathDepth})`;
    } catch (_error) {
      return `unparsed-url(len:${String(rawUrl).length})`;
    }
  }

  function formatFramePath(framePath) {
    if (!Array.isArray(framePath)) {
      return null;
    }

    if (!framePath.length) {
      return 'top';
    }

    return framePath.join('>');
  }

  function hashString(value) {
    const text = String(value);
    let hash = 0;

    for (let index = 0; index < text.length; index += 1) {
      hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
    }

    return `h${Math.abs(hash).toString(36)}`;
  }

  function roundNumber(value) {
    return Math.round(value * 10) / 10;
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

  function collectReachableWindows(rootWin, result = [], seen = []) {
    if (seen.indexOf(rootWin) !== -1) {
      return result;
    }

    seen.push(rootWin);
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

  function showDebug(message) {
    if (!isTopFrame()) {
      return;
    }

    const panel = document.getElementById(UI_ID);
    const debug = panel ? panel.querySelector('.debug') : null;

    if (!debug) {
      return;
    }

    debug.hidden = false;
    debug.textContent = message;
  }

  function clearDebug() {
    if (!isTopFrame()) {
      return;
    }

    const panel = document.getElementById(UI_ID);
    const debug = panel ? panel.querySelector('.debug') : null;

    if (!debug) {
      return;
    }

    debug.hidden = true;
    debug.textContent = '';
  }

  function createValueStore() {
    const values = [];

    return {
      has(value) {
        return values.indexOf(value) !== -1;
      },
      add(value) {
        if (values.indexOf(value) === -1) {
          values.push(value);
        }
      },
      delete(value) {
        const index = values.indexOf(value);

        if (index !== -1) {
          values.splice(index, 1);
        }
      },
    };
  }

  function createKeyValueStore() {
    const entries = [];

    return {
      has(key) {
        return findEntryIndex(entries, key) !== -1;
      },
      get(key) {
        const index = findEntryIndex(entries, key);
        return index === -1 ? undefined : entries[index].value;
      },
      set(key, value) {
        const index = findEntryIndex(entries, key);

        if (index === -1) {
          entries.push({ key, value });
          return;
        }

        entries[index].value = value;
      },
      delete(key) {
        const index = findEntryIndex(entries, key);

        if (index !== -1) {
          entries.splice(index, 1);
        }
      },
    };
  }

  function findEntryIndex(entries, key) {
    for (let index = 0; index < entries.length; index += 1) {
      if (entries[index].key === key) {
        return index;
      }
    }

    return -1;
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
