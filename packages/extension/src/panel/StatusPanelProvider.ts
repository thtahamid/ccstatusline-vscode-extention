import * as vscode from 'vscode';
import { getPanelHtml } from './panelHtml';
import { runRenderPipeline } from '../render/PipelineRunner';

export class StatusPanelProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private terminalCols = 120;
  private disposables: vscode.Disposable[] = [];
  private rendering = false;

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
    const messageDisposable = webviewView.webview.onDidReceiveMessage((msg: { type: string; cols?: number }) => {
      switch (msg.type) {
        case 'ready':
          this.channel.appendLine('Panel webview ready');
          this.renderLive();
          break;
        case 'columns':
          if (msg.cols) {
            this.terminalCols = msg.cols;
          }
          break;
      }
    });

    this.disposables.push(messageDisposable);

    webviewView.onDidDispose(() => {
      this.view = undefined;
    });
  }

  private getWorkspaceFolders(): string[] {
    return (vscode.workspace.workspaceFolders || []).map(f => f.uri.fsPath);
  }

  /**
   * Run the ccstatusline render pipeline with real session data.
   */
  private async renderLive(): Promise<void> {
    if (!this.view || this.rendering) return;
    this.rendering = true;

    try {
      const output = await runRenderPipeline(this.terminalCols, this.getWorkspaceFolders());

      if (!this.view) return;

      if (output && output.lines.length > 0) {
        this.view.webview.postMessage({ type: 'render', lines: output.lines });
      } else {
        this.view.webview.postMessage({
          type: 'render',
          lines: ['\x1b[2m  No active Claude Code session\x1b[0m']
        });
      }
    } catch (err) {
      this.channel.appendLine(`Render error: ${err}`);
      if (this.view) {
        this.view.webview.postMessage({
          type: 'render',
          lines: ['\x1b[31m  Error rendering status\x1b[0m']
        });
      }
    } finally {
      this.rendering = false;
    }
  }

  refresh(): void {
    this.renderLive();
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}
