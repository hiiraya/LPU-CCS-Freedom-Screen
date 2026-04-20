index.html:
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <link rel="stylesheet" href="./Styles/index.css">
  <title>Freedom Screen — VS Code Style</title>
</head>
<body>

  <div class="title-bar">
    <div class="title">freedom_screen.py — Freedom Screen</div>
    <div class="window-controls">
      <span></span><span></span><span></span>
    </div>
  </div>

  <div class="main">
    <div class="activity-bar">
      <div class="activity-icon active"></div>
      <div class="activity-icon"></div>
    </div>

    <aside class="side-bar" aria-label="Explorer">
      <div class="side-header">EXPLORER</div>
      <div class="side-section">
        <div class="side-section-title">FREEDOM_SCREEN</div>
        <div class="tree">
          <div class="tree-item active">
            <span class="file-dot"></span>
            <span class="file-name">freedom_screen.py</span>
          </div>
          <div class="tree-item">
            <span class="file-dot muted"></span>
            <span class="file-name">screen.html</span>
          </div>
        </div>
      </div>
    </aside>

    <div class="editor-area">
      <div class="tabs">
        <div class="tab active">freedom_screen.py</div>
      </div>

      <div class="code-container">
        <div class="print-line" id="printLine">
          <span id="prefix" class="keyword">print</span><span class="string">(</span>
          <span id="quoteOpen" class="string">"</span>
          
          <div class="editor-wrapper">
            <textarea id="editor" spellcheck="false" autofocus placeholder="Type your freedom message..."></textarea>
          </div>

          <span id="quoteClose" class="string">"</span><span class="string">)</span>
        </div>

        <div class="toolbar">
          <button id="runBtn" class="run-btn">▶ Run</button>
        </div>

        <div class="code-line comment-line">
          <span class="comment"># Freedom is what you type ↑</span>
        </div>
      </div>
    </div>
  </div>

  <div class="status-bar">
    <div class="status-left">
      <span>Python 3.11</span>
      <span>UTF-8</span>
      <span>LF</span>
    </div>
    <div class="status-right">
      <span id="status">Ln 1, Col 1</span>
    </div>
  </div>

 <script src="./Scripts/index.js"></script>
</html>



screen.html:
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Freedom Wall — Terminal</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body {
      height: 100vh;
      background: #000;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      font-family: 'Consolas', 'Courier New', monospace;
    }
    .title-bar {
      height: 28px;
      background: #111;
      border-bottom: 1px solid #222;
      display: flex;
      align-items: center;
      padding: 0 12px;
      font-size: 13px;
      color: #555;
    }
    .title-bar .title {
      flex: 1;
      text-align: center;
      color: #aaa;
    }
    .terminal {
      flex: 1;
      position: relative;
      background: #000;
      overflow: hidden;
      clip-path: inset(0);
    }
    .terminal::before {
      content: "";
      position: absolute;
      inset: 0;
      pointer-events: none;
      background:
        radial-gradient(1200px 600px at 50% 20%, rgba(0, 255, 110, 0.06), transparent 55%),
        linear-gradient(to bottom, rgba(255,255,255,0.03), transparent 24%, rgba(255,255,255,0.02));
      opacity: 0.9;
      z-index: 0;
    }
    .terminal::after {
      content: "";
      position: absolute;
      inset: 0;
      pointer-events: none;
      background: repeating-linear-gradient(
        to bottom,
        rgba(255,255,255,0.02),
        rgba(255,255,255,0.02) 1px,
        transparent 1px,
        transparent 3px
      );
      opacity: 0.35;
      z-index: 0;
    }
    .note {
      position: absolute;
      min-width: 140px;
      width: fit-content;
      max-width: 70vw;
      padding: 10px 12px;
      background: rgba(10, 30, 10, 0.78);
      border: 1px solid rgba(80, 180, 80, 0.55);
      border-radius: 4px;
      box-shadow:
        0 0 0 1px rgba(0, 0, 0, 0.25) inset,
        0 0 10px rgba(0, 255, 80, 0.14);
      color: #aaffaa;
      font-size: 13px;
      line-height: 1.4;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: 'Consolas', monospace;
      text-align: left;
      height: auto;
      overflow: visible;
      z-index: 1;
    }
    .note:hover {
      border-color: rgba(120, 220, 120, 0.7);
      box-shadow:
        0 0 0 1px rgba(0, 0, 0, 0.25) inset,
        0 0 16px rgba(0, 255, 80, 0.2);
    }
    .note-content {
      white-space: pre-wrap;
      word-break: break-word;
    }
    .clear-btn {
      position: fixed;
      top: 40px;
      right: 20px;
      padding: 6px 12px;
      background: transparent;
      color: #888;
      border: 1px solid #444;
      border-radius: 3px;
      font-size: 12px;
      cursor: pointer;
      z-index: 10;
      backdrop-filter: blur(4px);
    }
    .clear-btn:hover {
      color: #fff;
      border-color: #777;
    }
    .no-messages {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #333;
      font-size: 18px;
    }

    .note {
  opacity: 0;
  transform-origin: center;
  transition: transform 0.35s ease, opacity 0.35s ease;
}

.note.show {
  opacity: 1;
}

@keyframes spawnGlow {
  0%   { box-shadow: 0 0 0 rgba(0,255,100,0); }
  50%  { box-shadow: 0 0 18px rgba(0,255,100,0.35); }
  100% { box-shadow: 0 0 8px rgba(0,255,100,0.15); }
}

  </style>
</head>
<body>

  <div class="title-bar">
    <div class="title">freedom_wall — Terminal</div>
  </div>

  <div class="terminal" id="terminal">
    <button class="clear-btn" onclick="clearWall()">Clear</button>
  </div>
<script>
  const terminal = document.getElementById('terminal');
  let lastTs = localStorage.getItem('freedomLastUpdate') || '0';
  let previousCount = 0;

  const PADDING = 20;
  const SAFE_TOP = 58;      // leave room for clear button
  const SAFE_RIGHT = 120;   // leave room for clear button
  const LAYOUT_KEY = 'freedomLayoutV1';

  function randomRotation() {
    return (Math.random() * 10 - 5).toFixed(1);
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderPrintCardHtml(text) {
    const raw = String(text ?? '');
    return `<div class="note-content">${escapeHtml(raw)}</div>`;
  }

  function getEntryId(entry, index) {
    if (entry && typeof entry === 'object' && entry.id) return String(entry.id);
    // Backward-compatible id for older saved entries (stable-ish across refresh)
    const text = entry && typeof entry === 'object' ? (entry.text ?? '') : (entry ?? '');
    return `legacy-${index}-${String(text).length}`;
  }

  function loadLayout() {
    try {
      return JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}') || {};
    } catch {
      return {};
    }
  }

  function saveLayout(layout) {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  }

  function drawAll() {
    Array.from(terminal.children).forEach(el => {
      if (!el.classList.contains('clear-btn')) el.remove();
    });

    const data = JSON.parse(localStorage.getItem('freedomPrints') || '[]');

    if (data.length === 0) {
      const msg = document.createElement('div');
      msg.className = 'no-messages';
      msg.textContent = 'empty';
      terminal.appendChild(msg);
      previousCount = 0;
      return;
    }

    const termRect = terminal.getBoundingClientRect();

    const columns = Math.ceil(Math.sqrt(data.length));
    const rows = Math.ceil(data.length / columns);

    const cellWidth = termRect.width / columns;
    const cellHeight = termRect.height / rows;

    const layout = loadLayout();
    let layoutDirty = false;

    data.forEach((entry, i) => {
      const div = document.createElement('div');
      div.className = 'note';

      const text = entry.text || entry;
      const entryId = getEntryId(entry, i);

      div.innerHTML = renderPrintCardHtml(text);

      terminal.appendChild(div);

      requestAnimationFrame(() => {
        const rect = div.getBoundingClientRect();

        const col = i % columns;
        const row = Math.floor(i / columns);

        let left = col * cellWidth + (cellWidth - rect.width) / 2;
        let top  = row * cellHeight + (cellHeight - rect.height) / 2;

        const saved = layout[entryId];
        if (!saved) {
          layout[entryId] = {
            jx: (Math.random() - 0.5) * 30,
            jy: (Math.random() - 0.5) * 30,
            rot: randomRotation(),
          };
          layoutDirty = true;
        }

        left += layout[entryId].jx;
        top  += layout[entryId].jy;

        left = Math.max(PADDING, Math.min(left, termRect.width - rect.width - PADDING - SAFE_RIGHT));
        top  = Math.max(PADDING + SAFE_TOP, Math.min(top, termRect.height - rect.height - PADDING));

        const rotation = layout[entryId].rot;

        div.style.left = `${left}px`;
        div.style.top = `${top}px`;

        // Animate only new cards
        if (i >= previousCount) {
          div.style.transform = `translateY(20px) scale(0.85) rotate(${rotation}deg)`;

          setTimeout(() => {
            div.classList.add('show');
            div.style.transform = `translateY(0px) scale(1) rotate(${rotation}deg)`;
            div.style.animation = "spawnGlow 0.8s ease";
          }, 30);
        } else {
          div.classList.add('show');
          div.style.transform = `rotate(${rotation}deg)`;
        }
      });
    });

    if (layoutDirty) saveLayout(layout);
    previousCount = data.length;
  }

  function hasChanged() {
    const nowTs = localStorage.getItem('freedomLastUpdate') || '0';
    if (nowTs !== lastTs) {
      lastTs = nowTs;
      drawAll();
    }
  }

  function clearWall() {
    if (confirm('Clear everything?')) {
      localStorage.removeItem('freedomPrints');
      localStorage.setItem('freedomLastUpdate', Date.now().toString());
      previousCount = 0;
      drawAll();
    }
  }

  window.addEventListener('storage', (e) => {
    if (e.key === 'freedomPrints' || e.key === 'freedomLastUpdate') {
      hasChanged();
    }
  });

  window.addEventListener('resize', drawAll);

  setInterval(hasChanged, 2000);

  drawAll();
</script>
</body>
</html>


index.js:
    const editor    = document.getElementById('editor');
    const prefix    = document.getElementById('prefix');
    const quoteOpen = document.getElementById('quoteOpen');
    const quoteClose = document.getElementById('quoteClose');
    const statusEl  = document.getElementById('status');
    const runBtn    = document.getElementById('runBtn');

    function updateSyntax() {
      const text = editor.value;
      const isMulti = text.includes('\n') || text.length > 85;
      prefix.textContent    = 'print';
      quoteOpen.textContent  = isMulti ? '"""' : '"';
      quoteClose.textContent = isMulti ? '"""' : '"';
    }

    function autoGrow() {
      const text = editor.value;
      const isMulti = text.includes('\n');
      if (!isMulti) {
        editor.style.height = '32px';
        editor.style.whiteSpace = 'nowrap';
        editor.style.overflowX = 'auto';
      } else {
        editor.style.height = 'auto';
        editor.style.height = editor.scrollHeight + 'px';
        editor.style.whiteSpace = 'pre-wrap';
        editor.style.overflowX = 'hidden';
      }
    }

    function updateStatus() {
      const lines = editor.value.split('\n').length;
      const col = (editor.selectionStart || 0) % 80 + 1;
      statusEl.textContent = `Ln ${lines}, Col ${col}`;
    }

    runBtn.addEventListener('click', () => {
      const text = editor.value.trim();
      if (!text) return;

      let prints = JSON.parse(localStorage.getItem('freedomPrints') || '[]');
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      prints.push({ id, text });
      localStorage.setItem('freedomPrints', JSON.stringify(prints));

      localStorage.setItem('freedomLastUpdate', Date.now().toString());

      editor.value = '';
      updateSyntax();
      autoGrow();
      updateStatus();
      editor.focus();

      runBtn.style.background = '#28c940';
      runBtn.textContent = '✅';
      setTimeout(() => {
        runBtn.style.background = '#007acc';
        runBtn.textContent = '▶ Run';
      }, 1400);
    });

    editor.addEventListener('input', () => {
      updateSyntax();
      autoGrow();
      updateStatus();
    });

    editor.addEventListener('keydown', () => {
      setTimeout(() => {
        updateSyntax();
        autoGrow();
        updateStatus();
      }, 0);
    });

    editor.focus();
    updateSyntax();
    autoGrow();
    updateStatus();


index.css:
    * { margin:0; padding:0; box-sizing:border-box; }

    body {
      height: 100vh;
      background: #1e1e1e;
      color: #d4d4d4;
      font-family: 'Consolas', 'Courier New', monospace;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .title-bar {
      height: 34px;
      background: #252526;
      border-bottom: 1px solid #2a2a2a;
      display: flex;
      align-items: center;
      padding: 0 12px;
      font-size: 13px;
      color: #cccccc;
    }

    .title-bar .title {
      flex: 1;
      text-align: center;
      color: #ffffff;
      font-weight: 500;
    }

    .window-controls {
      display: flex;
      gap: 10px;
    }

    .window-controls span {
      width: 12px;
      height: 12px;
      border-radius: 50%;
    }
    .window-controls span:nth-child(1) { background: #ff5f56; }
    .window-controls span:nth-child(2) { background: #ffbd2e; }
    .window-controls span:nth-child(3) { background: #28c940; }

    .main {
      flex: 1;
      display: flex;
      min-height: 0;
    }

    .activity-bar {
      width: 48px;
      background: #252526;
      border-right: 1px solid #2a2a2a;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding-top: 12px;
      gap: 28px;
    }

    .activity-icon {
      width: 26px;
      height: 26px;
      background: #c5c5c5;
      border-radius: 5px;
      opacity: 0.6;
    }

    .activity-icon.active {
      opacity: 1;
      background: #ffffff;
      box-shadow: 0 0 0 3px #007acc55;
    }

    .side-bar {
      width: 240px;
      background: #252526;
      border-right: 1px solid #2a2a2a;
      display: flex;
      flex-direction: column;
      min-width: 200px;
    }
    .side-header {
      height: 35px;
      display: flex;
      align-items: center;
      padding: 0 12px;
      font-size: 11px;
      letter-spacing: 0.6px;
      color: #bbbbbb;
      border-bottom: 1px solid #2a2a2a;
    }
    .side-section {
      padding: 10px 8px;
      overflow: auto;
    }
    .side-section-title {
      font-size: 11px;
      color: #9da0a6;
      padding: 6px 6px;
    }
    .tree {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .tree-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      border-radius: 4px;
      color: #cccccc;
      cursor: default;
      user-select: none;
    }
    .tree-item.active {
      background: #37373d;
      color: #ffffff;
    }
    .file-dot {
      width: 8px;
      height: 8px;
      border-radius: 2px;
      background: #007acc;
      opacity: 0.9;
      flex: 0 0 auto;
    }
    .file-dot.muted {
      background: #6a9955;
      opacity: 0.6;
    }
    .file-name {
      font-size: 12.5px;
    }

    .editor-area {
      flex: 1;
      display: flex;
      flex-direction: column;
    }

    .tabs {
      height: 35px;
      background: #1f1f1f;
      border-bottom: 1px solid #2a2a2a;
      display: flex;
      align-items: center;
      padding: 0 8px;
      gap: 4px;
      font-size: 13px;
    }

    .tab {
      padding: 0 16px;
      height: 100%;
      display: flex;
      align-items: center;
      background: #2d2d30;
      color: #aaaaaa;
      border-right: 1px solid #2a2a2a;
    }

    .tab.active {
      background: #1e1e1e;
      color: #d4d4d4;
      border-top: 2px solid #007acc;
    }

    .code-container {
      flex: 1;
      background: #1e1e1e;
      padding: 18px 22px;
      font-size: 15px;
      line-height: 1.6;
      overflow: auto;
    }

    .print-line {
      display: flex;
      align-items: center;
      flex-wrap: nowrap;
      white-space: nowrap;
    }

    .editor-wrapper {
      flex: 1;
      min-width: 120px;
      max-width: 100%;
      margin: 0 6px;
      background: #252526;
      border: 1px solid #2a2a2a;
      border-radius: 4px;
      overflow: hidden;
    }
    .editor-wrapper:focus-within {
      border-color: #007acc;
      box-shadow: 0 0 0 1px #007acc55 inset;
    }

    #editor {
      width: 100%;
      min-height: 32px;
      background: transparent;
      border: none;
      outline: none;
      color: #ce9178;
      font: inherit;
      line-height: 1.6;
      padding: 4px 8px;
      resize: none;
      caret-color: #d4d4d4;
    }

    .keyword { color: #c586c0; }
    .string   { color: #ce9178; }
    .comment  { color: #6a9955; }

    .toolbar {
      margin-top: 16px;
      display: flex;
      gap: 12px;
    }

    .run-btn {
      padding: 8px 20px;
      font-family: inherit;
      font-size: 14px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.2s;
      background: #007acc;
      color: white;
      font-weight: 600;
    }

    .run-btn:hover {
      background: #1e9cf0;
      transform: translateY(-1px);
    }

    .comment-line {
      margin-top: 12px;
    }

    .status-bar {
      height: 24px;
      background: #007acc;
      color: white;
      font-size: 12px;
      display: flex;
      align-items: center;
      padding: 0 12px;
      justify-content: space-between;
    }