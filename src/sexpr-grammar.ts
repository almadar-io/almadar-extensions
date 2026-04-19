/**
 * S-Expression Grammar Generator
 *
 * Generates a TextMate injection grammar for S-expression syntax
 * highlighting inside .orb files. The grammar is derived from
 * @almadar/std — the single source of truth for all operator names.
 *
 * This means new operators automatically get highlighting when
 * the package is rebuilt. No manual grammar maintenance.
 *
 * @packageDocumentation
 */

import {
    OPERATOR_NAMES,
    OPERATORS,
    type OperatorMeta,
    type OperatorCategory,
} from '@almadar/std';

// ============================================================================
// Types
// ============================================================================

/**
 * TextMate grammar rule
 */
interface TmRule {
    name: string;
    match: string;
}

/**
 * TextMate injection grammar structure
 */
export interface TmInjectionGrammar {
    scopeName: string;
    injectionSelector: string;
    patterns: TmRule[];
}

// ============================================================================
// Category → Scope Mapping
// ============================================================================

/**
 * Maps operator categories to TextMate scopes for semantic coloring.
 */
const CATEGORY_SCOPES: Record<string, string> = {
    // Core language
    arithmetic: 'keyword.operator.arithmetic.sexpr',
    comparison: 'keyword.operator.comparison.sexpr',
    logic: 'keyword.operator.logical.sexpr',
    control: 'keyword.control.sexpr',
    effect: 'keyword.other.effect.sexpr',
    collection: 'support.function.collection.sexpr',

    // Standard library
    'std-math': 'support.function.math.sexpr',
    'std-str': 'support.function.string.sexpr',
    'std-array': 'support.function.array.sexpr',
    'std-object': 'support.function.object.sexpr',
    'std-time': 'support.function.time.sexpr',
    'std-validate': 'support.function.validate.sexpr',
    'std-format': 'support.function.format.sexpr',
    'std-async': 'support.function.async.sexpr',
    'std-nn': 'support.function.nn.sexpr',
    'std-tensor': 'support.function.tensor.sexpr',
    'std-train': 'support.function.train.sexpr',
};

// ============================================================================
// Grammar Generation
// ============================================================================

/**
 * Escape a string for use in a TextMate regex pattern.
 */
function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Group operator names by their TextMate scope.
 */
function groupOperatorsByScope(): Map<string, string[]> {
    const groups = new Map<string, string[]>();

    for (const name of OPERATOR_NAMES) {
        const meta: OperatorMeta | undefined = OPERATORS[name];
        const category = meta?.category ?? 'effect';
        const scope = CATEGORY_SCOPES[category] ?? 'keyword.other.sexpr';

        if (!groups.has(scope)) groups.set(scope, []);
        groups.get(scope)!.push(name);
    }

    return groups;
}

/**
 * Generate a TextMate injection grammar for S-expression highlighting.
 *
 * The grammar injects into `.orb` files (JSON scope) and highlights:
 * - **Operators** by category (arithmetic, effect, control, etc.)
 * - **Bindings** (`@entity.field`, `@payload.value`)
 * - **Events** (UPPER_CASE_NAMES)
 *
 * @returns A complete TextMate injection grammar object
 *
 * @example
 * ```ts
 * import { generateSExprGrammar } from '@almadar/extensions';
 * import { writeFileSync } from 'fs';
 *
 * const grammar = generateSExprGrammar();
 * writeFileSync('sexpr.injection.json', JSON.stringify(grammar, null, 2));
 * ```
 */
export function generateSExprGrammar(): TmInjectionGrammar {
    const patterns: TmRule[] = [];

    // 1. Operator keywords grouped by category/scope
    const groups = groupOperatorsByScope();
    for (const [scope, names] of groups) {
        // Sort by length descending so longer operators match first
        const sorted = [...names].sort((a, b) => b.length - a.length);
        const alternation = sorted.map(escapeRegex).join('|');

        patterns.push({
            name: scope,
            match: `(?<=")(${alternation})(?=")`,
        });
    }

    // 2. Bindings: @entity.field, @payload.value, @context.key
    patterns.push({
        name: 'variable.other.binding.sexpr',
        match: '(?<=")@(entity|payload|context|config)\\.[a-zA-Z_][a-zA-Z0-9_.]*(?=")',
    });

    // 3. Events: UPPER_CASE identifiers (e.g. SELECT_UNIT, ATTACK)
    patterns.push({
        name: 'constant.other.event.sexpr',
        match: '(?<=")[A-Z][A-Z0-9_]{2,}(?=")',
    });

    // 4. UI Slots: main, sidebar, modal, etc.
    patterns.push({
        name: 'entity.name.tag.slot.sexpr',
        match: '(?<=")(main|sidebar|modal|drawer|overlay|center|toast|hud-top|hud-bottom|floating|system)(?=")',
    });

    return {
        scopeName: 'source.orb.sexpr-injection',
        injectionSelector: 'L:source.orb -comment',
        patterns,
    };
}

/**
 * Serialize the grammar to a formatted JSON string.
 * Ready to be written to `sexpr.injection.json`.
 */
export function generateSExprGrammarJson(): string {
    return JSON.stringify(generateSExprGrammar(), null, 2);
}

/**
 * Get a flat list of all operator names from the registry.
 * Useful for editor extensions that need the operator list without
 * importing @almadar/std directly.
 */
export function getOperatorNames(): string[] {
    return [...OPERATOR_NAMES];
}

/**
 * Get operators grouped by category.
 * Useful for autocomplete that groups suggestions by category.
 */
export function getOperatorsByCategory(): Record<string, string[]> {
    const result: Record<string, string[]> = {};

    for (const name of OPERATOR_NAMES) {
        const meta: OperatorMeta | undefined = OPERATORS[name];
        const category = meta?.category ?? 'unknown';
        if (!result[category]) result[category] = [];
        result[category].push(name);
    }

    return result;
}
