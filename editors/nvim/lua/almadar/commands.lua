--- `:Orb*` commands — thin wrappers over the `orb` CLI.
local config = require("almadar.config")

local M = {}

--- Resolve the `orb` binary.
---@return string|nil bin, string|nil err
local function orb_bin()
    local configured = config.options.cmd
    if configured then
        return configured
    end
    if vim.fn.executable("orb") == 1 then
        return "orb"
    end
    return nil, "`orb` not found on $PATH (install @almadar/orb)"
end

---@param bufnr integer
---@return string|nil path, string|nil err
local function buffer_file(bufnr)
    local name = vim.api.nvim_buf_get_name(bufnr)
    if name == "" then
        return nil, "buffer has no file on disk"
    end
    if vim.bo[bufnr].modified then
        return nil, "buffer has unsaved changes — write it first"
    end
    return name
end

---@param argv string[]
---@param on_done fun(result: vim.SystemCompleted)
local function run(argv, on_done)
    vim.system(argv, { text = true }, vim.schedule_wrap(on_done))
end

--- Open text in a scratch buffer in a split.
---@param lines string[]
---@param filetype string
---@param title string
local function scratch(lines, filetype, title)
    vim.cmd("botright vsplit")
    local buf = vim.api.nvim_create_buf(false, true)
    vim.api.nvim_win_set_buf(0, buf)
    vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
    vim.bo[buf].filetype = filetype
    vim.bo[buf].buftype = "nofile"
    vim.bo[buf].modifiable = false
    vim.api.nvim_buf_set_name(buf, title)
end

---@class almadar.ValidateItem
---@field code string
---@field path string
---@field message string
---@field suggestion string|nil
---@field line integer|nil
---@field column integer|nil

--- `<input>:LINE:COL` — the locator lolo parse errors carry in `path`.
local LOLO_SOURCE_POS = "^<input>:(%d+):(%d+)$"

---@param item almadar.ValidateItem
---@return integer lnum, integer col
local function item_position(item)
    if type(item.line) == "number" then
        return item.line, type(item.column) == "number" and item.column or 1
    end
    local line, col = tostring(item.path or ""):match(LOLO_SOURCE_POS)
    if line then
        return tonumber(line), tonumber(col)
    end
    -- Semantic errors carry a JSON path into the lowered .orb, which has no
    -- position in the .lolo source; anchor them at the top of the file.
    return 1, 1
end

