/**
 * .orb JSON → Structured Arabic/English HTML renderer.
 *
 * Parses an orbital schema and renders it as a styled, readable HTML document
 * with the Al-Jazari palette: brass (states), crimson (guards), lapis (effects),
 * sky-blue (entities), gold (schema name / principles).
 */

import { isArabicSchema, getSchemaValue, AR_LABELS } from './arabic-keys.js';

// ---------------------------------------------------------------------------
// Types (loose — we parse arbitrary JSON)
// ---------------------------------------------------------------------------

type SchemaObj = Record<string, unknown>;

interface LangKeys {
    name: string;
    description: string;
    version: string;
    orbitals: string;
    entity: string;
    collection: string;
    persistence: string;
    fields: string;
    fieldName: string;
    fieldType: string;
    required: string;
    default: string;
    structure: string;
    traits: string;
    category: string;
    linkedEntity: string;
    stateMachine: string;
    states: string;
    isInitial: string;
    isTerminal: string;
    events: string;
    eventKey: string;
    transitions: string;
    from: string;
    to: string;
    event: string;
    principle: string;
    guards: string;
    effects: string;
    pages: string;
    pagePath: string;
    pageTraits: string;
    traitRef: string;
}

const AR: LangKeys = {
    name: 'اسم',
    description: 'وصف',
    version: 'إصدار',
    orbitals: 'مدارات',
    entity: 'كيان',
    collection: 'مجموعة',
    persistence: 'ثبات',
    fields: 'حقول',
    fieldName: 'اسم',
    fieldType: 'نوع',
    required: 'مطلوب',
    default: 'افتراضي',
    structure: '_بنية',
    traits: 'سمات',
    category: 'فئة',
    linkedEntity: 'كيان_مرتبط',
    stateMachine: 'آلة_حالة',
    states: 'حالات',
    isInitial: 'أولي',
    isTerminal: 'نهائي',
    events: 'أحداث',
    eventKey: 'مفتاح',
    transitions: 'انتقالات',
    from: 'من',
    to: 'إلى',
    event: 'حدث',
    principle: '_مبدأ',
    guards: 'حراس',
    effects: 'تأثيرات',
    pages: 'صفحات',
    pagePath: 'مسار',
    pageTraits: 'سمات',
    traitRef: 'مرجع',
};

