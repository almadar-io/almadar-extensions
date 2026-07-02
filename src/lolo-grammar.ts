/**
 * .lolo Grammar Generator
 *
 * Generates a full TextMate grammar for `.lolo` files (the authoring surface
 * `.orb` compiles down to — see @almadar/extensions' README), plus the
 * categorized token data a tree-sitter `highlights.scm` needs.
 *
 * Sourced from @almadar/syntax's `tokens.json` — the same canonical registry
 * `packages/almadar-syntax/src/lolo/prism-lolo.ts` (the reference .lolo
 * syntax highlighter) builds off, so keyword/operator/effect/pattern/
 * behavior lists never hand-drift from the registry. The token hierarchy
 * (order matters — first match wins) mirrors prism-lolo.ts's documented
 * order; punctuation, string escapes, and comment forms are grounded in the
 * real lolo lexer (orbital-rust/crates/orbital-lolo/src/lexer.rs), not just
 * the highlighting approximation.
 *
 * @packageDocumentation
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

// ============================================================================
// Token registry (from @almadar/syntax/tokens.json)
// ============================================================================

export interface LoloTokens {
    effectTypes: string[];
    operatorsByNamespace: Record<string, string[]>;
    patternNames: string[];
    behaviorNames: string[];
    /** Declaration keywords — introduce a new top-level or block construct. */
    loloKeywords: string[];
    /** Primitive field types. */
    loloPrimitiveTypes: string[];
    /** Persistence and event-scope keywords. */
    loloPersistenceAndScope: string[];
    /** Trait category tags (the `[category]` marker after a trait's entity name). */
    loloTraitCategories: string[];
}

let cachedTokens: LoloTokens | undefined;

/** Load @almadar/syntax's token registry (cached after first call). */
export function loadLoloTokens(): LoloTokens {
    if (cachedTokens) return cachedTokens;
    const require = createRequire(import.meta.url);
    const tokensPath = require.resolve('@almadar/syntax/tokens.json');
    const raw = JSON.parse(readFileSync(tokensPath, 'utf-8')) as Partial<LoloTokens>;
    cachedTokens = {
        effectTypes: raw.effectTypes ?? [],
        operatorsByNamespace: raw.operatorsByNamespace ?? {},
        patternNames: raw.patternNames ?? [],
        behaviorNames: raw.behaviorNames ?? [],
        loloKeywords: raw.loloKeywords ?? [],
        loloPrimitiveTypes: raw.loloPrimitiveTypes ?? [],
        loloPersistenceAndScope: raw.loloPersistenceAndScope ?? [],
        loloTraitCategories: raw.loloTraitCategories ?? [],
    };
    return cachedTokens;
}

/** Escape sequences the lolo lexer actually recognizes inside a string literal — no unicode escapes. */
const STRING_ESCAPE = String.raw`\\[ntr"\\/]`;

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wordsToAlternation(words: readonly string[]): string {
    return [...words].sort((a, b) => b.length - a.length).map(escapeRegex).join('|');
}

// ============================================================================
// TextMate grammar (VSCode)
// ============================================================================

interface TmRule {
    name?: string;
    match?: string;
    begin?: string;
    end?: string;
    patterns?: TmRule[];
}

export interface TmLanguageGrammar {
    $schema: string;
    name: string;
    scopeName: string;
    fileTypes: string[];
    patterns: TmRule[];
}

/**
 * Generate a full TextMate grammar for `.lolo` files. Rule order mirrors
 * prism-lolo.ts's token hierarchy (block-comment > comment > string >
 * binding > reference > event > keyword > effect > namespaced ops >
 * unknown op > type > persistence > category > constructor > arrow >
 * number > boolean > null > modifier > punctuation).
 */
