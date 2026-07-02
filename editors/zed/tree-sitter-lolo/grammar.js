/**
 * Tree-sitter grammar for .lolo — Almadar's Lisp-surfaced orbital authoring
 * language (lowers to .orb JSON).
 *
 * Grounded in the real lexer/parser (orbital-rust/crates/orbital-lolo/src/
 * lexer.rs + src/parser/{mod,entity,trait,expression,type,page}.rs), not
 * just the syntax-highlighting approximation. The real parser is
 * "indentation is NOT significant... keyword/punctuation driven" (its own
 * module doc) — every construct starts with a distinctive keyword or an
 * unambiguous punctuation token, so newlines can live in `extras` here too.
 */

module.exports = grammar({
  name: 'lolo',

  extras: $ => [/\s/, $.comment],

  word: $ => $.identifier,

  rules: {
    source_file: $ => seq(
      optional($.app_header),
      repeat(choice($.type_alias, $.orbital)),
    ),

    // ── Comments ──────────────────────────────────────────────────────────
    comment: $ => choice(
      // `#= ... =#` block comment. Wrapped in `token()` so tree-sitter treats
      // the whole thing as one atomic lexical unit — without it, the pieces
      // get tokenized independently and other rules can win in between.
      // Non-greedy `*?` isn't reliably honored by tree-sitter's regex-to-DFA
      // compilation, so this uses the standard tree-sitter idiom for a
      // multi-char end delimiter (the same shape as the canonical `/* ... */`
      // C-comment regex, with `=`/`#` swapped in for `*`/`/`).
      token(seq('#=', /[^=]*=+([^#=][^=]*=+)*/, '#')),
      /;;.*/,
      // `#` not followed by `=` (block-comment opener already matched above).
      /#[^=\r\n][^\r\n]*/,
      /#\r?\n/,
    ),

    // ── App header ────────────────────────────────────────────────────────
    // Version is `vN` or a string ("1.0.0"); description is always a string.
    // A single trailing string is the version (e.g. `app rabit "0.3.0"`); a
    // second string is the description. Structured as one linear choice (not
    // two independently-optional string fields) so there's no ambiguity over
    // which string a lone string token belongs to.
    app_header: $ => seq(
      'app',
      field('name', $.identifier),
      optional(choice(
        field('version', $.version_tag),
        seq(field('version', $.string), optional(field('description', $.string))),
      )),
    ),
    version_tag: $ => /v[0-9][a-zA-Z0-9_.-]*/,

    // ── Type alias ────────────────────────────────────────────────────────
    type_alias: $ => seq(
      'type',
      field('name', $.identifier),
      '=',
      field('body', $.type_alias_body),
    ),
    // `type Status = active | inactive | pending` is just a type_union (below);
    // no separate enum rule needed — type_expr already covers the `A | B | C` shape.
    type_alias_body: $ => choice(
      $.event_type_body,
      $.type_expr,
    ),
    // `Event <TypeExpr> "description"` — the payload-event type-alias form.
    event_type_body: $ => seq('Event', $.type_expr, optional($.string)),

    // ── Orbital ───────────────────────────────────────────────────────────
    // The real parser also accepts a brace-less, indentation-implied body,
    // but that form is ambiguous for a CFG (nothing marks where the body
    // ends besides the next top-level keyword) and isn't used in the real
    // corpus — every committed .lolo file uses the brace form.
    orbital: $ => seq(
      'orbital',
      field('name', $.identifier),
      optional($.type_annotation),
      '{', repeat($._orbital_item), '}',
    ),
    _orbital_item: $ => choice(
      $.use_decl,
      $.type_alias,
      $.entity,
      $.trait,
      $.page,
      $.sexpr,
    ),
    type_annotation: $ => seq('::', $.identifier),

    use_decl: $ => seq('uses', field('alias', $.identifier), 'from', field('path', $.string)),

    // ── Entity ────────────────────────────────────────────────────────────
    entity: $ => seq(
      'entity',
      field('name', $.identifier),
      optional($.bracket_tags),
      optional($.type_annotation),
      '{',
      repeat($.entity_field),
      '}',
    ),
    entity_field: $ => seq(
      field('name', $.identifier),
      ':',
      field('type', $.type_expr),
      optional('!'),
      optional(seq('=', field('default', choice($.derived_value, $._value)))),
    ),
    derived_value: $ => seq('derived', $.sexpr),

    // ── Types ─────────────────────────────────────────────────────────────
    type_expr: $ => choice(
      $._type_postfix,
      $.type_union,
      $.type_intersection,
    ),
    type_union: $ => prec.left(1, sep2('|', $._type_postfix)),
    // `type Patient = Auditable & Entity` — shape composition.
    type_intersection: $ => prec.left(1, sep2('&', $._type_postfix)),
    _type_postfix: $ => choice(
      $._type_atom_or_group,
      $.type_array,
      $.type_relation_many,
      $.type_relation_many_nonempty,
      $.type_optional,
    ),
    type_array: $ => prec(2, seq('[', $.type_expr, ']')),
    type_relation_many: $ => prec(2, seq($._type_atom_or_group, '*')),
    type_relation_many_nonempty: $ => prec(2, seq($._type_atom_or_group, '+')),
    type_optional: $ => prec(2, seq($._type_atom_or_group, '?')),
    _type_atom_or_group: $ => choice(
      $.type_atom,
      $.type_object,
      seq('(', $.type_expr, ')'),
    ),
    type_atom: $ => choice($.identifier, $.string),
    type_object: $ => seq(
      '{',
      sep(',', seq(field('name', $.identifier), ':', field('type', $.type_expr), optional('!'))),
      '}',
    ),

    // ── Bracket-tag modifiers: [persistent: name], [runtime], [interaction, instance] ──
    bracket_tags: $ => seq('[', sep1(',', $.bracket_tag), ']'),
    bracket_tag: $ => choice(
      seq(field('key', $.identifier), ':', field('value', $.identifier)),
      $.identifier,
    ),

    // ── Trait ─────────────────────────────────────────────────────────────
    trait: $ => seq(
      'trait',
      field('name', $.identifier),
      $.arrow,
      optional('@rebindable'),
      field('entity', $.identifier),
      optional($.bracket_tags),
      repeat($.annotation),
      '{',
      repeat($._trait_item),
      '}',
    ),
    annotation: $ => seq($.annotation_tag, $.string),
    annotation_tag: $ => /@[a-zA-Z_][a-zA-Z0-9_]*/,
    _trait_item: $ => choice(
      $.initial_decl,
      $.state_block,
      $.emits_block,
      $.listens_block,
      $.config_block,
      $.ticks_block,
      $.with_block,
    ),
    initial_decl: $ => seq('initial', ':', $.identifier),

    // ── State / transitions ───────────────────────────────────────────────
    state_block: $ => seq(
      'state',
      field('name', $.identifier),
      optional(seq('for', $.duration)),
      '{',
      repeat($.transition),
      '}',
    ),
    duration: $ => /[0-9]+(ms|s|m|h|d)/,
    transition: $ => seq(
      field('event', $.event_ref),
      $.arrow,
      field('target', $.identifier),
      optional(seq('when', $.sexpr)),
      repeat($.sexpr),
    ),
    // Bare EVENT, dotted Trait.EVENT / Source.EVENT (cross-orbital listen
    // target), or the `--EVENT-->` arrow form (split by the real lexer into
    // DashDash + identifier + DashArrow — here matched as one token, since
    // no whitespace separates the pieces in real usage).
    event_ref: $ => choice(
      $.dotted_reference,
      $.event_name,
      $.event_arrow,
    ),
    event_arrow: $ => /--[A-Za-z_][A-Za-z0-9_]*-->/,
    arrow: $ => choice('->', '→'),

    emits_block: $ => seq('emits', '{', repeat($.emit_decl), '}'),
    emit_decl: $ => seq(
      field('event', $.event_name),
      optional(seq($.arrow, field('scope', $.identifier))),
      optional($.type_object),
    ),

    listens_block: $ => seq('listens', '{', repeat($.listen_decl), '}'),
    listen_decl: $ => seq(
      field('source', choice($.dotted_reference, $.event_name)),
      optional($.type_object),
      optional(seq($.arrow, field('local_event', $.event_name))),
    ),

    config_block: $ => seq('config', '{', repeat($.config_field), '}'),
    config_field: $ => seq(
      field('name', $.identifier),
      ':',
      field('type', $.type_expr),
      optional(seq('=', $._value)),
      repeat($.annotation),
    ),

    ticks_block: $ => seq('ticks', '{', repeat($.tick_decl), '}'),
    tick_decl: $ => seq('every', choice($.duration, $.string), repeat($.sexpr)),

    with_block: $ => seq('with', '{', repeat($._value), '}'),

    // ── Page ──────────────────────────────────────────────────────────────
    page: $ => seq(
      'page',
      field('path', $.string),
      optional(seq('as', field('name', $.identifier))),
      $.arrow,
      field('trait', sep1(',', $.identifier)),
      optional($.bracket_tags),
    ),

    // ── S-expressions (effects, guards, config defaults) ─────────────────
    sexpr: $ => seq('(', optional(seq($.sexpr_op, repeat($._sexpr_arg))), ')'),
    // The real lexer wraps arithmetic/comparison symbols as plain Identifier
    // tokens (`+`, `-`, `*`, `/`, `%`, `<`, `>`, `<=`, `>=`, `==`, `!=`) so
    // they can appear in operator (call-head) position like any other op.
    sexpr_op: $ => choice($.identifier, '=', $.operator_symbol),
    operator_symbol: $ => choice('+', '-', '*', '/', '%', '<', '>', '<=', '>=', '==', '!='),
    _sexpr_arg: $ => choice(
      $.sexpr,
      $.object_literal,
      $.array_literal,
      $._value,
      $.sigil,
      $.payload_sigil,
      $.identifier,
    ),
    object_literal: $ => seq(
      '{',
      sep(',', seq(field('key', choice($.identifier, $.string)), ':', $._sexpr_arg)),
      '}',
    ),
    array_literal: $ => seq('[', sep(',', $._sexpr_arg), ']'),

    // ── Values / atoms ────────────────────────────────────────────────────
    _value: $ => choice($.string, $.number, $.boolean, $.null),
    sigil: $ => /@[a-zA-Z_][a-zA-Z0-9_.]*/,
    payload_sigil: $ => /\?[a-zA-Z_][a-zA-Z0-9_.]*|\?/,
    string: $ => seq('"', repeat(choice(/[^"\\]/, $.escape_sequence)), '"'),
    escape_sequence: $ => /\\[ntr"\\/]/,
    number: $ => /-?[0-9]+(\.[0-9]+)?/,
    boolean: $ => choice('true', 'false'),
    null: $ => 'null',

    // Dotted qualified reference: Modal.traits.X, CoordinatorTrait.EVENT.
    dotted_reference: $ => prec(2, seq($.event_name, repeat1(seq('.', $.identifier)))),
    // UPPER_SNAKE or PascalCase event name (first char uppercase; see the
    // real parser's `is_event_name` — MixedCase like `BrowseItemLoaded` is
    // also a legal event name, not just UPPER_SNAKE).
    event_name: $ => /[A-Z][A-Za-z0-9_]*/,

    // Identifiers: alphanumeric + `_` + `/` + `-` continuation (namespaced
    // operators like math/clamp, hyphenated words like render-ui) — must
    // start with a letter or underscore.
    identifier: $ => /[a-zA-Z_][a-zA-Z0-9_/-]*/,
  },
});

function sep(delim, rule) {
  return optional(sep1(delim, rule));
}

function sep1(delim, rule) {
  return seq(rule, repeat(seq(delim, rule)));
}

function sep2(delim, rule) {
  return seq(rule, repeat1(seq(delim, rule)));
}
