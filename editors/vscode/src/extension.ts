/**
 * Almadar Orbital Extension for VSCode
 *
 * Launches the orb-lsp server (same one Zed uses) and connects
 * via vscode-languageclient for validation diagnostics.
 * Syntax highlighting is provided by the TextMate grammars.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind,
} from 'vscode-languageclient/node';

let client: LanguageClient;

export function activate(context: vscode.ExtensionContext) {
    const outputChannel = vscode.window.createOutputChannel('Almadar Orb');
    outputChannel.appendLine('Almadar Orb extension activating...');

    // The LSP server lives relative to the workspace root
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        outputChannel.appendLine('No workspace folder found, skipping LSP.');
        return;
    }

    const serverModule = path.join(
        workspaceRoot,
        'packages', 'almadar-extensions', 'lsp', 'dist', 'server.js'
    );

    outputChannel.appendLine(`LSP server path: ${serverModule}`);

    const serverOptions: ServerOptions = {
        run: {
            module: serverModule,
            transport: TransportKind.stdio,
            options: { execArgv: ['--experimental-vm-modules'] },
        },
        debug: {
            module: serverModule,
            transport: TransportKind.stdio,
            options: { execArgv: ['--experimental-vm-modules'] },
        },
    };

    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: 'file', language: 'orb' }],
        outputChannel,
    };

    client = new LanguageClient(
        'almadar-orb-lsp',
        'Almadar Orb LSP',
        serverOptions,
        clientOptions
    );

    client.start().then(() => {
        outputChannel.appendLine('Almadar Orb LSP started successfully');
    }).catch((err) => {
        outputChannel.appendLine(`Failed to start LSP: ${err.message}`);
    });

    context.subscriptions.push(client);
}

export function deactivate(): Thenable<void> | undefined {
    if (!client) return undefined;
    return client.stop();
}
