import * as vscode from 'vscode';
import { getPanelHtml } from './panelHtml';

export class StatusPanelProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private terminalCols = 120;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly channel: vscode.OutputChannel
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'out', 'media')
      ]
    };

    webviewView.webview.html = getPanelHtml(webviewView.webview, this.extensionUri);

    // Listen for messages from the webview
    const messageDisposable = webviewView.webview.onDidReceiveMessage(msg => {
      switch (msg.type) {
        case 'ready':
          this.channel.appendLine('Panel webview ready');
          this.renderDemo();
          break;
        case 'columns':
          this.terminalCols = msg.cols;
          this.channel.appendLine(`Panel columns: ${msg.cols}`);
          break;
      }
    });

    this.disposables.push(messageDisposable);

    webviewView.onDidDispose(() => {
      this.view = undefined;
    });
  }

  /**
   * Sends a rendered ANSI string to the webview for display.
   * Phase 1: hardcoded demo. Phase 2+: real pipeline output.
   */
  private renderDemo(): void {
    if (!this.view) return;

    // Demo powerline output with ANSI colors — proves the rendering path works
    const reset = '\x1b[0m';
    const bold = '\x1b[1m';
    const bgGreen = '\x1b[48;2;34;61;30m';
    const bgYellow = '\x1b[48;2;254;213;0m';
    const bgBlue = '\x1b[48;2;83;136;222m';
    const bgPurple = '\x1b[48;2;175;130;229m';
    const fgWhite = '\x1b[97m';
    const fgDark = '\x1b[38;2;40;42;54m';
    const powerline = '\uE0B0';

    const line1 = [
      `${reset}${bold}${fgWhite}${bgGreen} \uE0A0 main `,
      `\x1b[38;2;34;61;30m${bgYellow}${powerline}${fgDark} 03:24 `,
      `\x1b[38;2;254;213;0m${bgBlue}${powerline}${fgDark} Reset: 2h14m `,
      `\x1b[38;2;83;136;222m${bgPurple}${powerline}${fgDark} 5h: 19% `,
      `\x1b[38;2;175;130;229m${reset}${powerline}`
    ].join('');

    const bgLGreen = '\x1b[48;2;137;201;123m';
    const bgTeal = '\x1b[48;2;130;175;194m';
    const bgMPurple = '\x1b[48;2;153;132;173m';
    const bgRed = '\x1b[48;2;250;87;87m';
    const bgOrange = '\x1b[48;2;255;168;61m';

    const line2 = [
      `${reset}${bold}${fgDark}${bgLGreen} Ctx: 42% `,
      `\x1b[38;2;137;201;123m${bgTeal}${powerline}${fgDark} In: 12.4k `,
      `\x1b[38;2;130;175;194m${bgMPurple}${powerline}${fgDark} Out: 3.2k `,
      `\x1b[38;2;153;132;173m${bgRed}${powerline}${fgWhite} Tot: 15.6k `,
      `\x1b[38;2;250;87;87m${bgOrange}${powerline}${fgDark} [${'█'.repeat(8)}${'░'.repeat(12)}] `,
      `\x1b[38;2;255;168;61m${reset}${powerline}`
    ].join('');

    const line3 = `${reset}  Refactoring auth middleware`;

    this.view.webview.postMessage({ type: 'render', lines: [line1, line2, line3] });
  }

  refresh(): void {
    this.renderDemo();
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}
