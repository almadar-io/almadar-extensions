import { describe, it, expect } from 'vitest';
import { jsonPathToPosition } from './server.js';
import { execFileSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const ROOT = path.resolve(__dirname, '../../../../');

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

describe('almadar validate CLI', () => {
    const almadarBin = path.join(ROOT, 'node_modules', '.bin', 'almadar');
    const schemasDir = path.join(ROOT, 'almadar', 'tests', 'schemas');

    it('should find the almadar CLI binary', () => {
        expect(fs.existsSync(almadarBin)).toBe(true);
    });

    it('should validate a valid schema with no errors', () => {
        const schemaPath = path.join(schemasDir, '02-state-machine.orb');
        const stdout = execFileSync(almadarBin, ['validate', '--json', schemaPath], {
            cwd: ROOT,
            encoding: 'utf-8',
        });
        const result = JSON.parse(stdout);
        expect(result.valid).toBe(true);
        expect(result.errors).toBeUndefined();
    });

    it('should produce warnings for guards schema', () => {
        const schemaPath = path.join(schemasDir, '03-guards.orb');
        const stdout = execFileSync(almadarBin, ['validate', '--json', schemaPath], {
            cwd: ROOT,
            encoding: 'utf-8',
        });
        const result = JSON.parse(stdout);
        expect(result.valid).toBe(true);
        expect(result.warnings).toBeDefined();
        expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should produce warnings with JSON paths for guards schema', () => {
        const schemaPath = path.join(schemasDir, '03-guards.orb');
        const stdout = execFileSync(almadarBin, ['validate', '--json', schemaPath], {
            cwd: ROOT,
            encoding: 'utf-8',
        });
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
            const stdout = execFileSync(almadarBin, ['validate', '--json', tmpFile], {
                cwd: ROOT,
                encoding: 'utf-8',
            });
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
        const stdout = execFileSync(almadarBin, ['validate', '--json', schemaPath], {
            cwd: ROOT,
            encoding: 'utf-8',
        });
        const result = JSON.parse(stdout);
        const firstWarning = result.warnings[0];
        const pos = jsonPathToPosition(content, firstWarning.path);

        // The position should be on a line that exists in the file
        const lines = content.split('\n');
        expect(pos.line).toBeLessThan(lines.length);
        expect(pos.line).toBeGreaterThan(0);
    });
});
