; Comments
(comment) @comment

; Literal keywords
[
  "app"
  "orbital"
  "uses"
  "from"
  "entity"
  "type"
  "derived"
  "trait"
  "initial"
  "state"
  "for"
  "emits"
  "listens"
  "ticks"
  "config"
  "page"
  "with"
  "as"
  "when"
  "every"
  "@rebindable"
] @keyword

; Strings
; `string` is an atomic token in this grammar — no `string_content`/
; `escape_sequence` child nodes exist to capture.
(string) @string

; Numbers / booleans / null
(number) @number
(boolean) @boolean
(null) @constant.builtin

; Bindings: @entity.field, ?payload.field
(sigil) @variable.special
(payload_sigil) @variable.special

; Event keys (UPPER_SNAKE / PascalCase transition triggers)
(event_name) @constant
(event_arrow) @constant

; Declaration names: constructor-like (entity/trait/orbital/page names)
(orbital name: (identifier) @type)
(entity name: (identifier) @type)
(trait name: (identifier) @type)
(trait entity: (identifier) @type)
(page name: (identifier) @type)
(page trait: (identifier) @type)
(type_alias name: (identifier) @type)
(dotted_reference (event_name) @type)
(dotted_reference (identifier) @type)

; Field / property names
(entity_field name: (identifier) @property)
(config_field name: (identifier) @property)
(type_object name: (identifier) @property)
(object_literal key: (identifier) @property)
(object_literal key: (string) @property)

; State / trait-binding names
(state_block name: (identifier) @variable)

; S-expression call head — the effect/operator name. It is the FIRST NAMED
; CHILD of `sexpr`, not a `sexpr_op`: `sexpr_op` only materializes for
; symbol heads (`(+ 1 2)`, `(= a b)`) because of the declared
; `[sexpr_op, _sexpr_arg]` GLR conflict — for an identifier head
; (`(set …)`, `(math/add …)`, the overwhelmingly common case) the
; `_sexpr_arg` parse wins and the head is a bare `identifier`. Anchoring on
; the first named child covers both shapes. Generic fallback first
; (namespaced runtime calls: math/add, array/map, ...), then the more
; specific effect / control-flow predicates below override it.
(sexpr . (identifier) @function)
(operator_symbol) @operator

; Effect operators (set, fetch, persist, emit, render-ui, navigate, ...)
; render as keywords, matching .orb's Zed highlighting.
((sexpr . (identifier) @keyword)
  (#any-of? @keyword
    "call-service"
    "despawn"
    "emit"
    "fetch"
    "fetch-stream"
    "log"
    "navigate"
    "notify"
    "persist"
    "ref"
    "render-ui"
    "send-server"
    "set"
    "spawn"))

; Control-flow / logic s-expr operators (if, and, or, not, let, do, fn, ...)
; also render as keywords.
((sexpr . (identifier) @keyword)
  (#any-of? @keyword
    "and"
    "do"
    "fn"
    "if"
    "let"
    "list"
    "not"
    "or"
    "when"))

; Primitive types
(type_atom (identifier) @type.builtin)

; Annotation tags: @description, @synonyms, @label, @tier, ...
(annotation_tag) @attribute

; Punctuation
[
  "("
  ")"
  "["
  "]"
  "{"
  "}"
] @punctuation.bracket

[
  ","
  ":"
  "::"
] @punctuation.delimiter

(arrow) @operator

[
  "="
  "!"
  "*"
  "+"
  "?"
  "|"
  "&"
] @operator
