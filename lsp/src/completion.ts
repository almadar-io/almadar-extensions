/**
 * `.lolo` completion: what `orb complete` says is valid at the cursor, as LSP items.
 * No `connection` dependency, so it's directly unit-testable.
 */
import { CompletionItem, CompletionItemKind, Position } from 'vscode-languageserver/node';

const ORB_KINDS = {
    keyword: CompletionItemKind.Keyword,
    'import-path': CompletionItemKind.Module,
    trait: CompletionItemKind.Class,
    orbital: CompletionItemKind.Module,
    'config-key': CompletionItemKind.Property,
    'entity-field': CompletionItemKind.Field,
    pattern: CompletionItemKind.Struct,
    prop: CompletionItemKind.Property,
    operator: CompletionItemKind.Function,
} as const;

export type OrbCompletionKind = keyof typeof ORB_KINDS;

export interface OrbCompletion {
    label: string;
    kind: OrbCompletionKind;
    detail?: string;
}

export interface OrbCompletionResult {
    prefix: string;
    candidates: OrbCompletion[];
}

function isOrbCompletionKind(v: unknown): v is OrbCompletionKind {
    return typeof v === 'string' && Object.prototype.hasOwnProperty.call(ORB_KINDS, v);
}

/** `orb complete` takes the cursor as a UTF-8 byte offset; the LSP counts UTF-16 units. */
export function byteOffsetOf(text: string, utf16Offset: number): number {
    return Buffer.byteLength(text.slice(0, Math.min(utf16Offset, text.length)), 'utf-8');
}

export function completeArgs(byteOffset: number): string[] {
    return ['complete', '--stdin', '--offset', String(byteOffset)];
}

export function parseCompleteOutput(stdout: string): OrbCompletionResult {
    const parsed: unknown = JSON.parse(stdout);
    if (typeof parsed !== 'object' || parsed === null) throw new Error('orb complete: not an object');
    const prefix: unknown = Reflect.get(parsed, 'prefix');
    const candidates: unknown = Reflect.get(parsed, 'candidates');
    if (typeof prefix !== 'string') throw new Error('orb complete: no prefix');
    if (!Array.isArray(candidates)) throw new Error('orb complete: no candidates');
    return {
        prefix,
        candidates: candidates.map((c: unknown): OrbCompletion => {
            if (typeof c !== 'object' || c === null) throw new Error('orb complete: a candidate is not an object');
            const label: unknown = Reflect.get(c, 'label');
            const kind: unknown = Reflect.get(c, 'kind');
            const detail: unknown = Reflect.get(c, 'detail');
            if (typeof label !== 'string') throw new Error('orb complete: a candidate has no label');
            if (!isOrbCompletionKind(kind)) throw new Error(`orb complete: unknown candidate kind ${String(kind)}`);
            return typeof detail === 'string' ? { label, kind, detail } : { label, kind };
        }),
    };
}

/** Each candidate replaces the typed prefix (on the cursor's line); orb's order is kept. */
export function toCompletionItems(result: OrbCompletionResult, position: Position): CompletionItem[] {
    const start = { line: position.line, character: Math.max(0, position.character - result.prefix.length) };
    const width = String(result.candidates.length).length;
    return result.candidates.map((c, i) => ({
        label: c.label,
        kind: ORB_KINDS[c.kind],
        ...(c.detail !== undefined ? { detail: c.detail } : {}),
        sortText: String(i).padStart(width, '0'),
        textEdit: { range: { start, end: position }, newText: c.label },
    }));
}
