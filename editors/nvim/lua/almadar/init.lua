--- Almadar language support for Neovim: `.lolo` and `.orb`.
---
--- Nothing here is required for the plugin to work — filetype detection,
--- highlighting, indentation and the `:Orb*` commands are wired from
--- `plugin/almadar.lua` with the defaults in `almadar.config`. Call `setup()`
--- only to change those defaults.
---
--- ```lua
--- require("almadar").setup({
---   lsp = { enabled = false },                 -- no diagnostics
---   treesitter = { auto_install = false },     -- never invoke a C compiler
--- })
--- ```
local config = require("almadar.config")

local M = {}

---@param opts table|nil
function M.setup(opts)
    config.setup(opts)
    return M
end

setmetatable(M, {
    __index = function(_, key)
        if key == "options" then
            return config.options
        end
        return nil
    end,
})

return M
