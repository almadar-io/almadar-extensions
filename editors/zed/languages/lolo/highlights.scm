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
(string) @string
(escape_sequence) @string.escape

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

; S-expression call head — the effect/operator name
(sexpr_op (identifier) @function)
(operator_symbol) @operator

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

(identifier) @variable
