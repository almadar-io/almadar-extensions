import { describe, it, expect } from 'vitest';
import { jsonPathToPosition } from './json-path.js';
import { execFileSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const ROOT = path.resolve(__dirname, '../../../../');
// lsp/'s own package dir — running npx with this as cwd lets it resolve
// @almadar/orb from lsp/node_modules directly instead of falling back to a
// slow registry/npx-cache lookup (ROOT has no local @almadar/orb install).
const LSP_ROOT = path.resolve(__dirname, '..');

// ============================================================================
// Unit tests for jsonPathToPosition
// ============================================================================

describe('jsonPathToPosition', () => {
    const simpleJson = `{
  "name": "test",
  "orbitals": [
    {
      "name": "First",
      "traits": [
        {
          "name": "TraitA"
        }
      ]
    }
  ]
}`;

    it('should return line 0 for empty path', () => {
        const pos = jsonPathToPosition(simpleJson, '');
        expect(pos.line).toBe(0);
        expect(pos.character).toBe(0);
    });

    it('should find top-level key "name"', () => {
        const pos = jsonPathToPosition(simpleJson, 'name');
        expect(pos.line).toBe(1);
    });

    it('should find "orbitals" key', () => {
        const pos = jsonPathToPosition(simpleJson, 'orbitals');
        expect(pos.line).toBe(2);
    });

    it('should find first orbital by index', () => {
        const pos = jsonPathToPosition(simpleJson, 'orbitals[0]');
        expect(pos.line).toBe(3);
    });

    it('should find nested key "orbitals[0].name"', () => {
        const pos = jsonPathToPosition(simpleJson, 'orbitals[0].name');
        expect(pos.line).toBe(4);
    });

    it('should find deeply nested "orbitals[0].traits[0].name"', () => {
        const pos = jsonPathToPosition(simpleJson, 'orbitals[0].traits[0].name');
        expect(pos.line).toBe(7);
    });
});

// ============================================================================
// CLI integration tests
// ============================================================================

describe('orb validate CLI', () => {
    const schemasDir = path.join(ROOT, 'almadar', 'tests', 'schemas');

    // Use npx to run @almadar/orb (the binary isn't in node_modules/.bin).
    // @almadar/cli (bin: "almadar") is a separate, stale, unmaintained
    // package predating .lolo support — @almadar/orb (bin: "orb") is the
    // actively-published CLI and the one resolveOrbBinary() targets.
    function runValidate(schemaPath: string): string {
        return execFileSync('npx', ['-y', '@almadar/orb', 'validate', '--json', schemaPath], {
            cwd: LSP_ROOT,
            encoding: 'utf-8',
            timeout: 30_000,
        });
    }

    it('should validate a valid schema with no errors', () => {
        const schemaPath = path.join(schemasDir, '02-state-machine.orb');
        const stdout = runValidate(schemaPath);
        const result = JSON.parse(stdout);
        expect(result.valid).toBe(true);
        expect(result.errors).toBeUndefined();
    });

    it('should produce warnings for guards schema', () => {
        const schemaPath = path.join(schemasDir, '03-guards.orb');
        const stdout = runValidate(schemaPath);
        const result = JSON.parse(stdout);
        expect(result.valid).toBe(true);
        expect(result.warnings).toBeDefined();
        expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should produce warnings with JSON paths for guards schema', () => {
        const schemaPath = path.join(schemasDir, '03-guards.orb');
        const stdout = runValidate(schemaPath);
        const result = JSON.parse(stdout);
        for (const w of result.warnings) {
            expect(w.code).toBeDefined();
            expect(w.path).toBeDefined();
            expect(w.message).toBeDefined();
        }
    });

    it('should produce errors for invalid JSON', () => {
        const tmpFile = path.join(ROOT, '__test_invalid.orb');
        try {
            fs.writeFileSync(tmpFile, '{ "name": "bad" }', 'utf-8');
            const stdout = runValidate(tmpFile);
            const result = JSON.parse(stdout);
            expect(result.valid).toBe(false);
            expect(result.errors).toBeDefined();
            expect(result.errors.length).toBeGreaterThan(0);
        } finally {
            try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
        }
    });

    it('should map warning paths to correct line positions', () => {
        const schemaPath = path.join(schemasDir, '03-guards.orb');
        const content = fs.readFileSync(schemaPath, 'utf-8');
        const stdout = runValidate(schemaPath);
        const result = JSON.parse(stdout);
        const firstWarning = result.warnings[0];
        const pos = jsonPathToPosition(content, firstWarning.path);

        // The position should be on a line that exists in the file
        const lines = content.split('\n');
        expect(pos.line).toBeLessThan(lines.length);
        expect(pos.line).toBeGreaterThan(0);
    });

    // A .lolo parse error carries a real "<input>:LINE:COL" source locator
    // (not a JSON-pointer path) — server.ts's LOLO_SOURCE_POS regex parses
    // this directly instead of routing it through jsonPathToPosition.
    it('should produce a LOLO_PARSE_ERROR with an <input>:LINE:COL path for invalid .lolo source', () => {
        const tmpFile = path.join(ROOT, '__test_invalid.lolo');
        try {
            fs.writeFileSync(tmpFile, 'app Test "desc"\n\norbital Foo\n  entity Foo\n    field id: string\n', 'utf-8');
            const stdout = runValidate(tmpFile);
            const result = JSON.parse(stdout);
            expect(result.valid).toBe(false);
            expect(result.errors).toBeDefined();
            const err = result.errors[0];
            expect(err.code).toBe('LOLO_PARSE_ERROR');
            expect(err.path).toMatch(/^<input>:\d+:\d+$/);
        } finally {
            try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
        }
    });
});
