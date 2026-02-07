/**
 * Almadar OrbLSP Server
 *
 * A stdio-based LSP server that validates .orb files by shelling out
 * to `almadar validate --json` and mapping diagnostics back to the
 * original .orb file positions.
 *
 * Architecture:
 *   .orb file → temp file → `almadar validate --json` → parse JSON
 *   → map JSON paths to line positions → publish diagnostics
 */

import {
    createConnection,
    TextDocuments,
    ProposedFeatures,
    InitializeParams,
    TextDocumentSyncKind,
    Diagnostic,
    DiagnosticSeverity,
} from 'vscode-languageserver/node.js';

import { TextDocument } from 'vscode-languageserver-textdocument';
import { jsonPathToPosition } from './json-path.js';
import { execFile } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// ============================================================================
// Constants
// ============================================================================

const DEBOUNCE_MS = 500;

// ============================================================================
// LSP Server Setup
// ============================================================================

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

// Debounce timers per document URI
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Workspace root (resolved on initialization)
let workspaceRoot: string | null = null;

connection.onInitialize((params: InitializeParams) => {
    if (params.rootUri) {
        workspaceRoot = decodeURIComponent(params.rootUri.replace('file://', ''));
    } else if (params.rootPath) {
        workspaceRoot = params.rootPath;
    }
    connection.console.log(`OrbLSP initialized. Workspace root: ${workspaceRoot}`);

    return {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Full,
        },
    };
});

// ============================================================================
// JSON Path → Line Position Mapping
// ============================================================================

interface JsonPosition {
    line: number;      // 0-indexed
    character: number; // 0-indexed
}

/**
 * Given raw JSON text and a JSON path like "orbitals[0].traits[0].stateMachine",
 * find the line/character position of that path in the source.
 *
 * Strategy: walk the path segments and use regex to find each key/index
 * in the source text sequentially, advancing a cursor.
 */
