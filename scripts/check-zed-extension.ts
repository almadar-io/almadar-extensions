#!/usr/bin/env tsx
/**
 * Zed extension consistency check — run via `pnpm run check:zed`.
 *
 * Two invariants, both of which Zed enforces at load time by silently
 * refusing to highlight `.lolo` at all (the only trace is
 * `failed to load language Lolo` in Zed.log):
 *
 *  1. `languages/lolo/highlights.scm` may reference only node types and
 *     field names that `tree-sitter-lolo/src/node-types.json` declares.
 *     One unknown name fails the whole query.
 *  2. `[grammars.lolo].rev` in `extension.toml` must name a commit whose
 *     `editors/zed/tree-sitter-lolo` tree equals the working tree. Zed
 *     compiles the grammar from that commit, never from disk, so a grammar
 *     edit that lands without a re-pin ships a query written for a grammar
 *     Zed never builds (2026-09-04: `expects` — see
 *     docs/Almadar_Extensions_Gaps.md X-1).
 *
 * `--skip-pin` runs only check 1 — for the pre-commit hook, since the commit
 * that changes the grammar cannot yet be pinned (its sha does not exist).
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const zedDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'editors', 'zed');
const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: zedDir, encoding: 'utf-8' }).trim();

interface NodeType {
    type: string;
    named: boolean;
    fields?: Record<string, unknown>;
}

interface QueryReferences {
    namedNodes: Set<string>;
    anonymousNodes: Set<string>;
    fields: Set<string>;
}

/**
 * Collects every node type and field name the query references. Strings
 * inside predicates (`(#any-of? @k "set" "emit")`) are values, not node
 * types, so predicate forms are skipped whole; `;` comments are skipped to
 * end of line; `_` is tree-sitter's wildcard and `@capture` names are free.
 */
function collectQueryReferences(query: string): QueryReferences {
    const refs: QueryReferences = { namedNodes: new Set(), anonymousNodes: new Set(), fields: new Set() };
    const identifierPattern = /[A-Za-z_][A-Za-z0-9_.]*/y;
    let i = 0;
    while (i < query.length) {
        const ch = query[i];
        if (ch === ';') {
            const eol = query.indexOf('\n', i);
            i = eol === -1 ? query.length : eol + 1;
            continue;
        }
        if (ch === '(' && query[i + 1] === '#') {
            let depth = 0;
            for (; i < query.length; i++) {
                if (query[i] === '(') depth++;
                else if (query[i] === ')' && --depth === 0) { i++; break; }
            }
            continue;
        }
        if (ch === '"') {
            let j = i + 1;
            let literal = '';
            while (j < query.length && query[j] !== '"') {
                if (query[j] === '\\') { literal += query[j + 1]; j += 2; continue; }
                literal += query[j++];
            }
            refs.anonymousNodes.add(literal);
            i = j + 1;
            continue;
        }
        if (ch === '@') {
            identifierPattern.lastIndex = i + 1;
            const m = identifierPattern.exec(query);
            i = m ? identifierPattern.lastIndex : i + 1;
            continue;
        }
        if (ch === '(' ) {
            identifierPattern.lastIndex = i + 1;
            const m = identifierPattern.exec(query);
            if (m && m[0] !== '_') refs.namedNodes.add(m[0]);
            i = m ? identifierPattern.lastIndex : i + 1;
            continue;
        }
        if (ch === '!' || /[A-Za-z_]/.test(ch)) {
            const start = ch === '!' ? i + 1 : i;
            identifierPattern.lastIndex = start;
            const m = identifierPattern.exec(query);
            if (m && (ch === '!' || query[identifierPattern.lastIndex] === ':')) refs.fields.add(m[0]);
            i = m ? identifierPattern.lastIndex : i + 1;
            continue;
        }
        i++;
    }
    return refs;
}

