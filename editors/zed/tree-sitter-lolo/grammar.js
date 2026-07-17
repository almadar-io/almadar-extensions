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

  // `(a b)` — `a` is the call head (sexpr_op) but also matches the
  // identifier alternative of _sexpr_arg. Harmless: GLR keeps both and
  // the op-first parse always wins for ≥1 identifier. Without this the
  // reformed `sexpr` rule (op and args as independent slots, needed for
  // nested group-as-arg forms) won't generate.
  conflicts: $ => [
    [$.sexpr_op, $._sexpr_arg],
    // `<` is operator_symbol AND the JSX opening delimiter. In value
    // position the JSX parse always wins (an operator-only `<` can't be
    // followed by a tag name); GLR keeps both.
    [$.operator_symbol, $.jsx_element],
    [$.type_atom, $._value],
    [$.type_atom, $._sexpr_arg],
    [$.type_atom, $.sexpr_op, $._sexpr_arg],
    [$.type_object, $.object_literal],
  ],

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
      // Optional single type parameter: `type Browsable T = ...`.
      optional(field('param', $.identifier)),
      '=',
      field('body', $.type_alias_body),
    ),
    // `type Status = active | inactive | pending` is just a type_union (below);
    // no separate enum rule needed — type_expr already covers the `A | B | C` shape.
    type_alias_body: $ => choice(
      $.event_type_body,
      $.entity_type_body,
      $.type_expr,
    ),
    // `type X = Entity [persistent: c] { fields }` and the Trait/Page/Orbital
    // shape-keyword bodies (parser/type.rs `parse_type_body_atom`).
    entity_type_body: $ => seq(
      choice('Entity', 'Trait', 'Page', 'Orbital'),
      optional($.bracket_tags),
      optional($.type_object),
      optional(seq($.arrow, $.identifier)),
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
      // Trailing field annotations: string-valued (`@description "..."`,
      // `@synonyms "..."`) or flag (`@key`, `@unique`, `@intrinsic`).
      repeat($.field_annotation),
      optional(seq('=', field('default', choice($.derived_value, $._sexpr_arg)))),
    ),
    derived_value: $ => seq('derived', $.sexpr),
    // `@key` / `@unique` / `@description "..."` on an entity field. The
    // string is optional so the bare-sigil flag form parses too.
    field_annotation: $ => seq($.annotation_tag, optional($.string)),

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
      $.type_map,
      $.type_atom,
      $.type_object,
      seq('(', $.type_expr, ')'),
    ),
    // `Map K V` — built-in dynamic-key map, applied by juxtaposition.
    type_map: $ => prec(1, prec.dynamic(1, seq('Map', $._type_atom_or_group, $._type_atom_or_group))),
    type_atom: $ => choice($.identifier, $.string),
    // `.lolo` object types are newline-separated with an *optional* comma
    // (see orbital-lolo parser/type.rs — `if Comma { advance }` then
    // `skip_newlines`). Newlines live in `extras`, so a bare `repeat` of
    // `field optional(',')` matches both `{ a : T b : U }` and `{ a : T, b : U }`.
    type_object: $ => seq(
      '{',
      repeat(seq(field('name', $.identifier), choice(':', '::'), field('type', $.type_expr), optional('!'), optional(','))),
      '}',
    ),

    // ── Bracket-tag modifiers: [persistent: name], [runtime], [interaction, instance] ──
    // Comma-optional, newline-separated (orbital-lolo parser/entity.rs + trait.rs).
    bracket_tags: $ => seq('[', repeat(seq($.bracket_tag, optional(','))), ']'),
    bracket_tag: $ => choice(
      seq(field('key', $.identifier), ':', field('value', $.identifier)),
      $.identifier,
    ),

    // ── Trait ─────────────────────────────────────────────────────────────
    // Two forms (parser/trait.rs): direct (`trait Name -> E {…}`) and
    // reference (`trait Name = Alias.traits.X [-> E] {…}`). The `=` after
    // the name disambiguates.
    trait: $ => seq(
      'trait',
      field('name', $.identifier),
      optional($.type_annotation),
      choice(
        seq(
          '=',
          field('reference', $.dotted_reference),
          optional(seq($.arrow, field('entity', $.identifier))),
          '{', repeat($._trait_ref_item), '}',
        ),
        seq(
          optional(seq($.arrow, optional('@rebindable'), field('entity', $.identifier))),
          optional($.bracket_tags),
          repeat($.annotation),
          '{', repeat($._trait_item), '}',
        ),
      ),
    ),
    _trait_ref_item: $ => choice(
      $.trait_ref_events,
      $.trait_ref_fields,
      $.config_block,
      $.listens_block,
      $.emits_scope,
      $.sexpr,
    ),
    // `events { OldEvent: NewEvent, ... }` and `fields { old: new, ... }`
    // rename maps inside a trait-reference body.
    trait_ref_events: $ => seq('events', optional(':'), '{', repeat(seq(field('from', $.identifier), ':', field('to', $.identifier), optional(','))), '}'),
    trait_ref_fields: $ => seq('fields', optional(':'), '{', repeat(seq(field('from', $.identifier), ':', field('to', choice($.identifier, $.string)), optional(','))), '}'),
    emits_scope: $ => seq('emitsScope', field('scope', $.identifier)),
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
      optional(seq('when', $._sexpr_arg)),
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
      field('event', choice($.event_name, $.sigil)),
      optional(seq($.arrow, field('scope', $.identifier))),
      optional($.type_object),
      repeat($.annotation),
    ),

    listens_block: $ => seq('listens', '{', repeat($.listen_decl), '}'),
    listen_decl: $ => seq(
      field('source', choice($.dotted_reference, $.event_name, $.sigil)),
      optional($.type_object),
      optional(seq($.arrow, field('local_event', $.event_name))),
      repeat($.annotation),
    ),

    config_block: $ => seq('config', optional(':'), '{', repeat(seq($.config_field, optional(','))), '}'),
    config_field: $ => seq(
      field('name', $.identifier),
      ':',
      // RHS is either a type (`string`, `"a" | "b"`, `[T]`, `Map K V`) or a
      // wiring value (`[ {...} ]`, `@config.x`, `"str"`, `5`). These overlap
      // on identifier/string/object/array, so the conflicts are declared
      // below; GLR keeps both and highlighting is identical either way.
      field('value', choice($.type_expr, $._sexpr_arg)),
      optional('!'),
      optional(seq('=', field('default', $._sexpr_arg))),
      repeat($.annotation),
    ),

    // `ticks { <name> every <interval> [when <guard>]\n  (effect)... }` —
    // the name is mandatory in the real grammar (parser/trait.rs
    // `parse_ticks_block`); `when` guard is optional. Comma-less,
    // newline-separated like everything else.
    ticks_block: $ => seq('ticks', '{', repeat($.tick_decl), '}'),
    tick_decl: $ => seq(
      field('name', $.identifier),
      'every',
      choice($.duration, $.string),
      optional(seq('when', $._sexpr_arg)),
      repeat($.sexpr),
    ),

    with_block: $ => seq('with', '{', repeat($._value), '}'),

    // ── Page ──────────────────────────────────────────────────────────────
    page: $ => seq(
      'page',
      field('path', $.string),
      optional(seq('as', field('name', $.identifier))),
      $.arrow,
      // `-> A B` and `-> A, B` both parse (orbital-lolo parser/page.rs).
      field('trait', seq($.identifier, repeat(seq(optional(','), $.identifier)))),
      optional($.bracket_tags),
    ),

    // ── S-expressions (effects, guards, config defaults) ─────────────────
    // An s-expression is `(`, an optional operator (call head), zero or
    // more args, then `)`. Op and args are kept as separate optional /
    // repeat slots (not `optional(seq(op, repeat(args)))`) so nested
    // group-as-arg forms like `(let ((r 1)) (let ((cv 2)) @cv))` parse
    // without GLR conflicts — the grouped form made the whole op+args
    // blob ambiguous against a bare `(...)` group.
    sexpr: $ => seq('(', optional($.sexpr_op), repeat($._sexpr_arg), ')'),
    // The real lexer wraps arithmetic/comparison symbols as plain Identifier
    // tokens (`+`, `-`, `*`, `/`, `%`, `<`, `>`, `<=`, `>=`, `==`, `!=`) so
    // they can appear in operator (call-head) position like any other op.
    sexpr_op: $ => choice($.identifier, '=', $.operator_symbol),
    operator_symbol: $ => choice('+', '-', '*', '/', '%', '<', '>', '<=', '>=', '==', '!='),
    _sexpr_arg: $ => choice(
      $.jsx_element,
      $.sexpr,
      $.object_literal,
      $.array_literal,
      $._value,
      $.sigil,
      $.payload_sigil,
      $.event_name,
      $.identifier,
    ),
    // Comma-optional, newline-separated (orbital-lolo parser/expression.rs).
    object_literal: $ => seq(
      '{',
      repeat(seq(field('key', choice($.identifier, $.string)), ':', $._sexpr_arg, optional(','))),
      '}',
    ),
    array_literal: $ => seq('[', repeat(seq($._sexpr_arg, optional(','))), ']'),

    // ── JSX (render-element sugar; orbital-lolo parser/jsx.rs) ────────────
    // `<Tag attr={expr}>…</Tag>` / `<Tag />` / `<trait.X />` /
    // `<Alias.traits.Name …>`. JSX only appears in value position (an
    // _sexpr_arg), so `<`/`>`/`/` here never collide with operator_symbol
    // (which is only valid in sexpr_op position).
    jsx_element: $ => seq(
      '<', $.jsx_tag_name, repeat($.jsx_attribute),
      choice(
        '/>',
        seq('>', repeat($._jsx_child), '</', $.jsx_tag_name, '>'),
      ),
    ),
    _jsx_child: $ => choice($.jsx_element, $.jsx_expr_container),
    jsx_expr_container: $ => seq('{', $._sexpr_arg, '}'),
    jsx_tag_name: $ => seq($.identifier, repeat(seq('.', $.identifier))),
    jsx_attribute: $ => seq(
      field('name', $.identifier),
      optional(seq('=', choice($.string, $.jsx_expr_container))),
    ),

    // ── Values / atoms ────────────────────────────────────────────────────
    _value: $ => choice($.string, $.number, $.boolean, $.null),
    sigil: $ => /@[a-zA-Z_][a-zA-Z0-9_.]*/,
    payload_sigil: $ => /\?[a-zA-Z_][a-zA-Z0-9_.]*|\?/,
    // Wrapped in `token()` with the escape regex inlined so the whole
    // string is ONE atomic lexical unit. Without this, the `comment`
    // extra (`#...` line comment) wins over string content when a string
    // value starts with `#` (e.g. color hex `"#fff"`) — tree-sitter's
    // lexer can't "contain" a repeat-of-choice-of-named-rule, so the `#`
    // inside the string leaks out as a comment start. Inlining costs us
    // the `escape_sequence` capture node (removed from highlights.scm).
    string: $ => token(seq('"', repeat(choice(/[^"\\]/, /\\[ntr"\\/]/)), '"')),
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
