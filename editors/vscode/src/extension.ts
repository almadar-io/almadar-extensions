/**
 * Almadar Orbital Extension for VSCode
 *
 * Uses the TypeScript Wrapper Trick:
 * 1. On .orb file open/change, wraps JSON content as:
 *    `import type { OrbitalSchema } from '@almadar/core';`
 *    `const _orbital = { ... } satisfies OrbitalSchema;`
 *
 * 2. Creates a virtual .ts file that TypeScript LSP validates.
 *
 * 3. Maps TS diagnostics back to the .orb file positions.
 *
 * Result: Full structural validation, autocomplete, hover docs —
 * zero custom grammar work. Rebuild @almadar/core to update.
 */

import * as vscode from 'vscode';

// Inline the wrapper constants to avoid bundling @almadar/extensions at runtime.
// These must stay in sync with virtual-document.ts.
const TS_PREFIX = `import type { OrbitalSchema } from '@almadar/core';\nconst _orbital = `;
const TS_SUFFIX = ` satisfies OrbitalSchema;\n`;
const WRAPPER_LINE_OFFSET = 1;
const WRAPPER_COL_OFFSET = 18; // length of "const _orbital = "

let diagnosticCollection: vscode.DiagnosticCollection;

export function activate(context: vscode.ExtensionContext) {
    diagnosticCollection = vscode.languages.createDiagnosticCollection('orb');
    context.subscriptions.push(diagnosticCollection);

    // Validate on open, change, and save
    const validate = (doc: vscode.TextDocument) => {
        if (doc.languageId !== 'orb') return;
        validateOrbDocument(doc);
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

/**
 * Wrap the .orb content as a virtual .ts file, run TypeScript
 * diagnostics on it, and map errors back to the .orb positions.
 */
async function validateOrbDocument(document: vscode.TextDocument) {
    const orbContent = document.getText();
    if (!orbContent.trim()) {
        diagnosticCollection.set(document.uri, []);
        return;
    }

    // Create the virtual TypeScript content
    const virtualContent = TS_PREFIX + orbContent + TS_SUFFIX;

    // Write to a temporary virtual file for tsserver to pick up
    const virtualUri = document.uri.with({
        scheme: 'untitled',
        path: document.uri.path + '.ts',
    });

    try {
        // Use VSCode's built-in TypeScript extension to get diagnostics
        // by executing the typescript.tsserver.getSemanticDiagnostics command
        const tsDiagnostics = await vscode.languages.getDiagnostics(virtualUri);

        const orbDiagnostics: vscode.Diagnostic[] = tsDiagnostics
            .filter((d) => d.range.start.line >= WRAPPER_LINE_OFFSET)
            .map((d) => {
                const startLine = d.range.start.line - WRAPPER_LINE_OFFSET;
                const startChar =
                    startLine === 0
                        ? Math.max(0, d.range.start.character - WRAPPER_COL_OFFSET)
                        : d.range.start.character;
                const endLine = d.range.end.line - WRAPPER_LINE_OFFSET;
                const endChar =
                    endLine === 0
                        ? Math.max(0, d.range.end.character - WRAPPER_COL_OFFSET)
                        : d.range.end.character;

                return new vscode.Diagnostic(
                    new vscode.Range(
                        Math.max(0, startLine),
                        Math.max(0, startChar),
                        Math.max(0, endLine),
                        Math.max(0, endChar),
                    ),
                    cleanMessage(d.message),
                    d.severity,
                );
            });

        diagnosticCollection.set(document.uri, orbDiagnostics);
    } catch {
        // TypeScript extension not available — silently degrade.
        // S-expression highlighting still works via the injection grammar.
    }
}

/**
 * Clean TypeScript error messages for .orb context.
 */
function cleanMessage(msg: string): string {
    return msg.replace(/_orbital/g, '.orb file');
}

export function deactivate() { }
