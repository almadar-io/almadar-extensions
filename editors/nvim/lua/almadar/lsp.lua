--- orb-lsp client wiring.
---
--- `orb-lsp` is the same stdio language server the VSCode and Zed extensions
--- use: it shells out to `orb validate --json` and maps the result back onto
--- the buffer. Started with core `vim.lsp.start` — no nvim-lspconfig needed.
local config = require("almadar.config")

local M = {}

local uv = vim.uv or vim.loop

--- Resolve the command that starts the language server.
---@return string[]|nil cmd, string|nil err
function M.cmd()
    local configured = config.options.lsp.cmd
    if configured then
        return configured
    end

    if vim.fn.executable("node") ~= 1 then
        return nil, "`node` not found on $PATH — needed to run orb-lsp"
    end

    -- editors/nvim/ -> the package root that also holds lsp/.
    local package_root = vim.fs.dirname(vim.fs.dirname(config.plugin_root()))
    local bundled = vim.fs.joinpath(package_root, "lsp", "bin", "orb-lsp.js")
    if uv.fs_stat(bundled) then
        return { "node", bundled, "--stdio" }
    end

    if vim.fn.executable("orb-lsp") == 1 then
        return { "orb-lsp", "--stdio" }
    end

    return nil, ("orb-lsp not found (looked for %s, and `orb-lsp` on $PATH)"):format(bundled)
end

---@param bufnr integer
---@return string
local function root_dir(bufnr)
    local name = vim.api.nvim_buf_get_name(bufnr)
    local start = name ~= "" and vim.fs.dirname(name) or uv.cwd()
    local found = vim.fs.find(config.options.lsp.root_markers, { path = start, upward = true })[1]
    return found and vim.fs.dirname(found) or start
end

--- Start (or reuse) the server for `bufnr`.
---@param bufnr integer
---@return integer|nil client_id, string|nil err
function M.start(bufnr)
    if not config.options.lsp.enabled then
        return nil
    end

    local cmd, err = M.cmd()
    if not cmd then
        return nil, err
    end

    return vim.lsp.start({
        name = "orb-lsp",
        cmd = cmd,
        root_dir = root_dir(bufnr),
    }, { bufnr = bufnr })
end

--- Ask the server for its live-preview URL.
---@param bufnr integer
---@param on_url fun(url: string|nil, err: string|nil)
function M.preview_url(bufnr, on_url)
    local clients = vim.lsp.get_clients({ bufnr = bufnr, name = "orb-lsp" })
    local client = clients[1]
    if not client then
        on_url(nil, "orb-lsp is not attached to this buffer")
        return
    end
    client:request("almadar/previewUrl", { uri = vim.uri_from_bufnr(bufnr) }, function(rpc_err, result)
        if rpc_err then
            on_url(nil, tostring(rpc_err.message or rpc_err))
        else
            on_url(result and result.url, result and result.url and nil or "no preview server running")
        end
    end, bufnr)
end

return M