export function jsonPathToPosition(jsonText: string, jsonPath: string): JsonPosition {
    if (!jsonPath) return { line: 0, character: 0 };

    // Parse path segments: "orbitals[0].traits[0].guard[1][2]"
    // → ["orbitals", "0", "traits", "0", "guard", "1", "2"]
    const segments = jsonPath
        .replace(/\[(\d+)\]/g, '.$1')
        .split('.')
        .filter(Boolean);

    let cursor = 0;

    for (const seg of segments) {
        const isIndex = /^\d+$/.test(seg);

        if (isIndex) {
            const idx = parseInt(seg, 10);
            // Find the n-th element in the current array context
            // Skip past the opening bracket
            const bracketPos = jsonText.indexOf('[', cursor);
            if (bracketPos === -1) break;
            cursor = bracketPos + 1;

            // Skip idx commas at the top level of this array
            let depth = 0;
            let count = 0;
            for (let i = cursor; i < jsonText.length; i++) {
                const ch = jsonText[i];
                if (ch === '{' || ch === '[') depth++;
                else if (ch === '}' || ch === ']') {
                    if (depth === 0) break; // end of array
                    depth--;
                }
                else if (ch === ',' && depth === 0) {
                    count++;
                    if (count === idx) {
                        cursor = i + 1;
                        // Skip whitespace after comma
                        while (cursor < jsonText.length && /\s/.test(jsonText[cursor])) cursor++;
                        break;
                    }
                }
            }
            if (count < idx && idx > 0) break; // couldn't find enough elements
            // If idx === 0, cursor is already at the first element
            if (idx === 0) {
                // Skip whitespace after bracket
                while (cursor < jsonText.length && /\s/.test(jsonText[cursor])) cursor++;
            }
        } else {
            // Find the key in the current object context
            // Look for "key": pattern
            const keyPattern = new RegExp(`"${escapeRegex(seg)}"\\s*:`);
            const match = keyPattern.exec(jsonText.slice(cursor));
            if (!match) break;
            cursor += match.index;
        }
    }

    // Convert cursor offset to line/character
    return offsetToPosition(jsonText, cursor);
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function offsetToPosition(text: string, offset: number): JsonPosition {
    let line = 0;
    let character = 0;
    for (let i = 0; i < offset && i < text.length; i++) {
        if (text[i] === '\n') {
            line++;
            character = 0;
        } else {
            character++;
        }
    }
    return { line, character };
}

// ============================================================================
// CLI Validation
// ============================================================================

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
 * Find the `almadar` CLI binary. Prefers a local npx resolution,
 * falls back to the global PATH.
 */
function findAlmadarBin(): string {
    // Try the workspace's node_modules/.bin first
    if (workspaceRoot) {
        const localBin = path.join(workspaceRoot, 'node_modules', '.bin', 'almadar');
        if (fs.existsSync(localBin)) return localBin;
    }
    // Fallback: assume it's on the PATH
    return 'almadar';
}

function runValidate(filePath: string): Promise<ValidateResult> {
    return new Promise((resolve) => {
        const bin = findAlmadarBin();
        execFile(bin, ['validate', '--json', filePath], {
            cwd: workspaceRoot ?? path.dirname(filePath),
            timeout: 30_000,
            maxBuffer: 1024 * 1024,
        }, (error, stdout, stderr) => {
            try {
                // The CLI returns JSON on stdout even on validation failures
                const result = JSON.parse(stdout) as ValidateResult;
                resolve(result);
            } catch {
                // If the CLI itself failed (not found, crash, etc.)
                connection.console.error(
                    `OrbLSP: almadar validate failed: ${error?.message ?? stderr}`
                );
                resolve({
                    success: false,
                    valid: false,
                    errors: [{
                        code: 'CLI_ERROR',
                        path: '',
                        message: `Validation CLI error: ${error?.message ?? 'unknown error'}`,
                    }],
                });
            }
        });
    });
}

// ============================================================================
// Document Validation
// ============================================================================

async function validateOrbDocument(document: TextDocument): Promise<void> {
    const orbContent = document.getText();
    if (!orbContent.trim()) {
        connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
        return;
    }

    // Write content to a temp file (the CLI requires a file path)
    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, `orb-lsp-${process.pid}-${Date.now()}.orb`);

    try {
        fs.writeFileSync(tmpFile, orbContent, 'utf-8');
        const result = await runValidate(tmpFile);

        const diagnostics: Diagnostic[] = [];

        // Map errors
        if (result.errors) {
            for (const err of result.errors) {
                diagnostics.push(makeDiagnostic(
                    orbContent, err, DiagnosticSeverity.Error
                ));
            }
        }

        // Map warnings
        if (result.warnings) {
            for (const warn of result.warnings) {
                diagnostics.push(makeDiagnostic(
                    orbContent, warn, DiagnosticSeverity.Warning
                ));
            }
        }

        connection.sendDiagnostics({ uri: document.uri, diagnostics });
    } finally {
        // Clean up temp file
        try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
}

function makeDiagnostic(
    orbContent: string,
    item: { code: string; path: string; message: string; suggestion?: string },
    severity: DiagnosticSeverity,
): Diagnostic {
    const pos = jsonPathToPosition(orbContent, item.path);

    // Find the end of the line for the range
    const lines = orbContent.split('\n');
    const lineText = lines[pos.line] ?? '';
    const endChar = lineText.length;

    let message = item.message;
    if (item.suggestion) {
        message += `\n💡 ${item.suggestion}`;
    }

    return {
        range: {
            start: { line: pos.line, character: pos.character },
            end: { line: pos.line, character: endChar },
        },
        message,
        severity,
        source: 'almadar',
        code: item.code,
    };
}

// ============================================================================
// Document Events
// ============================================================================

documents.onDidChangeContent((change) => {
    const uri = change.document.uri;

    // Debounce: wait for the user to stop typing
    const existing = debounceTimers.get(uri);
    if (existing) clearTimeout(existing);

    debounceTimers.set(uri, setTimeout(() => {
        debounceTimers.delete(uri);
        validateOrbDocument(change.document);
    }, DEBOUNCE_MS));
});

documents.onDidClose((event) => {
    const timer = debounceTimers.get(event.document.uri);
    if (timer) clearTimeout(timer);
    debounceTimers.delete(event.document.uri);
    connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

// ============================================================================
// Start
// ============================================================================

documents.listen(connection);
connection.listen();

connection.console.log('Almadar OrbLSP started (CLI mode)');
