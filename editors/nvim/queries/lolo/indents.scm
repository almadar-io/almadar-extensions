; .lolo indentation — hand-authored (not generated).
; Consumed by nvim-treesitter's `indentexpr()`; harmless without it.
[
  (orbital)
  (entity)
  (trait)
  (state_block)
  (config_block)
  (emits_block)
  (listens_block)
  (ticks_block)
  (with_block)
  (page)
  (object_literal)
  (array_literal)
  (type_object)
  (sexpr)
  (jsx_element)
] @indent.begin

[
  "}"
  ")"
  "]"
] @indent.branch @indent.end

(comment) @indent.auto
