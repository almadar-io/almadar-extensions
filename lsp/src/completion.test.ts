import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CompletionItemKind } from 'vscode-languageserver/node';
import { byteOffsetOf, parseCompleteOutput, toCompletionItems, completeArgs } from './completion.js';

describe('byteOffsetOf', () => {
    it('counts UTF-8 bytes up to a UTF-16 offset', () => {
        expect(byteOffsetOf('abc', 2)).toBe(2);
        expect(byteOffsetOf('«» us', 5)).toBe(7);
    });
    it('edge: a surrogate pair is 2 UTF-16 units and 4 bytes; past the end clamps', () => {
        expect(byteOffsetOf('😀x', 2)).toBe(4);
        expect(byteOffsetOf('ab', 9)).toBe(2);
    });
});

describe('parseCompleteOutput', () => {
    it('reads orb complete JSON', () => {
        const out = parseCompleteOutput('{"context":"top-level","prefix":"us","candidates":[{"label":"uses","kind":"keyword"},{"label":"std/behaviors/std-list","kind":"import-path","detail":"List"}]}');
        expect(out.prefix).toBe('us');
        expect(out.candidates).toEqual([
            { label: 'uses', kind: 'keyword' },
            { label: 'std/behaviors/std-list', kind: 'import-path', detail: 'List' },
        ]);
    });
    it('control: output that is not a completion answer is refused, not guessed', () => {
        expect(() => parseCompleteOutput('not json')).toThrow();
        expect(() => parseCompleteOutput('{"prefix":"x"}')).toThrow(/candidates/);
        expect(() => parseCompleteOutput('{"prefix":"x","candidates":[{"label":"a","kind":"nope"}]}')).toThrow(/kind/);
    });
});

describe('toCompletionItems', () => {
    const result = parseCompleteOutput('{"context":"x","prefix":"us","candidates":[{"label":"uses","kind":"keyword"},{"label":"Button","kind":"pattern","detail":"atom"}]}');

    it('replaces the typed prefix and keeps orb order', () => {
        const items = toCompletionItems(result, { line: 3, character: 4 });
        expect(items.map((i) => i.label)).toEqual(['uses', 'Button']);
        expect(items[0].textEdit).toEqual({ range: { start: { line: 3, character: 2 }, end: { line: 3, character: 4 } }, newText: 'uses' });
        expect(items[0].kind).toBe(CompletionItemKind.Keyword);
        expect(items[1].detail).toBe('atom');
        const [first, second] = items.map((i) => i.sortText ?? '');
        expect(first < second).toBe(true);
    });

    it('edge: an empty prefix inserts at the cursor; the range is in UTF-16 units', () => {
        const empty = parseCompleteOutput('{"context":"x","prefix":"","candidates":[{"label":"persist","kind":"operator"}]}');
        expect(toCompletionItems(empty, { line: 0, character: 1 })[0].textEdit).toEqual({ range: { start: { line: 0, character: 1 }, end: { line: 0, character: 1 } }, newText: 'persist' });
        const astral = parseCompleteOutput('{"context":"x","prefix":"😀a","candidates":[{"label":"😀ab","kind":"entity-field"}]}');
        expect(toCompletionItems(astral, { line: 0, character: 5 })[0].textEdit).toEqual({ range: { start: { line: 0, character: 2 }, end: { line: 0, character: 5 } }, newText: '😀ab' });
    });
});

describe('completeArgs', () => {
    it('asks orb for the unsaved buffer at a byte offset', () => {
        expect(completeArgs(7)).toEqual(['complete', '--stdin', '--offset', '7']);
    });
});

const ORB = process.env.ORB_BIN ?? path.join(os.homedir(), 'bin', 'orb');

describe.skipIf(!fs.existsSync(ORB))('against the real orb', () => {
    it('a partial keyword at the top level completes to `orbital`', () => {
        const source = 'app a "1.0.0"\norbi';
        const stdout = execFileSync(ORB, completeArgs(byteOffsetOf(source, source.length)), { input: source, encoding: 'utf-8' });
        const items = toCompletionItems(parseCompleteOutput(stdout), { line: 1, character: 4 });
        expect(items.map((i) => i.label)).toContain('orbital');
        expect(items.find((i) => i.label === 'orbital')?.textEdit).toEqual({ range: { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } }, newText: 'orbital' });
    });
});
