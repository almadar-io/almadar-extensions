/**
 * Server-side SVG string generator for the Al-Jazari state machine diagram.
 * No React dependency — outputs raw SVG markup using the shared layout engine.
 */

import { computeJazariLayout } from '@almadar/ui/lib/jazari/layout';
import {
  gearTeethPath,
  lockIconPath,
  brainIconPath,
  pipeIconPath,
  eightPointedStarPath,
  arrowheadPath,
} from '@almadar/ui/lib/jazari/svg-paths';
import { JAZARI_COLORS } from '@almadar/ui/lib/jazari/types';
import type { JazariLayout, JazariArmLayout, JazariGearLayout } from '@almadar/ui/lib/jazari/types';
import { getSchemaValue } from './arabic-keys.js';

// ---------------------------------------------------------------------------
// Types (loose — we parse arbitrary JSON)
// ---------------------------------------------------------------------------

type SchemaObj = Record<string, unknown>;

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

function gStr(obj: SchemaObj, arKey: string, enKey: string): string {
  const v = getSchemaValue(obj, arKey, enKey);
  return v != null ? String(v) : '';
}

function gArr(obj: SchemaObj, arKey: string, enKey: string): SchemaObj[] {
  const v = getSchemaValue(obj, arKey, enKey);
  return Array.isArray(v) ? (v as SchemaObj[]) : [];
}

function gObj(obj: SchemaObj, arKey: string, enKey: string): SchemaObj | null {
  const v = getSchemaValue(obj, arKey, enKey);
  return v != null && typeof v === 'object' && !Array.isArray(v)
    ? (v as SchemaObj)
    : null;
}

// ---------------------------------------------------------------------------
// Extract state machine from schema
// ---------------------------------------------------------------------------

interface ExtractedSM {
  traitName: string;
  states: Array<{ name: string; isInitial?: boolean; isTerminal?: boolean }>;
  transitions: Array<{ from: string; to: string; event: string; guard?: unknown; effects?: unknown[] }>;
  entityFields: string[];
  isArabic: boolean;
}

