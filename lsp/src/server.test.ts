import { describe, it, expect } from 'vitest';
import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';

// ============================================================================
// Replicate the core LSP validation logic (extracted from server.ts)
// ============================================================================

const TS_PREFIX =
    `import type { OrbitalSchema } from '@almadar/core';\n` +
    `const _orbital: OrbitalSchema = `;
const TS_SUFFIX = `;\n`;
const WRAPPER_LINE_OFFSET = 1;
const WRAPPER_COL_OFFSET = 32;

const ROOT = path.resolve(__dirname, '../../../../');

interface OrbDiagnostic {
    line: number;
    character: number;
    endLine: number;
    endCharacter: number;
    message: string;
    code: number;
    severity: 'error' | 'warning' | 'info';
}

function isDiagnosticInWrapper(diag: ts.Diagnostic): boolean {
    if (diag.start === undefined) return false;
    const msg = ts.flattenDiagnosticMessageText(diag.messageText, '\n');
    if (msg.includes("Cannot find module '@almadar/core'")) return true;
    if (diag.code === 2307) return true;
    return false;
}

/**
 * Validate .orb content against OrbitalSchema using the same approach
 * as the LSP server, returns mapped diagnostics.
 */
function validateOrbContent(orbContent: string): OrbDiagnostic[] {
    if (!orbContent.trim()) return [];

    const virtualPath = path.join(ROOT, '__orb_test_virtual.ts');
    const virtualContent = TS_PREFIX + orbContent + TS_SUFFIX;
    const virtualFiles = new Map<string, string>();
    virtualFiles.set(virtualPath, virtualContent);

    const compilerOptions: ts.CompilerOptions = {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        baseUrl: ROOT,
        rootDir: ROOT,
    };

    const host: ts.LanguageServiceHost = {
        getScriptFileNames: () => [...virtualFiles.keys()],
        getScriptVersion: () => '1',
        getScriptSnapshot: (fileName) => {
            const content = virtualFiles.get(fileName);
            if (content !== undefined) return ts.ScriptSnapshot.fromString(content);
            try {
                const text = ts.sys.readFile(fileName);
                if (text !== undefined) return ts.ScriptSnapshot.fromString(text);
            } catch { /* ignore */ }
            return undefined;
        },
        getCurrentDirectory: () => ROOT,
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

    const service = ts.createLanguageService(host, ts.createDocumentRegistry());
    const semanticDiags = service.getSemanticDiagnostics(virtualPath);
    const syntacticDiags = service.getSyntacticDiagnostics(virtualPath);
    const allDiags = [...syntacticDiags, ...semanticDiags];

    const diagnostics: OrbDiagnostic[] = [];

    for (const diag of allDiags) {
        if (diag.start === undefined || diag.length === undefined) continue;
        if (isDiagnosticInWrapper(diag)) continue;

        const sourceFile = service.getProgram()?.getSourceFile(virtualPath);
        if (!sourceFile) continue;

        const startPos = ts.getLineAndCharacterOfPosition(sourceFile, diag.start);
        const endPos = ts.getLineAndCharacterOfPosition(sourceFile, diag.start + diag.length);

        if (startPos.line < WRAPPER_LINE_OFFSET) continue;

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

        const message = ts.flattenDiagnosticMessageText(diag.messageText, '\n')
            .replace(/_orbital/g, '.orb file');

        diagnostics.push({
            line: Math.max(0, orbStartLine),
            character: Math.max(0, orbStartChar),
            endLine: Math.max(0, orbEndLine),
            endCharacter: Math.max(0, orbEndChar),
            message,
            code: diag.code,
            severity:
                diag.category === ts.DiagnosticCategory.Error ? 'error' :
                    diag.category === ts.DiagnosticCategory.Warning ? 'warning' : 'info',
        });
    }

    return diagnostics;
}

// ============================================================================
// Tests
// ============================================================================

describe('OrbLSP Validation', () => {
    it('should produce no errors for empty content', () => {
        const diags = validateOrbContent('');
        expect(diags).toHaveLength(0);
    });

    it('should produce no errors for whitespace-only content', () => {
        const diags = validateOrbContent('   \n  \n  ');
        expect(diags).toHaveLength(0);
    });

    it('should produce errors for invalid JSON', () => {
        const diags = validateOrbContent('{ invalid json }');
        expect(diags.length).toBeGreaterThan(0);
    });

    it('should produce errors for a minimal schema missing required fields', () => {
        const diags = validateOrbContent('{ "name": "test" }');
        expect(diags.length).toBeGreaterThan(0);
        // Should report missing 'orbitals' property
        const orbitalsMissing = diags.some(d =>
            d.message.includes('orbitals') ||
            d.message.includes('not assignable')
        );
        expect(orbitalsMissing).toBe(true);
    });

    it('should produce no errors for a valid minimal schema', () => {
        const validSchema = JSON.stringify({
            name: 'test-app',
            orbitals: [{
                name: 'TestOrbital',
                entity: {
                    name: 'TestEntity',
                    fields: [
                        { name: 'id', type: 'string', required: true }
                    ]
                },
                traits: [],
                pages: []
            }]
        }, null, 2);
        const diags = validateOrbContent(validSchema);
        expect(diags).toHaveLength(0);
    });

    describe('03-guards.orb schema', () => {
        const guardsPath = path.join(ROOT, 'almadar/tests/schemas/03-guards.orb');
        let guardsContent: string;

        try {
            guardsContent = fs.readFileSync(guardsPath, 'utf-8');
        } catch {
            guardsContent = '';
        }

        it('should find the guard test schema file', () => {
            expect(guardsContent.length).toBeGreaterThan(0);
        });

        it('should produce exactly 2 errors for the guards schema', () => {
            const diags = validateOrbContent(guardsContent);
            expect(diags).toHaveLength(2);
        });

        it('should report unknown "payload" property on Event (TS2353)', () => {
            const diags = validateOrbContent(guardsContent);
            const payloadError = diags.find(d => d.code === 2353);
            expect(payloadError).toBeDefined();
            expect(payloadError!.message).toContain('payload');
            expect(payloadError!.message).toContain('Event');
        });

        it('should report wrong render-ui effect tuple shape (TS2322)', () => {
            const diags = validateOrbContent(guardsContent);
            const renderUiError = diags.find(d => d.code === 2322);
            expect(renderUiError).toBeDefined();
            expect(renderUiError!.message).toContain('render-ui');
        });

        it('should map error positions back to .orb file lines', () => {
            const diags = validateOrbContent(guardsContent);
            // The payload error should be on a line containing "payload"
            const payloadError = diags.find(d => d.code === 2353);
            expect(payloadError).toBeDefined();
            // Line 29 in 0-indexed (line 30 in the .orb file, 1-indexed)
            const orbLines = guardsContent.split('\n');
            const payloadLineContent = orbLines[payloadError!.line];
            expect(payloadLineContent).toContain('payload');
        });

        it('should report all errors as severity "error"', () => {
            const diags = validateOrbContent(guardsContent);
            for (const d of diags) {
                expect(d.severity).toBe('error');
            }
        });
    });
});
