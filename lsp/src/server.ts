/**
 * Almadar OrbLSP Server
 *
 * A stdio-based LSP server that validates .orb files by wrapping
 * their JSON content as TypeScript and delegating to TypeScript's
 * LanguageService for diagnostics.
 *
 * Architecture:
 *   .orb file → wrap as `satisfies OrbitalSchema` → TS LanguageService
 *   → diagnostics → map positions back to .orb → publish to client
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
import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';

// ============================================================================
// Constants (kept in sync with @almadar/extensions virtual-document.ts)
// ============================================================================

const TS_PREFIX =
    `import type { OrbitalSchema } from '@almadar/core';\n` +
    `const _orbital: OrbitalSchema = `;
const TS_SUFFIX = `;\n`;
const WRAPPER_LINE_OFFSET = 1;
const WRAPPER_COL_OFFSET = 32;

// ============================================================================
// LSP Server Setup
// ============================================================================

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

// Track virtual file contents for each .orb document
const virtualFiles = new Map<string, string>();

// Workspace root (resolved on first document)
let workspaceRoot: string | null = null;

connection.onInitialize((params: InitializeParams) => {
    // Use the workspace root from the LSP initialization
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
// Workspace Root Discovery
// ============================================================================

/**
 * Walk up from a file path to find the nearest directory containing
 * node_modules/@almadar/core (the monorepo root).
 */
function findMonorepoRoot(startPath: string): string {
    // If we have a workspace root from LSP init, prefer it
    if (workspaceRoot) {
        const coreAtRoot = path.join(workspaceRoot, 'node_modules', '@almadar', 'core');
        if (fs.existsSync(coreAtRoot)) {
            return workspaceRoot;
        }
    }

    // Walk up directories
    let dir = path.dirname(startPath);
    for (let i = 0; i < 20; i++) {
        const corePath = path.join(dir, 'node_modules', '@almadar', 'core');
        if (fs.existsSync(corePath)) {
            return dir;
        }
        const parent = path.dirname(dir);
        if (parent === dir) break; // reached filesystem root
        dir = parent;
    }

    // Fallback: use workspace root or file directory
    return workspaceRoot ?? path.dirname(startPath);
}

// ============================================================================
// TypeScript LanguageService
// ============================================================================

function createLanguageService(rootDir: string): ts.LanguageService {
    const compilerOptions: ts.CompilerOptions = {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        baseUrl: rootDir,
        rootDir,
    };

    const host: ts.LanguageServiceHost = {
        getScriptFileNames: () => [...virtualFiles.keys()],
        getScriptVersion: () => '1',
        getScriptSnapshot: (fileName) => {
            const content = virtualFiles.get(fileName);
            if (content !== undefined) {
                return ts.ScriptSnapshot.fromString(content);
            }
            // Try reading from disk (for node_modules types)
            try {
                const text = ts.sys.readFile(fileName);
                if (text !== undefined) {
                    return ts.ScriptSnapshot.fromString(text);
                }
            } catch {
                // Ignore
            }
            return undefined;
        },
        getCurrentDirectory: () => rootDir,
        getCompilationSettings: () => compilerOptions,
        getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
        fileExists: (fileName) => {
            if (virtualFiles.has(fileName)) return true;
            return ts.sys.fileExists(fileName);
        },
        readFile: (fileName) => {
            const content = virtualFiles.get(fileName);
            if (content !== undefined) return content;
            return ts.sys.readFile(fileName);
        },
        readDirectory: ts.sys.readDirectory,
        directoryExists: ts.sys.directoryExists,
        getDirectories: ts.sys.getDirectories,
    };

    return ts.createLanguageService(host, ts.createDocumentRegistry());
}

let languageService: ts.LanguageService | null = null;
let resolvedRoot: string | null = null;

function getLanguageService(orbFilePath: string): ts.LanguageService {
    const root = findMonorepoRoot(orbFilePath);

    // Re-create service if root changed
    if (!languageService || resolvedRoot !== root) {
        resolvedRoot = root;
        languageService = createLanguageService(root);
        connection.console.log(`OrbLSP: TS LanguageService rooted at ${root}`);
    }
    return languageService;
}

