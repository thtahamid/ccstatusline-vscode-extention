import * as vscode from 'vscode';

export function getPanelHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const mediaUri = vscode.Uri.joinPath(extensionUri, 'out', 'media');
  const xtermJsUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'xterm.js'));
  const xtermCssUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'xterm.css'));
  const fitJsUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'addon-fit.js'));
  const panelJsUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, 'panel.js'));

  const nonce = getNonce();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
  <link rel="stylesheet" href="${xtermCssUri}">
  <style>
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: transparent;
    }
    #terminal-container {
      width: 100%;
      height: 100%;
    }
    .xterm {
      padding: 4px;
    }
  </style>
</head>
<body>
  <div id="terminal-container"></div>
  <script nonce="${nonce}" src="${xtermJsUri}"></script>
  <script nonce="${nonce}" src="${fitJsUri}"></script>
  <script nonce="${nonce}" src="${panelJsUri}"></script>
</body>
</html>`;
}

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
