/**
 * Almadar Orbital Extension for VSCode
 *
 * Validates .orb files by running `almadar validate --json` and
 * mapping the structured output to VSCode diagnostics.
 */

import * as vscode from 'vscode';
import { exec } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

let diagnosticCollection: vscode.DiagnosticCollection;
let outputChannel: vscode.OutputChannel;

// Debounce timer
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
const DEBOUNCE_MS = 500;

export function activate(context: vscode.ExtensionContext) {
    diagnosticCollection = vscode.languages.createDiagnosticCollection('orb');
    outputChannel = vscode.window.createOutputChannel('Almadar Orb');
    context.subscriptions.push(diagnosticCollection, outputChannel);
    outputChannel.appendLine('Almadar Orb extension activated');

    const validate = (doc: vscode.TextDocument) => {
        if (doc.languageId !== 'orb') return;

        // Debounce: wait for the user to stop typing
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            validateOrbDocument(doc);
        }, DEBOUNCE_MS);
    };

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(validate),
        vscode.workspace.onDidChangeTextDocument((e) => validate(e.document)),
        vscode.workspace.onDidSaveTextDocument(validate),
        vscode.workspace.onDidCloseTextDocument((doc) => {
            diagnosticCollection.delete(doc.uri);
        }),
    );

    // Validate already-open documents
    if (vscode.window.activeTextEditor?.document.languageId === 'orb') {
        validateOrbDocument(vscode.window.activeTextEditor.document);
    }
}

interface ValidateResult {
    success: boolean;
    valid: boolean;
    errors?: Array<{
        code: string;
        path: string;
        message: string;
        suggestion?: string;
    }>;
    warnings?: Array<{
        code: string;
        path: string;
        message: string;
        suggestion?: string;
    }>;
}

/**
 * Run `almadar validate --json` on the document content and map
 * diagnostics back to the .orb positions.
 */
async function validateOrbDocument(document: vscode.TextDocument) {
    const orbContent = document.getText();
    if (!orbContent.trim()) {
        diagnosticCollection.set(document.uri, []);
        return;
    }

    // Write content to a temp file (the CLI requires a file path)
    const tmpFile = path.join(
        os.tmpdir(),
        `orb-vscode-${process.pid}-${Date.now()}.orb`
    );

    try {
        fs.writeFileSync(tmpFile, orbContent, 'utf-8');
        const result = await runValidate(tmpFile, document.uri);

        const diagnostics: vscode.Diagnostic[] = [];

        if (result.errors) {
            for (const err of result.errors) {
                diagnostics.push(makeDiagnostic(
                    orbContent, err, vscode.DiagnosticSeverity.Error
                ));
            }
        }

        if (result.warnings) {
            for (const warn of result.warnings) {
                diagnostics.push(makeDiagnostic(
                    orbContent, warn, vscode.DiagnosticSeverity.Warning
                ));
            }
        }

        diagnosticCollection.set(document.uri, diagnostics);
    } finally {
        try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
}

function runValidate(
    filePath: string,
    docUri: vscode.Uri,
): Promise<ValidateResult> {
    return new Promise((resolve) => {
        const cwd = vscode.workspace.getWorkspaceFolder(docUri)?.uri.fsPath
            ?? path.dirname(filePath);

        // Use shell exec so npx resolves correctly in VSCode's extension host
        const cmd = `npx -y @almadar/cli validate --json "${filePath}"`;
        outputChannel.appendLine(`Running: ${cmd} (cwd: ${cwd})`);

        exec(cmd, {
            cwd,
            timeout: 30_000,
            maxBuffer: 1024 * 1024,
        }, (error, stdout, stderr) => {
            if (error) {
                outputChannel.appendLine(`CLI error: ${error.message}`);
            }
            if (stderr) {
                // Filter out npm warn noise
                const realStderr = stderr.split('\n')
                    .filter(l => !l.startsWith('npm warn'))
                    .join('\n').trim();
                if (realStderr) outputChannel.appendLine(`stderr: ${realStderr}`);
            }
            try {
                const result = JSON.parse(stdout) as ValidateResult;
                outputChannel.appendLine(`Result: valid=${result.valid}, errors=${result.errors?.length ?? 0}, warnings=${result.warnings?.length ?? 0}`);
                resolve(result);
            } catch (parseError) {
                outputChannel.appendLine(`Failed to parse CLI output: ${stdout.slice(0, 200)}`);
                resolve({ success: false, valid: true });
            }
        });
    });
}

function makeDiagnostic(
    orbContent: string,
    item: { code: string; path: string; message: string; suggestion?: string },
    severity: vscode.DiagnosticSeverity,
): vscode.Diagnostic {
    const pos = jsonPathToPosition(orbContent, item.path);
    const lines = orbContent.split('\n');
    const lineText = lines[pos.line] ?? '';

    let message = item.message;
    if (item.suggestion) {
        message += `\n💡 ${item.suggestion}`;
    }

    return new vscode.Diagnostic(
        new vscode.Range(pos.line, pos.character, pos.line, lineText.length),
        message,
        severity,
    );
}

/**
 * Map a JSON path (e.g. "orbitals[0].traits[0].guard[1][2]") to a
 * line/character position in the raw JSON text.
 */
function jsonPathToPosition(
    jsonText: string,
    jsonPath: string,
): { line: number; character: number } {
    if (!jsonPath) return { line: 0, character: 0 };

    const segments = jsonPath
        .replace(/\[(\d+)\]/g, '.$1')
        .split('.')
        .filter(Boolean);

    let cursor = 0;

    for (const seg of segments) {
        const isIndex = /^\d+$/.test(seg);

        if (isIndex) {
            const idx = parseInt(seg, 10);
            const bracketPos = jsonText.indexOf('[', cursor);
            if (bracketPos === -1) break;
            cursor = bracketPos + 1;

            let depth = 0;
            let count = 0;
            for (let i = cursor; i < jsonText.length; i++) {
                const ch = jsonText[i];
                if (ch === '{' || ch === '[') depth++;
                else if (ch === '}' || ch === ']') {
                    if (depth === 0) break;
                    depth--;
                } else if (ch === ',' && depth === 0) {
                    count++;
                    if (count === idx) {
                        cursor = i + 1;
                        while (cursor < jsonText.length && /\s/.test(jsonText[cursor])) cursor++;
                        break;
                    }
                }
            }
            if (idx === 0) {
                while (cursor < jsonText.length && /\s/.test(jsonText[cursor])) cursor++;
            }
        } else {
            const keyPattern = new RegExp(
                `"${seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:`
            );
            const match = keyPattern.exec(jsonText.slice(cursor));
            if (!match) break;
            cursor += match.index;
        }
    }

    // Convert cursor offset to line/character
    let line = 0;
    let character = 0;
    for (let i = 0; i < cursor && i < jsonText.length; i++) {
        if (jsonText[i] === '\n') { line++; character = 0; }
        else character++;
    }

    return { line, character };
}

export function deactivate() { }