function extractFirstStateMachine(schema: SchemaObj): ExtractedSM | null {
  const orbitals = gArr(schema, 'مدارات', 'orbitals');
  if (orbitals.length === 0) return null;

  // Detect Arabic
  const isArabic = 'مدارات' in schema || 'اسم' in schema;

  for (const orbital of orbitals) {
    // Entity fields
    const entity = gObj(orbital, 'كيان', 'entity');
    const entityFields: string[] = [];
    if (entity) {
      const fields = gArr(entity, 'حقول', 'fields');
      for (const f of fields) {
        const fname = gStr(f, 'اسم', 'name');
        if (fname) entityFields.push(fname);
      }
    }

    // Traits
    const traits = gArr(orbital, 'سمات', 'traits');
    for (const trait of traits) {
      const sm = gObj(trait, 'آلة_حالة', 'stateMachine');
      if (!sm) continue;

      const traitName = gStr(trait, 'اسم', 'name');
      const statesRaw = gArr(sm, 'حالات', 'states');
      const transitionsRaw = gArr(sm, 'انتقالات', 'transitions');

      const states = statesRaw.map((s) => ({
        name: gStr(s, 'اسم', 'name'),
        isInitial: getSchemaValue(s, 'أولي', 'isInitial') === true,
        isTerminal: getSchemaValue(s, 'نهائي', 'isTerminal') === true,
      }));

      const transitions = transitionsRaw.map((t) => ({
        from: gStr(t, 'من', 'from'),
        to: gStr(t, 'إلى', 'to'),
        event: gStr(t, 'حدث', 'event'),
        guard: getSchemaValue(t, 'حراس', 'guard') ?? getSchemaValue(t, 'حراس', 'guards'),
        effects: gArr(t, 'تأثيرات', 'effects') as unknown[],
      }));

      if (states.length > 0) {
        return { traitName, states, transitions, entityFields, isArabic };
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// SVG string builders
// ---------------------------------------------------------------------------

function renderGearSvg(gear: JazariGearLayout): string {
  const outerR = gear.radius + 7;
  const innerR = gear.radius * 0.6;
  const teethD = gearTeethPath(gear.cx, gear.cy, gear.radius - 2, outerR, 12);

  const fillColor = gear.isInitial ? JAZARI_COLORS.gold : JAZARI_COLORS.brass;
  const strokeDash = gear.isTerminal ? 'stroke-dasharray="4 3"' : '';
  const filter = gear.isInitial ? 'filter="url(#jazari-glow)"' : '';

  const label = gear.name.length > 10 ? `${gear.name.slice(0, 9)}…` : gear.name;
  const fontSize = gear.name.length > 7 ? 9 : 11;

  return [
    `<g class="jazari-gear">`,
    `  <path d="${teethD}" fill="${fillColor}" fill-opacity="0.2" stroke="${fillColor}" stroke-width="1.5" ${strokeDash} ${filter}/>`,
    `  <circle cx="${gear.cx}" cy="${gear.cy}" r="${innerR}" fill="${fillColor}" fill-opacity="0.15" stroke="${fillColor}" stroke-width="1" ${strokeDash}/>`,
    `  <text x="${gear.cx}" y="${gear.cy}" text-anchor="middle" dominant-baseline="central" fill="${fillColor}" font-size="${fontSize}" font-weight="600" font-family="'Noto Naskh Arabic', serif">${esc(label)}</text>`,
    `</g>`,
  ].join('\n');
}

function renderArmSvg(arm: JazariArmLayout): string {
  if (!arm.path) return '';

  // Build tooltip
  const tipLines = [`${esc(arm.from)} → ${esc(arm.to)}`, `Event: ${esc(arm.event)}`];
  if (arm.guard) {
    tipLines.push(`Guard: ${arm.guard.isAI ? 'AI (call-service)' : 'deterministic'}`);
  }
  if (arm.effect) {
    tipLines.push('Effects:');
    for (const name of arm.effect.names) {
      tipLines.push(`  ${esc(name)}`);
    }
  }

  const tipText = tipLines.join('\n');

  const parts: string[] = [
    `<g class="jazari-arm">`,
    `  <path d="${arm.path}" fill="none" stroke="${JAZARI_COLORS.brass}" stroke-width="1.5" stroke-opacity="0.7" marker-end="url(#jazari-arrow)"/>`,
    `  <path d="${arm.path}" fill="none" stroke="transparent" stroke-width="14" style="cursor:pointer"><title>${tipText}</title></path>`,
    // Event label — opaque background so line doesn't obscure text
    `  <rect x="${arm.labelX - 30}" y="${arm.labelY - 10}" width="60" height="18" rx="4" fill="${JAZARI_COLORS.darkBg}" stroke="${JAZARI_COLORS.lapis}" stroke-width="0.5" stroke-opacity="0.4" style="cursor:pointer"><title>${tipText}</title></rect>`,
    `  <text x="${arm.labelX}" y="${arm.labelY}" text-anchor="middle" dominant-baseline="central" fill="${JAZARI_COLORS.lapis}" font-size="8" font-weight="600" font-family="monospace">${esc(arm.event.length > 12 ? arm.event.slice(0, 11) + '…' : arm.event)}</text>`,
  ];

  // Guard
  if (arm.guard) {
    const d = arm.guard.isAI
      ? brainIconPath(arm.guard.x, arm.guard.y, 14)
      : lockIconPath(arm.guard.x, arm.guard.y, 14);
    parts.push(`  <path d="${d}" fill="${JAZARI_COLORS.crimson}" fill-opacity="0.85" stroke="${JAZARI_COLORS.crimson}" stroke-width="0.8"/>`);
  }

  // Effect
  if (arm.effect) {
    const d = pipeIconPath(arm.effect.x, arm.effect.y, 14);
    parts.push(`  <path d="${d}" fill="${JAZARI_COLORS.sky}" fill-opacity="0.85" stroke="${JAZARI_COLORS.sky}" stroke-width="0.8"/>`);
    if (arm.effect.count > 1) {
      parts.push(`  <circle cx="${arm.effect.x + 7}" cy="${arm.effect.y - 5.6}" r="4.2" fill="${JAZARI_COLORS.sky}"/>`);
      parts.push(`  <text x="${arm.effect.x + 7}" y="${arm.effect.y - 5.6}" text-anchor="middle" dominant-baseline="central" fill="#fff" font-size="4.9" font-weight="700">${arm.effect.count}</text>`);
    }
  }

  parts.push('</g>');
  return parts.join('\n');
}

function renderBorderSvg(w: number, h: number): string {
  const tileSize = 20;
  const starOuter = tileSize * 0.4;
  const starInner = tileSize * 0.2;
  const starCenter = tileSize / 2;
  const starD = eightPointedStarPath(starCenter, starCenter, starOuter, starInner);

  return [
    `<defs>`,
    `  <pattern id="jazari-arabesque-pattern" x="0" y="0" width="${tileSize}" height="${tileSize}" patternUnits="userSpaceOnUse">`,
    `    <rect width="${tileSize}" height="${tileSize}" fill="${JAZARI_COLORS.lapis}" fill-opacity="0.1"/>`,
    `    <path d="${starD}" fill="${JAZARI_COLORS.gold}" fill-opacity="0.6"/>`,
    `  </pattern>`,
    `  <mask id="jazari-border-mask">`,
    `    <rect x="0" y="0" width="${w}" height="${h}" fill="white"/>`,
    `    <rect x="14" y="14" width="${w - 28}" height="${h - 28}" rx="6" fill="black"/>`,
    `  </mask>`,
    `</defs>`,
    `<rect x="0" y="0" width="${w}" height="${h}" rx="8" fill="url(#jazari-arabesque-pattern)" mask="url(#jazari-border-mask)"/>`,
    `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="8" fill="none" stroke="${JAZARI_COLORS.gold}" stroke-width="1" stroke-opacity="0.4"/>`,
  ].join('\n');
}

function renderAxisSvg(layout: JazariLayout): string {
  const parts: string[] = [
    `<line x1="${layout.axisStartX - 20}" y1="${layout.axisY}" x2="${layout.axisEndX + 20}" y2="${layout.axisY}" stroke="${JAZARI_COLORS.gold}" stroke-width="2" stroke-opacity="0.5"/>`,
    `<circle cx="${layout.axisStartX - 20}" cy="${layout.axisY}" r="3" fill="${JAZARI_COLORS.gold}" fill-opacity="0.6"/>`,
    `<circle cx="${layout.axisEndX + 20}" cy="${layout.axisY}" r="3" fill="${JAZARI_COLORS.gold}" fill-opacity="0.6"/>`,
  ];

  const totalLen = Math.abs(layout.axisEndX - layout.axisStartX);
  const fieldCount = layout.entityFields.length;
  if (fieldCount > 0) {
    layout.entityFields.forEach((field, i) => {
      const x = layout.axisStartX + (totalLen / (fieldCount + 1)) * (i + 1);
      parts.push(
        `<text x="${x}" y="${layout.axisY + 18}" text-anchor="middle" fill="${JAZARI_COLORS.sky}" font-size="8" font-family="monospace" opacity="0.7">${esc(field)}</text>`,
      );
    });
  }

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render an Al-Jazari state machine diagram as an SVG string.
 * Returns empty string if no state machine found in the schema.
 */
export function renderJazariDiagram(schemaText: string): string {
  let schema: SchemaObj;
  try {
    schema = JSON.parse(schemaText) as SchemaObj;
  } catch {
    return '';
  }

  const extracted = extractFirstStateMachine(schema);
  if (!extracted || extracted.states.length === 0) return '';

  const direction = extracted.isArabic ? 'rtl' : 'ltr';
  const layout = computeJazariLayout({
    states: extracted.states,
    transitions: extracted.transitions,
    entityFields: extracted.entityFields,
    direction,
  });

  const arrowSize = 8;

  const parts: string[] = [
    `<div class="jazari-diagram">`,
    `<svg width="100%" viewBox="0 0 ${layout.width} ${layout.height}" xmlns="http://www.w3.org/2000/svg" style="max-width:${layout.width}px;display:block;margin:0 auto">`,
    `<defs>`,
    `  <filter id="jazari-glow"><feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`,
    `  <marker id="jazari-arrow" viewBox="0 0 ${arrowSize} ${arrowSize}" refX="${arrowSize}" refY="${arrowSize / 2}" markerWidth="${arrowSize}" markerHeight="${arrowSize}" orient="auto-start-reverse">`,
    `    <path d="${arrowheadPath(arrowSize)}" fill="${JAZARI_COLORS.brass}" fill-opacity="0.7"/>`,
    `  </marker>`,
    `</defs>`,
    // Background
    `<rect x="0" y="0" width="${layout.width}" height="${layout.height}" fill="${JAZARI_COLORS.ivory}" fill-opacity="0.03" rx="8"/>`,
    // Border
    renderBorderSvg(layout.width, layout.height),
    // Axis
    renderAxisSvg(layout),
  ];

  // Arms
  for (const arm of layout.arms) {
    parts.push(renderArmSvg(arm));
  }

  // Gears
  for (const gear of layout.gears) {
    parts.push(renderGearSvg(gear));
  }

  // Trait name
  parts.push(
    `<text x="${layout.width / 2}" y="20" text-anchor="middle" fill="${JAZARI_COLORS.gold}" font-size="13" font-weight="700" font-family="'Noto Naskh Arabic', serif">${esc(extracted.traitName)}</text>`,
  );

  parts.push('</svg>');
  parts.push('</div>');
  return parts.join('\n');
}