function checkHighlightsQuery(): string[] {
    const nodeTypes = JSON.parse(readFileSync(join(zedDir, 'tree-sitter-lolo', 'src', 'node-types.json'), 'utf-8')) as NodeType[];
    const named = new Set(nodeTypes.filter((n) => n.named).map((n) => n.type));
    const anonymous = new Set(nodeTypes.filter((n) => !n.named).map((n) => n.type));
    const fields = new Set(nodeTypes.flatMap((n) => Object.keys(n.fields ?? {})));
    const query = readFileSync(join(zedDir, 'languages', 'lolo', 'highlights.scm'), 'utf-8');
    const refs = collectQueryReferences(query);
    const problems: string[] = [];
    for (const n of refs.namedNodes) if (!named.has(n)) problems.push(`highlights.scm references named node "${n}" — not in node-types.json`);
    for (const n of refs.anonymousNodes) if (!anonymous.has(n)) problems.push(`highlights.scm references anonymous node "${n}" — not in node-types.json`);
    for (const f of refs.fields) if (!fields.has(f)) problems.push(`highlights.scm references field "${f}" — no node declares it`);
    return problems;
}

interface GrammarPin {
    rev: string;
    path: string;
}

/** Reads `[grammars.lolo]`'s `rev` and `path` from extension.toml. */
function readGrammarPin(): GrammarPin {
    const toml = readFileSync(join(zedDir, 'extension.toml'), 'utf-8');
    const lines = toml.split('\n');
    const start = lines.findIndex((l) => l.trim() === '[grammars.lolo]');
    if (start === -1) throw new Error('extension.toml: no [grammars.lolo] section');
    const section: Record<string, string> = {};
    for (const line of lines.slice(start + 1)) {
        if (/^\s*\[/.test(line)) break;
        const m = /^\s*([A-Za-z_]+)\s*=\s*"([^"]*)"/.exec(line);
        if (m) section[m[1]] = m[2];
    }
    const { rev, path } = section;
    if (!rev || !path) throw new Error('extension.toml: [grammars.lolo] needs both rev and path');
    return { rev, path };
}

/** Runs git at the submodule's top level — `[grammars.lolo].path` is repo-relative, as Zed reads it. */
function git(args: string[], opts: { allowFailure?: boolean } = {}): { ok: boolean; out: string } {
    try {
        return { ok: true, out: execFileSync('git', args, { cwd: repoRoot, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() };
    } catch (err) {
        if (opts.allowFailure) return { ok: false, out: '' };
        throw err;
    }
}

function checkGrammarPin(): string[] {
    const { rev, path } = readGrammarPin();
    if (!/^[0-9a-f]{40}$/.test(rev)) return [`extension.toml: [grammars.lolo].rev must be a full 40-hex commit sha (got "${rev}")`];
    if (!git(['cat-file', '-e', `${rev}^{commit}`], { allowFailure: true }).ok) {
        // Shallow CI checkouts only carry HEAD — fetch the pin on demand.
        if (!git(['fetch', '--depth=1', 'origin', rev], { allowFailure: true }).ok) {
            return [`extension.toml: pinned rev ${rev} is not a commit on origin — push the grammar commit first, then pin its sha`];
        }
    }
    const head = git(['rev-parse', 'HEAD']).out;
    const drift = git(['diff', '--quiet', rev, '--', path], { allowFailure: true });
    if (drift.ok) return [];
    return [
        `extension.toml: [grammars.lolo].rev ${rev} does not carry the working tree's ${path} — Zed compiles the grammar from that commit, so highlights.scm will not load.`,
        `  Commit + push the grammar, then set rev to that commit (HEAD is ${head}) in a follow-up commit.`,
    ];
}

const skipPin = process.argv.includes('--skip-pin');
const problems = [...checkHighlightsQuery(), ...(skipPin ? [] : checkGrammarPin())];
if (problems.length > 0) {
    console.error('check:zed FAILED');
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
}
console.log(`check:zed OK — highlights.scm matches node-types.json${skipPin ? ' (pin check skipped)' : '; grammar pin carries the working-tree grammar'}`);
