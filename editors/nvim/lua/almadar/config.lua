--- Configuration for the Almadar Neovim plugin.
---
--- Everything is optional; the defaults give working highlighting, diagnostics
--- and `:Orb*` commands with no `setup()` call at all.
local M = {}

---@class almadar.Config
---@field treesitter almadar.TreesitterConfig
---@field lsp almadar.LspConfig
---@field cmd string|nil Path to the `orb` binary. nil = resolve from $PATH.

---@class almadar.TreesitterConfig
---@field enabled boolean Attach tree-sitter highlighting for .lolo/.orb.
---@field auto_install boolean Compile the bundled tree-sitter-lolo parser on demand.
---@field grammar_dir string|nil Override the tree-sitter-lolo source directory.
---@field parser_dir string|nil Where compiled parsers are written.
---@field compiler string[] Candidate C compilers, tried in order.

---@class almadar.LspConfig
---@field enabled boolean Start orb-lsp for .lolo/.orb buffers.
---@field cmd string[]|nil Full command. nil = the bundled server via `node`.
---@field root_markers string[] Files that mark the workspace root.

---@type almadar.Config
local defaults = {
    treesitter = {
        enabled = true,
        auto_install = true,
        grammar_dir = nil,
        parser_dir = nil,
        compiler = { "cc", "gcc", "clang", "zig cc" },
    },
    lsp = {
        enabled = true,
        cmd = nil,
        root_markers = { ".orbital", "orb.json", "package.json", ".git" },
    },
    cmd = nil,
}

---@type almadar.Config
M.options = vim.deepcopy(defaults)

---@param opts table|nil
function M.setup(opts)
    M.options = vim.tbl_deep_extend("force", vim.deepcopy(defaults), opts or {})
    return M.options
end

--- Plugin root — the directory containing `lua/`, `queries/`, `syntax/`.
---@return string
function M.plugin_root()
    local source = debug.getinfo(1, "S").source:sub(2)
    -- <root>/lua/almadar/config.lua -> <root>
    return vim.fs.normalize(vim.fs.dirname(vim.fs.dirname(vim.fs.dirname(source))))
end

return M