--- Run `orb validate --json` and load the result into the quickfix list.
---@param bufnr integer
function M.validate(bufnr)
    local bin, bin_err = orb_bin()
    if not bin then
        return vim.notify(bin_err, vim.log.levels.ERROR, { title = "orb" })
    end
    local file, file_err = buffer_file(bufnr)
    if not file then
        return vim.notify(file_err, vim.log.levels.WARN, { title = "orb" })
    end

    run({ bin, "validate", "--json", file }, function(result)
        local ok, decoded = pcall(vim.json.decode, result.stdout or "")
        if not ok or type(decoded) ~= "table" then
            local detail = (result.stderr ~= "" and result.stderr) or result.stdout or "no output"
            return vim.notify("orb validate failed:\n" .. detail, vim.log.levels.ERROR, { title = "orb" })
        end

        local items = {}
        for _, group in ipairs({ { decoded.errors, "E" }, { decoded.warnings, "W" } }) do
            for _, item in ipairs(group[1] or {}) do
                local lnum, col = item_position(item)
                local text = ("[%s] %s"):format(item.code or "?", item.message or "")
                if item.suggestion then
                    text = text .. "  💡 " .. item.suggestion
                end
                if item.path and not tostring(item.path):match(LOLO_SOURCE_POS) then
                    text = text .. "  (" .. item.path .. ")"
                end
                table.insert(items, {
                    filename = file, lnum = lnum, col = col, type = group[2], text = text,
                })
            end
        end

        vim.fn.setqflist({}, " ", { title = "orb validate: " .. vim.fs.basename(file), items = items })
        if #items == 0 then
            vim.notify("orb validate: clean ✓", vim.log.levels.INFO, { title = "orb" })
        else
            vim.cmd("copen")
            vim.notify(("orb validate: %d issue(s)"):format(#items), vim.log.levels.WARN, { title = "orb" })
        end
    end)
end

--- `orb emit <target>` into a scratch buffer.
---@param bufnr integer
---@param target string
function M.emit(bufnr, target)
    local bin, bin_err = orb_bin()
    if not bin then
        return vim.notify(bin_err, vim.log.levels.ERROR, { title = "orb" })
    end
    local file, file_err = buffer_file(bufnr)
    if not file then
        return vim.notify(file_err, vim.log.levels.WARN, { title = "orb" })
    end

    run({ bin, "emit", target, file }, function(result)
        if result.code ~= 0 then
            local detail = (result.stderr ~= "" and result.stderr) or result.stdout or "no output"
            return vim.notify("orb emit failed:\n" .. detail, vim.log.levels.ERROR, { title = "orb" })
        end
        local ft = ({ orb = "orb", ts = "typescript", typescript = "typescript", python = "python" })[target]
        scratch(vim.split(result.stdout or "", "\n"), ft or "text",
            ("orb emit %s: %s"):format(target, vim.fs.basename(file)))
    end)
end

--- Long-running subcommands (`verify`, `serve`, `test`) run in a terminal
--- split so their streaming output stays visible.
---@param subcommand string
---@param args string[]
---@param bufnr integer
function M.terminal(subcommand, args, bufnr)
    local bin, bin_err = orb_bin()
    if not bin then
        return vim.notify(bin_err, vim.log.levels.ERROR, { title = "orb" })
    end
    local argv = { bin, subcommand }
    local file = vim.api.nvim_buf_get_name(bufnr)
    if #args == 0 and file ~= "" then
        table.insert(argv, file)
    else
        vim.list_extend(argv, args)
    end
    vim.cmd("botright split | resize 18")
    vim.fn.jobstart(argv, { term = true })
    vim.cmd("startinsert")
end

--- `orb format` the current buffer in place, then reload it.
---@param bufnr integer
function M.format(bufnr)
    local bin, bin_err = orb_bin()
    if not bin then
        return vim.notify(bin_err, vim.log.levels.ERROR, { title = "orb" })
    end
    local file, file_err = buffer_file(bufnr)
    if not file then
        return vim.notify(file_err, vim.log.levels.WARN, { title = "orb" })
    end
    run({ bin, "format", file }, function(result)
        if result.code ~= 0 then
            local detail = (result.stderr ~= "" and result.stderr) or result.stdout or "no output"
            return vim.notify("orb format failed:\n" .. detail, vim.log.levels.ERROR, { title = "orb" })
        end
        vim.cmd("checktime")
    end)
end

--- Register every `:Orb*` command. Idempotent.
function M.setup()
    local function current()
        return vim.api.nvim_get_current_buf()
    end

    vim.api.nvim_create_user_command("OrbValidate", function()
        M.validate(current())
    end, { desc = "orb validate the current buffer into the quickfix list" })

    vim.api.nvim_create_user_command("OrbEmit", function(opts)
        M.emit(current(), opts.args ~= "" and opts.args or "orb")
    end, {
        nargs = "?",
        desc = "orb emit the current buffer into a scratch split",
        complete = function()
            return { "orb", "ts", "python" }
        end,
    })

    vim.api.nvim_create_user_command("OrbVerify", function(opts)
        M.terminal("verify", opts.fargs, current())
    end, { nargs = "*", desc = "orb verify (terminal split)" })

    vim.api.nvim_create_user_command("OrbServe", function(opts)
        M.terminal("serve", opts.fargs, current())
    end, { nargs = "*", desc = "orb serve (terminal split)" })

    vim.api.nvim_create_user_command("OrbSignatures", function()
        M.terminal("signatures", { "--" }, current())
    end, { desc = "orb signatures (terminal split)" })

    vim.api.nvim_create_user_command("OrbFormat", function()
        M.format(current())
    end, { desc = "orb format the current buffer" })

    vim.api.nvim_create_user_command("OrbPreview", function()
        require("almadar.lsp").preview_url(current(), function(url, err)
            if not url then
                return vim.notify(err or "no preview URL", vim.log.levels.WARN, { title = "orb" })
            end
            vim.ui.open(url)
            vim.notify("preview: " .. url, vim.log.levels.INFO, { title = "orb" })
        end)
    end, { desc = "Open the orb-lsp live preview in a browser" })

    vim.api.nvim_create_user_command("OrbBuildParser", function()
        local path, err = require("almadar.treesitter").build({ force = true })
        if not path then
            return vim.notify(err or "parser build failed", vim.log.levels.ERROR, { title = "orb" })
        end
        vim.notify("built " .. path, vim.log.levels.INFO, { title = "orb" })
    end, { desc = "Rebuild the bundled tree-sitter-lolo parser" })
end

return M