export function generateLoloTmLanguage(): TmLanguageGrammar {
    const tokens = loadLoloTokens();

    const opNamespaceRules: TmRule[] = Object.entries(tokens.operatorsByNamespace)
        .filter(([ns, ops]) => ns !== 'effect' && ops.length > 0)
        .map(([ns, ops]) => ({
            name: `support.function.${ns}.lolo`,
            match: `(?<![a-zA-Z0-9_-])(?:${wordsToAlternation(ops)})(?![a-zA-Z0-9_-])`,
        }));

    const patterns: TmRule[] = [
        // 1. Block comment: #= ... =#
        { name: 'comment.block.lolo', begin: '#=', end: '=#' },

        // 2. Line comments: ;; and # (not followed by =)
        { name: 'comment.line.lolo', match: '(?:;;|#(?!=)).*$' },

        // 3. String literals, with behavior/pattern names highlighted inside
        {
            name: 'string.quoted.double.lolo',
            begin: '"',
            end: '"',
            patterns: [
                { name: 'constant.character.escape.lolo', match: STRING_ESCAPE },
                ...(tokens.behaviorNames.length > 0 ? [{
                    name: 'entity.name.function.behavior.lolo',
                    match: `(?:${wordsToAlternation(tokens.behaviorNames)})`,
                }] : []),
                ...(tokens.patternNames.length > 0 ? [{
                    name: 'support.type.pattern.lolo',
                    match: `(?<![a-zA-Z0-9_-])(?:${wordsToAlternation(tokens.patternNames)})(?![a-zA-Z0-9_-])`,
                }] : []),
            ],
        },

        // 4. Binding sigils: @field, @field.sub, ?field
        { name: 'variable.other.binding.lolo', match: '[@?][a-zA-Z_][a-zA-Z0-9_.]*' },

        // 5. Dotted qualified references: Modal.traits.X, Browse.entity
        { name: 'entity.name.type.reference.lolo', match: '\\b[A-Z][a-zA-Z0-9]*(?:\\.[a-zA-Z][a-zA-Z0-9]*){1,}\\b' },

        // 6. Event keys: UPPER_SNAKE_CASE (>= 2 uppercase chars)
        { name: 'constant.other.event.lolo', match: '\\b[A-Z][A-Z0-9_]+\\b' },

        // 7. Declaration keywords
        { name: 'keyword.control.lolo', match: `\\b(?:${wordsToAlternation(tokens.loloKeywords)})\\b` },

        // 8. Effect operators: set, persist, fetch, emit, render-ui, navigate, ...
        ...(tokens.effectTypes.length > 0 ? [{
            name: 'keyword.other.effect.lolo',
            match: `(?<![a-zA-Z0-9_-])(?:${wordsToAlternation(tokens.effectTypes)})(?![a-zA-Z0-9_-])`,
        }] : []),

        // 9. Namespaced runtime operators (math/, str/, array/, ...)
        ...opNamespaceRules,

        // 10. Unregistered namespaced operators -> flagged as invalid
        { name: 'invalid.illegal.unknown-operator.lolo', match: '(?<![a-zA-Z0-9_-])[a-z][a-z0-9_]*/[a-z][a-z0-9/_-]*(?![a-zA-Z0-9_-])' },

        // 11. Primitive types
        { name: 'storage.type.lolo', match: `\\b(?:${wordsToAlternation(tokens.loloPrimitiveTypes)})\\b` },

        // 12. Persistence and scope keywords
        { name: 'storage.modifier.persistence.lolo', match: `\\b(?:${wordsToAlternation(tokens.loloPersistenceAndScope)})\\b` },

        // 13. Trait category tags
        { name: 'support.type.category.lolo', match: `(?<![a-zA-Z0-9_-])(?:${wordsToAlternation(tokens.loloTraitCategories)})(?![a-zA-Z0-9_-])` },

        // 14. Constructor names: PascalCase identifiers
        { name: 'entity.name.class.lolo', match: '\\b[A-Z][a-zA-Z0-9]*\\b' },

        // 15. Transition / function arrow, and the double-colon type annotation
        { name: 'keyword.operator.arrow.lolo', match: '->|→|::|=' },

        // 16. Number literals
        { name: 'constant.numeric.lolo', match: '-?(?:\\d+\\.?\\d*)\\b' },

        // 17. Boolean literals
        { name: 'constant.language.boolean.lolo', match: '\\b(?:true|false)\\b' },

        // 18. Null
        { name: 'constant.language.null.lolo', match: '\\bnull\\b' },

        // 19. Type modifiers: ! (required), * (relation-many), + (relation-non-empty)
        { name: 'keyword.operator.modifier.lolo', match: '[!*+](?=\\s|$|,|\\)|\\]|\\{)' },

        // 20. Punctuation, including the event-arrow forms (--EVENT-->) and & separator
        { name: 'punctuation.lolo', match: '-->|--|[{}()[\\]:,|&]' },
    ];

    return {
        $schema: 'https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json',
        name: 'Lolo',
        scopeName: 'source.lolo',
        fileTypes: ['lolo'],
        patterns,
    };
}

/** Serialize the grammar to a formatted JSON string, ready for `lolo.tmLanguage.json`. */
export function generateLoloTmLanguageJson(): string {
    return JSON.stringify(generateLoloTmLanguage(), null, 2);
}

// ============================================================================
// Tree-sitter-adjacent data (Zed)
// ============================================================================

/** Flat, categorized token lists for building a tree-sitter `highlights.scm`
 *  against — capture names must still match whatever node types the actual
 *  generated parser produces, so this is data, not a ready-made query. */
export interface LoloHighlightData {
    keywords: readonly string[];
    types: readonly string[];
    persistence: readonly string[];
    categories: readonly string[];
    effects: string[];
    operatorsByNamespace: Record<string, string[]>;
    patternNames: string[];
    behaviorNames: string[];
}

export function getLoloHighlightData(): LoloHighlightData {
    const tokens = loadLoloTokens();
    return {
        keywords: tokens.loloKeywords,
        types: tokens.loloPrimitiveTypes,
        persistence: tokens.loloPersistenceAndScope,
        categories: tokens.loloTraitCategories,
        effects: tokens.effectTypes,
        operatorsByNamespace: tokens.operatorsByNamespace,
        patternNames: tokens.patternNames,
        behaviorNames: tokens.behaviorNames,
    };
}
