; Orbital S-Expression Highlights for Zed
; This file provides TreeSitter-compatible highlighting queries
; for S-expression constructs inside .orb JSON files.

; Effect operators
((string_content) @keyword.operator
  (#match? @keyword.operator "^(set|emit|render-ui|navigate|persist|spawn|despawn|notify|call-service|fetch)$"))

; Control flow
((string_content) @keyword.control
  (#match? @keyword.control "^(if|when|let|do|fn|and|or|not)$"))

; Arithmetic operators
((string_content) @operator
  (#match? @operator "^(\\+|-|\\*|/|%|=|!=|<|>|<=|>=|abs|min|max|clamp|floor|ceil|round)$"))

; Standard library functions (std-*)
((string_content) @function.builtin
  (#match? @function.builtin "^(math|str|array|object|time|validate|format|async)/"))

; Bindings: @entity.*, @payload.*, @context.*, @config.*
((string_content) @variable.special
  (#match? @variable.special "^@(entity|payload|context|config)\\."))

; Events: UPPER_CASE identifiers
((string_content) @constant
  (#match? @constant "^[A-Z][A-Z0-9_]{2,}$"))

; UI Slots
((string_content) @tag
  (#match? @tag "^(main|sidebar|modal|drawer|overlay|center|toast|hud-top|hud-bottom|floating|system)$"))