const EN: LangKeys = {
    name: 'name',
    description: 'description',
    version: 'version',
    orbitals: 'orbitals',
    entity: 'entity',
    collection: 'collection',
    persistence: 'persistence',
    fields: 'fields',
    fieldName: 'name',
    fieldType: 'type',
    required: 'required',
    default: 'default',
    structure: '_structure',
    traits: 'traits',
    category: 'category',
    linkedEntity: 'linkedEntity',
    stateMachine: 'stateMachine',
    states: 'states',
    isInitial: 'isInitial',
    isTerminal: 'isTerminal',
    events: 'events',
    eventKey: 'key',
    transitions: 'transitions',
    from: 'from',
    to: 'to',
    event: 'event',
    principle: '_principle',
    guards: 'guards',
    effects: 'effects',
    pages: 'pages',
    pagePath: 'path',
    pageTraits: 'traits',
    traitRef: 'ref',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function esc(text: string): string {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function g(obj: SchemaObj, arKey: string, enKey: string): unknown {
    return getSchemaValue(obj, arKey, enKey);
}

function gStr(obj: SchemaObj, arKey: string, enKey: string): string {
    const v = g(obj, arKey, enKey);
    return v != null ? String(v) : '';
}

function gArr(obj: SchemaObj, arKey: string, enKey: string): SchemaObj[] {
    const v = g(obj, arKey, enKey);
    return Array.isArray(v) ? (v as SchemaObj[]) : [];
}

function gObj(obj: SchemaObj, arKey: string, enKey: string): SchemaObj | null {
    const v = g(obj, arKey, enKey);
    return v != null && typeof v === 'object' && !Array.isArray(v)
        ? (v as SchemaObj)
        : null;
}

// ---------------------------------------------------------------------------
// S-expression pretty-printer
// ---------------------------------------------------------------------------

function renderSExpr(expr: unknown, depth: number = 0): string {
    if (expr === null || expr === undefined) return '<span class="sexpr-null">null</span>';

    if (typeof expr === 'string') {
        if (expr.startsWith('@')) {
            return `<span class="sexpr-binding">${esc(expr)}</span>`;
        }
        return `<span class="sexpr-string">"${esc(expr)}"</span>`;
    }

    if (typeof expr === 'number' || typeof expr === 'boolean') {
        return `<span class="sexpr-literal">${expr}</span>`;
    }

    if (Array.isArray(expr)) {
        if (expr.length === 0) return '<span class="sexpr-bracket">[]</span>';

        const op = typeof expr[0] === 'string' ? expr[0] : null;
        const indent = '  '.repeat(depth);
        const innerIndent = '  '.repeat(depth + 1);

        // Short arrays inline
        const flat = JSON.stringify(expr);
        if (flat.length < 60 && depth > 0) {
            const items = expr.map((e) => renderSExpr(e, depth + 1)).join(', ');
            return `<span class="sexpr-bracket">[</span>${op ? `<span class="sexpr-op">${esc(String(op))}</span>, ` + expr.slice(1).map((e) => renderSExpr(e, depth + 1)).join(', ') : items}<span class="sexpr-bracket">]</span>`;
        }

        // Multi-line
        let html = `<span class="sexpr-bracket">[</span>`;
        if (op) {
            html += `<span class="sexpr-op">${esc(op)}</span>`;
        }
        const startIdx = op ? 1 : 0;
        for (let i = startIdx; i < expr.length; i++) {
            html += `\n${innerIndent}${renderSExpr(expr[i], depth + 1)}`;
            if (i < expr.length - 1) html += ',';
        }
        html += `\n${indent}<span class="sexpr-bracket">]</span>`;
        return html;
    }

    if (typeof expr === 'object') {
        const obj = expr as Record<string, unknown>;
        const entries = Object.entries(obj);
        if (entries.length === 0) return '{}';
        const indent = '  '.repeat(depth);
        const innerIndent = '  '.repeat(depth + 1);
        let html = '{\n';
        for (const [k, v] of entries) {
            html += `${innerIndent}<span class="sexpr-key">${esc(k)}</span>: ${renderSExpr(v, depth + 1)},\n`;
        }
        html += `${indent}}`;
        return html;
    }

    return esc(String(expr));
}

// ---------------------------------------------------------------------------
// Main renderer
// ---------------------------------------------------------------------------

export function renderOrb(text: string): string {
    let schema: SchemaObj;
    try {
        schema = JSON.parse(text) as SchemaObj;
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return `<div class="error-block"><h2>${AR_LABELS.parseError}</h2><pre>${esc(msg)}</pre></div>`;
    }

    const isAr = isArabicSchema(schema);
    const k = isAr ? AR : EN;
    const lbl = AR_LABELS;

    const parts: string[] = [];

    // Schema header
    const schemaName = gStr(schema, k.name, k.name);
    const schemaDesc = gStr(schema, k.description, k.description);
    const schemaVer = gStr(schema, k.version, k.version);

    parts.push(`<h1 class="schema-name">${esc(schemaName)}</h1>`);
    if (schemaVer) {
        parts.push(`<span class="version-badge">${lbl.version}: ${esc(schemaVer)}</span>`);
    }
    if (schemaDesc) {
        parts.push(`<p class="schema-desc">${esc(schemaDesc)}</p>`);
    }

    // Orbitals
    const orbitals = gArr(schema, k.orbitals, k.orbitals);
    for (const orbital of orbitals) {
        parts.push(renderOrbital(orbital, k, lbl, isAr));
    }

    return parts.join('\n');
}

function renderOrbital(orbital: SchemaObj, k: LangKeys, lbl: typeof AR_LABELS, isAr: boolean): string {
    const parts: string[] = [];
    const name = gStr(orbital, k.name, k.name);

    parts.push(`<section class="orbital"><h2 class="orbital-name">${lbl.orbital}: ${esc(name)}</h2>`);

    // Entity
    const entity = gObj(orbital, k.entity, k.entity);
    if (entity) {
        parts.push(renderEntity(entity, k, lbl));
    }

    // Traits
    const traits = gArr(orbital, k.traits, k.traits);
    if (traits.length > 0) {
        parts.push(`<div class="traits-section"><h3>${lbl.traits}</h3>`);
        for (const trait of traits) {
            parts.push(renderTrait(trait, k, lbl, isAr));
        }
        parts.push('</div>');
    }

    // Pages
    const pages = gArr(orbital, k.pages, k.pages);
    if (pages.length > 0) {
        parts.push(`<div class="pages-section"><h3>${lbl.pages}</h3>`);
        for (const page of pages) {
            const pageName = gStr(page, k.name, k.name);
            const pagePath = gStr(page, k.pagePath, k.pagePath);
            const pageTraits = gArr(page, k.pageTraits, k.pageTraits);
            const refs = pageTraits
                .map((t) => gStr(t, k.traitRef, k.traitRef))
                .filter(Boolean)
                .join('، ');
            parts.push(
                `<div class="page-item"><span class="page-name">${esc(pageName)}</span>` +
                `<span class="page-path">${lbl.path}: ${esc(pagePath)}</span>` +
                (refs ? `<span class="page-refs">${lbl.traitRefs}: ${esc(refs)}</span>` : '') +
                `</div>`,
            );
        }
        parts.push('</div>');
    }

    parts.push('</section>');
    return parts.join('\n');
}

function renderEntity(entity: SchemaObj, k: LangKeys, lbl: typeof AR_LABELS): string {
    const parts: string[] = [];
    const name = gStr(entity, k.name, k.name);
    const collection = gStr(entity, k.collection, k.collection);
    const persistence = gStr(entity, k.persistence, k.persistence);

    parts.push(`<div class="entity-block"><h3 class="entity-name">${lbl.entity}: ${esc(name)}</h3>`);

    const meta: string[] = [];
    if (collection) meta.push(`${lbl.collection}: <code>${esc(collection)}</code>`);
    if (persistence) meta.push(`${lbl.persistence}: ${esc(persistence)}`);
    if (meta.length) parts.push(`<div class="entity-meta">${meta.join(' · ')}</div>`);

    // Fields table
    const fields = gArr(entity, k.fields, k.fields);
    if (fields.length > 0) {
        parts.push(`<table class="fields-table"><thead><tr>`);
        parts.push(`<th>${lbl.fieldName}</th><th>${lbl.fieldType}</th><th>${lbl.required}</th><th>${lbl.default}</th><th>${lbl.structure}</th>`);
        parts.push(`</tr></thead><tbody>`);
        for (const field of fields) {
            const fname = gStr(field, k.fieldName, k.fieldName);
            const ftype = gStr(field, k.fieldType, k.fieldType);
            const freq = g(field, k.required, k.required);
            const fdef = g(field, k.default, k.default);
            const fstruct = gStr(field, k.structure, k.structure);
            const fvals = g(field, 'قيم', 'values');

            let typeStr = esc(ftype);
            if (Array.isArray(fvals)) {
                typeStr += ` <span class="enum-values">[${(fvals as string[]).map((v) => esc(String(v))).join(' | ')}]</span>`;
            }

            parts.push(`<tr>`);
            parts.push(`<td class="field-name">${esc(fname)}</td>`);
            parts.push(`<td>${typeStr}</td>`);
            parts.push(`<td>${freq === true ? `<span class="badge-required">${lbl.yes}</span>` : ''}</td>`);
            parts.push(`<td>${fdef != null ? `<code>${esc(String(fdef))}</code>` : ''}</td>`);
            parts.push(`<td class="field-structure">${fstruct ? esc(fstruct) : ''}</td>`);
            parts.push(`</tr>`);
        }
        parts.push(`</tbody></table>`);
    }

    parts.push('</div>');
    return parts.join('\n');
}

function renderTrait(trait: SchemaObj, k: LangKeys, lbl: typeof AR_LABELS, isAr: boolean): string {
    const parts: string[] = [];
    const name = gStr(trait, k.name, k.name);
    const category = gStr(trait, k.category, k.category);
    const linked = gStr(trait, k.linkedEntity, k.linkedEntity);

    parts.push(`<div class="trait-block"><h4 class="trait-name">${lbl.trait}: ${esc(name)}</h4>`);

    const meta: string[] = [];
    if (category) meta.push(`${lbl.category}: ${esc(category)}`);
    if (linked) meta.push(`${lbl.linkedEntity}: ${esc(linked)}`);
    if (meta.length) parts.push(`<div class="trait-meta">${meta.join(' · ')}</div>`);

    // State machine
    const sm = gObj(trait, k.stateMachine, k.stateMachine);
    if (sm) {
        parts.push(renderStateMachine(sm, k, lbl, isAr));
    }

    parts.push('</div>');
    return parts.join('\n');
}

function renderStateMachine(sm: SchemaObj, k: LangKeys, lbl: typeof AR_LABELS, isAr: boolean): string {
    const parts: string[] = [];

    // States as pills
    const states = gArr(sm, k.states, k.states);
    if (states.length > 0) {
        parts.push(`<div class="sm-section"><span class="sm-label">${lbl.states}:</span><div class="state-pills">`);
        for (const state of states) {
            const sname = gStr(state, 'اسم', 'name');
            const isInit = g(state, k.isInitial, k.isInitial) === true;
            const isTerm = g(state, k.isTerminal, k.isTerminal) === true;

            let cls = 'state-pill';
            let suffix = '';
            if (isInit) {
                cls += ' state-initial';
                suffix = ` (${lbl.initial})`;
            }
            if (isTerm) {
                cls += ' state-terminal';
                suffix = ` (${lbl.terminal})`;
            }

            parts.push(`<span class="${cls}">${esc(sname)}${suffix}</span>`);
        }
        parts.push('</div></div>');
    }

    // Events
    const events = gArr(sm, k.events, k.events);
    if (events.length > 0) {
        parts.push(`<div class="sm-section"><span class="sm-label">${lbl.events}:</span><div class="event-tags">`);
        for (const evt of events) {
            const ekey = typeof evt === 'string' ? evt : gStr(evt, k.eventKey, k.eventKey);
            const ename =
                typeof evt === 'string' ? evt : gStr(evt, 'اسم', 'name') || ekey;
            parts.push(
                `<span class="event-tag" title="${esc(ename)}">${esc(ekey)}</span>`,
            );
        }
        parts.push('</div></div>');
    }

    // Transitions
    const transitions = gArr(sm, k.transitions, k.transitions);
    if (transitions.length > 0) {
        parts.push(`<div class="sm-section"><span class="sm-label">${lbl.transitions}:</span>`);
        for (const tr of transitions) {
            parts.push(renderTransition(tr, k, lbl, isAr));
        }
        parts.push('</div>');
    }

    return parts.join('\n');
}

function renderTransition(tr: SchemaObj, k: LangKeys, lbl: typeof AR_LABELS, isAr: boolean): string {
    const parts: string[] = [];
    const from = gStr(tr, k.from, k.from);
    const to = gStr(tr, k.to, k.to);
    const event = gStr(tr, k.event, k.event);
    const principle = gStr(tr, k.principle, k.principle);
    const guards = g(tr, k.guards, k.guards);
    const effects = g(tr, k.effects, k.effects);

    // For English schemas, S-expressions render LTR; Arabic schemas stay RTL
    const sexprCls = isAr ? 'sexpr' : 'sexpr sexpr-ltr';

    parts.push(`<div class="transition-block">`);

    // Header: from → to on event
    parts.push(
        `<div class="transition-header">` +
        `<span class="state-ref">${esc(from)}</span>` +
        ` <span class="arrow">←</span> ` +
        `<span class="state-ref">${esc(to)}</span>` +
        ` <span class="transition-event">[${esc(event)}]</span>` +
        `</div>`,
    );

    // Principle
    if (principle) {
        parts.push(`<div class="principle">${lbl.principle}: ${esc(principle)}</div>`);
    }

    // Guards
    if (Array.isArray(guards) && guards.length > 0) {
        parts.push(`<div class="guards-block"><span class="guard-label">${lbl.guards}:</span>`);
        for (const guard of guards) {
            parts.push(`<pre class="${sexprCls} guard-sexpr">${renderSExpr(guard, 1)}</pre>`);
        }
        parts.push('</div>');
    }

    // Effects
    if (Array.isArray(effects) && effects.length > 0) {
        parts.push(`<div class="effects-block"><span class="effect-label">${lbl.effects}:</span>`);
        for (const effect of effects) {
            parts.push(`<pre class="${sexprCls} effect-sexpr">${renderSExpr(effect, 1)}</pre>`);
        }
        parts.push('</div>');
    }

    parts.push('</div>');
    return parts.join('\n');
}
