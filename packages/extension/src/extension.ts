import * as vscode from 'vscode';
import { StatusPanelProvider } from './panel/StatusPanelProvider';

let provider: StatusPanelProvider | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const channel = vscode.window.createOutputChannel('Claude Code Status');
  provider = new StatusPanelProvider(context.extensionUri, channel);

  context.subscriptions.push(
    channel,
    vscode.window.registerWebviewViewProvider(
      'ccstatusline.statusPanel',
      provider,
      { webviewOptions: { retainContextWhenHidden: true } }
    ),
    vscode.commands.registerCommand('ccstatusline.refresh', () => {
      provider?.refresh();
    }),
    vscode.commands.registerCommand('ccstatusline.showPanel', () => {
      vscode.commands.executeCommand('ccstatusline.statusPanel.focus');
    })
  );

  channel.appendLine('ccstatusline-vscode activated');
}

export function deactivate(): void {
  provider?.dispose();
}
