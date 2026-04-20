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