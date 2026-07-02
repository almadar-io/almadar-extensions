/**
 * Almadar OrbLSP Server
 *
 * A stdio-based LSP server that validates .orb and .lolo files by shelling
 * out to `orb validate --json` (the @almadar/orb CLI) and mapping
 * diagnostics back to the original file positions.
 *
 * Architecture:
 *   .orb/.lolo file → temp file → `orb validate --json` → parse JSON
 *   → map JSON paths (or lolo <input>:L:C locators) to line positions
 *   → publish diagnostics
 */

import {
    createConnection,
    TextDocuments,
    ProposedFeatures,
    InitializeParams,
    TextDocumentSyncKind,
    Diagnostic,
    DiagnosticSeverity,
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';
import { jsonPathToPosition } from './json-path.js';
import { PreviewServer } from './preview/preview-server.js';
import { execFile, execFileSync } from 'child_process';
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

// RTL preview server (HTTP + WebSocket)
const previewServer = new PreviewServer((msg) => connection.console.log(msg));

/** File extensions that support live preview */
const PREVIEWABLE_EXTENSIONS = ['.orb', '.md'];

function isPreviewable(uri: string): boolean {
    const lower = uri.toLowerCase();
    return PREVIEWABLE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

connection.onInitialize((params: InitializeParams) => {
    if (params.rootUri) {
        workspaceRoot = decodeURIComponent(params.rootUri.replace('file://', ''));
    } else if (params.rootPath) {
        workspaceRoot = params.rootPath;
    }
    connection.console.log(`OrbLSP initialized. Workspace root: ${workspaceRoot}`);

    // Start the preview server (non-blocking)
    previewServer.start().then((port) => {
        connection.console.log(`RTL Preview: http://localhost:${port}/preview`);
        // Push all already-open documents to the preview server
        for (const doc of documents.all()) {
            if (isPreviewable(doc.uri)) {
                previewServer.notifyDocumentChanged(doc.uri, doc.getText());
            }
        }
    }).catch((err) => {
        connection.console.error(`PreviewServer failed to start: ${err}`);
    });

    return {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Full,
        },
    };
});

// Custom request: get preview URL for a document (pinned) or follow mode
connection.onRequest('almadar/previewUrl', (params: { uri?: string }): { url: string | null } => {
    const port = previewServer.getPort();
    if (!port) return { url: null };
    // With uri: pinned to that document. Without: follow mode (auto-follows active file)
    const docParam = params.uri ? `?doc=${encodeURIComponent(params.uri)}` : '';
    return {
        url: `http://localhost:${port}/preview${docParam}`,
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

// The published, actively-maintained CLI is @almadar/orb (bin: "orb") — NOT
// @almadar/cli (bin: "almadar"), which is a stale, unmaintained package that
// predates .lolo support. Confirmed live: @almadar/orb correctly returns
// LOLO_PARSE_ERROR with a real <input>:LINE:COL locator; @almadar/cli just
// tries JSON.parse on .lolo source and reports a generic JSON_PARSE_ERROR.
const BINARY_NAME = process.platform === 'win32' ? 'orb.exe' : 'orb';
const PLATFORM_PACKAGE: Record<string, string> = {
    'darwin-x64': '@almadar/orb-darwin-x64',
    'darwin-arm64': '@almadar/orb-darwin-arm64',
    'linux-x64': '@almadar/orb-linux-x64',
    'linux-arm64': '@almadar/orb-linux-arm64',
    'win32-x64': '@almadar/orb-windows-x64',
};

let _cachedBinaryPath: string | null | undefined;

function resolveOrbBinary(): string | null {
    if (_cachedBinaryPath !== undefined) return _cachedBinaryPath;

    const packageName = PLATFORM_PACKAGE[`${process.platform}-${process.arch}`];
    if (!packageName) {
        _cachedBinaryPath = null;
        return null;
    }

    // Strategy 1: require.resolve to find the platform package
    // Note: `require` is provided by tsup banner via createRequire(import.meta.url)
    try {
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

    // Strategy 3: Check if 'orb' is on PATH
    try {
        execFileSync('orb', ['--version'], { timeout: 5000, stdio: 'ignore' });
        _cachedBinaryPath = 'orb';
        return 'orb';
    } catch { /* not on PATH */ }

    _cachedBinaryPath = null;
    return null;
}

function runValidate(filePath: string): Promise<ValidateResult> {
    return new Promise((resolve) => {
        const binaryPath = resolveOrbBinary();

        if (!binaryPath) {
            resolve({
                success: false,
                valid: false,
                errors: [{
                    code: 'CLI_NOT_FOUND',
                    path: '',
                    message: 'Orb CLI binary not found. Install with: npm install -g @almadar/orb',
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
                    `OrbLSP: orb validate failed: ${error?.message ?? stderr}`
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

/** '.orb' or '.lolo' — determines the temp file extension so the CLI parses
 *  the content with the right grammar (it auto-detects lolo vs orb by suffix). */
function sourceExtension(uri: string): '.orb' | '.lolo' {
    return uri.toLowerCase().endsWith('.lolo') ? '.lolo' : '.orb';
}

async function validateDocument(document: TextDocument): Promise<void> {
    const sourceContent = document.getText();
    if (!sourceContent.trim()) {
        connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
        return;
    }

    // Write content to a temp file (the CLI requires a file path)
    const tmpDir = os.tmpdir();
    const ext = sourceExtension(document.uri);
    const tmpFile = path.join(tmpDir, `orb-lsp-${process.pid}-${Date.now()}${ext}`);

    try {
        fs.writeFileSync(tmpFile, sourceContent, 'utf-8');
        const result = await runValidate(tmpFile);

        const diagnostics: Diagnostic[] = [];

        // Map errors
        if (result.errors) {
            for (const err of result.errors) {
                diagnostics.push(makeDiagnostic(
                    sourceContent, err, DiagnosticSeverity.Error
                ));
            }
        }

        // Map warnings
        if (result.warnings) {
            for (const warn of result.warnings) {
                diagnostics.push(makeDiagnostic(
                    sourceContent, warn, DiagnosticSeverity.Warning
                ));
            }
        }

        connection.sendDiagnostics({ uri: document.uri, diagnostics });
    } finally {
        // Clean up temp file
        try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    }
}

/** Matches a lolo-level parse error's `path` — a literal `<input>:LINE:COL`
 *  locator into the original .lolo source, not a JSON-pointer path. */
const LOLO_SOURCE_POS = /^<input>:(\d+):(\d+)$/;

function makeDiagnostic(
    sourceContent: string,
    item: { code: string; path: string; message: string; suggestion?: string },
    severity: DiagnosticSeverity,
): Diagnostic {
    const loloMatch = LOLO_SOURCE_POS.exec(item.path);
    // Lolo parse errors carry a real line:col into the source; everything
    // else (post-lowering semantic errors) is a JSON-pointer path with no
    // direct .lolo-source position — jsonPathToPosition's whole-document
    // fallback is the best available for those until a lolo->orb source map exists.
    const pos = loloMatch
        ? { line: Number(loloMatch[1]) - 1, character: Number(loloMatch[2]) - 1 }
        : jsonPathToPosition(sourceContent, item.path);

    // Find the end of the line for the range
    const lines = sourceContent.split('\n');
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
        source: 'orb',
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
        // Validate .orb and .lolo files
        const lower = uri.toLowerCase();
        if (lower.endsWith('.orb') || lower.endsWith('.lolo')) {
            validateDocument(change.document);
        }
        // Push preview update for all previewable files
        if (isPreviewable(uri)) {
            previewServer.notifyDocumentChanged(uri, change.document.getText());
        }
    }, DEBOUNCE_MS));
});

documents.onDidClose((event) => {
    const uri = event.document.uri;
    const timer = debounceTimers.get(uri);
    if (timer) clearTimeout(timer);
    debounceTimers.delete(uri);
    connection.sendDiagnostics({ uri, diagnostics: [] });
    // Notify preview server that the document was closed
    if (isPreviewable(uri)) {
        previewServer.notifyDocumentClosed(uri);
    }
});

// ============================================================================
// Start
// ============================================================================

documents.listen(connection);
connection.listen();

connection.console.log('Almadar OrbLSP started (CLI mode)');
