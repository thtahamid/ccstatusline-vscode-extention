// @ts-nocheck
/* eslint-disable no-undef */
(function () {
  const vscode = acquireVsCodeApi();

  // Get VS Code theme colors from CSS variables
  const computedStyle = getComputedStyle(document.documentElement);
  const bg = computedStyle.getPropertyValue('--vscode-panel-background').trim()
    || computedStyle.getPropertyValue('--vscode-editor-background').trim()
    || '#1e1e1e';
  const fg = computedStyle.getPropertyValue('--vscode-terminal-foreground').trim()
    || computedStyle.getPropertyValue('--vscode-editor-foreground').trim()
    || '#cccccc';

  // Read font config from data attributes or use defaults
  const fontFamily = document.body.dataset.fontFamily
    || computedStyle.getPropertyValue('--vscode-terminal-font-family').trim()
    || 'Menlo, Monaco, Consolas, monospace';
  const fontSize = parseInt(document.body.dataset.fontSize || '13', 10);

  const term = new window.Terminal({
    disableStdin: true,
    cursorBlink: false,
    cursorStyle: 'bar',
    cursorInactiveStyle: 'none',
    fontFamily: fontFamily,
    fontSize: fontSize,
    lineHeight: 1.2,
    theme: {
      background: bg,
      foreground: fg
    },
    allowTransparency: true,
    scrollback: 0,
    convertEol: true
  });

  const fitAddon = new window.FitAddon.FitAddon();
  term.loadAddon(fitAddon);

  const container = document.getElementById('terminal-container');
  term.open(container);

  // Initial fit
  setTimeout(() => {
    fitAddon.fit();
    reportColumns();
    vscode.postMessage({ type: 'ready' });
  }, 50);

  // Refit on resize
  const resizeObserver = new ResizeObserver(() => {
    fitAddon.fit();
    reportColumns();
  });
  resizeObserver.observe(container);

  function reportColumns() {
    vscode.postMessage({ type: 'columns', cols: term.cols });
  }

  // Listen for render messages from the extension host
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'render' && msg.lines) {
      term.clear();
      term.reset();
      for (const line of msg.lines) {
        term.writeln(line);
      }
    } else if (msg.type === 'theme') {
      term.options.theme = msg.theme;
    } else if (msg.type === 'font') {
      if (msg.fontFamily) term.options.fontFamily = msg.fontFamily;
      if (msg.fontSize) term.options.fontSize = msg.fontSize;
      fitAddon.fit();
      reportColumns();
    }
  });
})();