// ============================================================================
// Document Validation
// ============================================================================

function getVirtualPath(orbUri: string): string {
    // Convert URI to a .ts path for the virtual file
    const filePath = orbUri.startsWith('file://')
        ? decodeURIComponent(orbUri.slice(7))
        : orbUri;
    return filePath + '.ts';
}

/** Filter out diagnostics that originate from the wrapper, not the .orb content */
function isDiagnosticInWrapper(diag: ts.Diagnostic): boolean {
    if (diag.start === undefined) return false;
    const msg = ts.flattenDiagnosticMessageText(diag.messageText, '\n');
    // Filter module resolution errors (when @almadar/core can't be found)
    if (msg.includes("Cannot find module '@almadar/core'")) return true;
    if (diag.code === 2307) return true; // Cannot find module
    return false;
}

function validateOrbDocument(document: TextDocument): void {
    const orbContent = document.getText();
    if (!orbContent.trim()) {
        connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
        return;
    }

    const virtualPath = getVirtualPath(document.uri);
    const virtualContent = TS_PREFIX + orbContent + TS_SUFFIX;

    // Update the virtual file
    virtualFiles.set(virtualPath, virtualContent);

    const service = getLanguageService(virtualPath);

    // Get semantic diagnostics from TypeScript
    const semanticDiags = service.getSemanticDiagnostics(virtualPath);
    const syntacticDiags = service.getSyntacticDiagnostics(virtualPath);
    const allDiags = [...syntacticDiags, ...semanticDiags];

    const diagnostics: Diagnostic[] = [];

    for (const diag of allDiags) {
        if (diag.start === undefined || diag.length === undefined) continue;

        // Skip wrapper-related and module resolution errors
        if (isDiagnosticInWrapper(diag)) continue;

        // Get the position in the virtual file
        const sourceFile = service.getProgram()?.getSourceFile(virtualPath);
        if (!sourceFile) continue;

        const startPos = ts.getLineAndCharacterOfPosition(sourceFile, diag.start);
        const endPos = ts.getLineAndCharacterOfPosition(
            sourceFile,
            diag.start + diag.length,
        );

        // Skip diagnostics in the wrapper prefix (line 0 = import statement)
        if (startPos.line < WRAPPER_LINE_OFFSET) continue;

        // Map back to .orb positions
        const orbStartLine = startPos.line - WRAPPER_LINE_OFFSET;
        const orbStartChar =
            orbStartLine === 0
                ? Math.max(0, startPos.character - WRAPPER_COL_OFFSET)
                : startPos.character;
        const orbEndLine = endPos.line - WRAPPER_LINE_OFFSET;
        const orbEndChar =
            orbEndLine === 0
                ? Math.max(0, endPos.character - WRAPPER_COL_OFFSET)
                : endPos.character;

        const message = ts.flattenDiagnosticMessageText(
            diag.messageText,
            '\n',
        ).replace(/_orbital/g, '.orb file');

        const severity =
            diag.category === ts.DiagnosticCategory.Error
                ? DiagnosticSeverity.Error
                : diag.category === ts.DiagnosticCategory.Warning
                    ? DiagnosticSeverity.Warning
                    : DiagnosticSeverity.Information;

        diagnostics.push({
            range: {
                start: { line: Math.max(0, orbStartLine), character: Math.max(0, orbStartChar) },
                end: { line: Math.max(0, orbEndLine), character: Math.max(0, orbEndChar) },
            },
            message,
            severity,
            source: 'almadar-orb',
            code: diag.code,
        });
    }

    connection.sendDiagnostics({ uri: document.uri, diagnostics });
}

// ============================================================================
// Document Events
// ============================================================================

documents.onDidChangeContent((change) => {
    validateOrbDocument(change.document);
});

documents.onDidClose((event) => {
    const virtualPath = getVirtualPath(event.document.uri);
    virtualFiles.delete(virtualPath);
    connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

// ============================================================================
// Start
// ============================================================================

documents.listen(connection);
connection.listen();

connection.console.log('Almadar OrbLSP started');
