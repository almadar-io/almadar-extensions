--- `:checkhealth almadar`
local M = {}

local function check_binary()
    vim.health.start("orb CLI")
    local config = require("almadar.config")
    local bin = config.options.cmd or "orb"
    if vim.fn.executable(bin) ~= 1 then
        vim.health.warn(("`%s` not executable"):format(bin), {
            "Install the CLI: npm install -g @almadar/orb",
            "…or point `cmd` at it: require('almadar').setup({ cmd = '/path/to/orb' })",
        })
        return
    end
    local result = vim.system({ bin, "--version" }, { text = true }):wait()
    vim.health.ok(("`%s` — %s"):format(bin, vim.trim((result.stdout or "") .. (result.stderr or ""))))
end

local function check_treesitter()
    vim.health.start("tree-sitter")
    local ts = require("almadar.treesitter")

    local ok, err = ts.ensure("lolo")
    if ok then
        vim.health.ok("`lolo` parser loaded")
    else
        vim.health.warn("`lolo` parser unavailable: " .. tostring(err), {
            "Highlighting falls back to syntax/lolo.vim (regex), which is generated",
            "from the same token registry — less precise, still fully coloured.",
            "Run :OrbBuildParser to retry the build.",
        })
    end

    local orb_ok, orb_err = ts.ensure("orb")
    if orb_ok then
        vim.health.ok("`orb` parser loaded (JSON grammar aliased via symbol_name)")
    else
        vim.health.warn("`orb` parser unavailable: " .. tostring(orb_err), {
            "Install the JSON parser, e.g. `:TSInstall json`.",
        })
    end

    for lang, loaded in pairs({ lolo = ok, orb = orb_ok }) do
        if loaded then
            local query_ok, query_err = pcall(vim.treesitter.query.get, lang, "highlights")
            if query_ok then
                vim.health.ok(("`queries/%s/highlights.scm` compiles"):format(lang))
            else
                vim.health.error(("`queries/%s/highlights.scm` failed: %s"):format(lang, query_err))
            end
        end
    end
end

local function check_lsp()
    vim.health.start("orb-lsp")
    local config = require("almadar.config")
    if not config.options.lsp.enabled then
        vim.health.info("disabled via setup({ lsp = { enabled = false } })")
        return
    end
    local cmd, err = require("almadar.lsp").cmd()
    if not cmd then
        vim.health.warn("not startable: " .. tostring(err))
        return
    end
    vim.health.ok("command: " .. table.concat(cmd, " "))
    local clients = vim.lsp.get_clients({ name = "orb-lsp" })
    if #clients > 0 then
        vim.health.ok(("attached to %d buffer(s)"):format(
            vim.tbl_count(clients[1].attached_buffers or {})))
    else
        vim.health.info("not currently running (starts on the first .lolo/.orb buffer)")
    end
end

function M.check()
    check_binary()
    check_treesitter()
    check_lsp()
end

return M
