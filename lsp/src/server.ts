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
import { execFile, execFileSync } from 'child_process';
import { createRequire } from 'module';
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

// ============================================================================
// Binary Resolution
// ============================================================================

const BINARY_NAME = process.platform === 'win32' ? 'almadar.exe' : 'almadar';
const PLATFORM_PACKAGE: Record<string, string> = {
    'darwin-x64': '@almadar/cli-darwin-x64',
    'darwin-arm64': '@almadar/cli-darwin-arm64',
    'linux-x64': '@almadar/cli-linux-x64',
    'linux-arm64': '@almadar/cli-linux-arm64',
    'win32-x64': '@almadar/cli-windows-x64',
};

let _cachedBinaryPath: string | null | undefined;

function resolveAlmadarBinary(): string | null {
    if (_cachedBinaryPath !== undefined) return _cachedBinaryPath;

    const packageName = PLATFORM_PACKAGE[`${process.platform}-${process.arch}`];
    if (!packageName) {
        _cachedBinaryPath = null;
        return null;
    }

    // Strategy 1: require.resolve to find the platform package
    try {
        const require = createRequire(import.meta.url);
        const pkgJson = require.resolve(`${packageName}/package.json`);
        const binaryPath = path.join(path.dirname(pkgJson), BINARY_NAME);
        if (fs.existsSync(binaryPath)) {
            _cachedBinaryPath = binaryPath;
            return binaryPath;
        }
    } catch { /* not found via require */ }

    // Strategy 2: Walk up node_modules from workspace root
    const searchRoots = [workspaceRoot, process.cwd(), path.dirname(import.meta.url.replace('file://', ''))].filter(Boolean) as string[];
    for (const root of searchRoots) {
        let dir = root;
        for (let i = 0; i < 6; i++) {
            const candidate = path.join(dir, 'node_modules', packageName, BINARY_NAME);
            if (fs.existsSync(candidate)) {
                _cachedBinaryPath = candidate;
                return candidate;
            }
            const parent = path.dirname(dir);
            if (parent === dir) break;
            dir = parent;
        }
    }

    // Strategy 3: Check if 'almadar' is on PATH
    try {
        execFileSync('almadar', ['--version'], { timeout: 5000, stdio: 'ignore' });
        _cachedBinaryPath = 'almadar';
        return 'almadar';
    } catch { /* not on PATH */ }

    _cachedBinaryPath = null;
    return null;
}

function runValidate(filePath: string): Promise<ValidateResult> {
    return new Promise((resolve) => {
        const binaryPath = resolveAlmadarBinary();

        if (!binaryPath) {
            resolve({
                success: false,
                valid: false,
                errors: [{
                    code: 'CLI_NOT_FOUND',
                    path: '',
                    message: 'Almadar CLI binary not found. Install with: npm install -g @almadar/cli',
                }],
            });
            return;
        }

        execFile(binaryPath, ['validate', '--json', filePath], {
            cwd: workspaceRoot ?? path.dirname(filePath),
            timeout: 30_000,
            maxBuffer: 1024 * 1024,
        }, (error, stdout, stderr) => {
            try {
                const result = JSON.parse(stdout) as ValidateResult;
                resolve(result);
            } catch {
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
