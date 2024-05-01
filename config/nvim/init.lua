---------------------------
---- Global settings ------
---------------------------

vim.opt.timeout = false
vim.opt.encoding = "utf-8"
vim.opt.number = true
vim.opt.relativenumber = true
vim.opt.tabstop = 2
vim.opt.shiftwidth = 2
vim.opt.expandtab = true
vim.opt.colorcolumn = "80"
vim.opt.termguicolors = true
vim.g.mapleader = " "

---------------------------
--------- Plugins ---------
---------------------------

local plugins = {
  {
    "nvim-treesitter/nvim-treesitter",
    build = ":TSUpdate"
  },
  {
    "VonHeikemen/lsp-zero.nvim",
    branch = "v3.x",
    dependencies = {
      { "neovim/nvim-lspconfig" },
      {
        "hrsh7th/cmp-nvim-lsp",
        dependencies = {
          {
            "hrsh7th/nvim-cmp",
            config = function()
              local cmp = require("cmp")
              cmp.setup({
                mapping = cmp.mapping.preset.insert({
                  ["<cr>"] = cmp.mapping.confirm({ select = true }),
                  ["<C-space>"] = cmp.mapping.complete(),
                  ["<C-u>"] = cmp.mapping.scroll_docs(-4),
                  ["<C-d>"] = cmp.mapping.scroll_docs(4),
                  ["<C-c>"] = cmp.mapping.abort(),
                }),
              })
            end,
          },
        },
      },
      { "L3MON4D3/LuaSnip" },
      {
        "williamboman/mason.nvim",
        dependencies = { "williamboman/mason-lspconfig.nvim" },
      },
    },
    config = function()
      local lsp_zero = require("lsp-zero")
      lsp_zero.on_attach(function(client, bufnr)
        lsp_zero.default_keymaps({ buffer = bufnr })
      end)
      lsp_zero.format_on_save({
        format_opts = {
          async = false,
          timeout_ms = 5000,
        },
        servers = {
          ["rust_analyzer"] = { "rust" },
          ["tsserver"] = { "javascript", "typescript" },
        },
      })
      require("mason").setup({})
      require("mason-lspconfig").setup({
        ensure_installed = {
          "rust_analyzer",
          "tsserver",
        },
        handlers = {
          function(server_name)
            require("lspconfig")[server_name].setup({})
          end,
        },
      })
    end,
  },
  {
    "nvim-lua/telescope.nvim",
    tag = "0.1.6",
    dependencies = { "nvim-lua/plenary.nvim" },
    config = function()
      local builtin = require("telescope.builtin")
      vim.keymap.set("n", "<leader>ff", builtin.find_files, {})
      vim.keymap.set("n", "<leader>fg", builtin.live_grep, {})
      vim.keymap.set("n", "<leader>fb", builtin.buffers, {})
      vim.keymap.set("n", "<leader>fh", builtin.help_tags, {})
    end,
  },
  {
    "smoka7/multicursors.nvim",
    event = "VeryLazy",
    dependencies = {
      "smoka7/hydra.nvim",
    },
    opts = {},
    cmd = {
      "MCstart",
      "MCvisual",
      "MCclear",
      "MCpattern",
      "MCvisualPattern",
      "MCunderCursor",
    },
    keys = {
      {
        mode = { "v", "n" },
        "<Leader>m",
        "<cmd>MCunderCursor<cr>",
      },
    },
    config = function()
      require('multicursors').setup({
        hint_config = false,
      })
    end,
  },
  {
    "nvim-lualine/lualine.nvim",
    config = function()
      local function is_active()
        local ok, hydra = pcall(require, 'hydra.statusline')
        return ok and hydra.is_active()
      end
      local function get_name()
        local ok, hydra = pcall(require, 'hydra.statusline')
        if ok then
          return hydra.get_name()
        end
        return ''
      end
      require("lualine").setup({
        options = {
          section_separators = "",
          component_separators = "",
        },
        sections = {
          lualine_a = {
            "mode",
            { get_name, cond = is_active },
          },
          lualine_b = {
            "branch",
            {
              "diff",
              symbols = {
                added = "+",
                modified = "~",
                removed = "-",
              },
            },
          },
          lualine_c = {
            {
              "diagnostics",
              symbols = {
                error = "E",
                warn = "W",
                info = "I",
                hint = "H",
              },
            },
          },
          lualine_x = {
            "encoding",
            {
              "fileformat",
              symbols = {
                unix = "unix",
                dos = "dos",
                mac = "mac",
              },
            },
            "filetype",
          },
        },
      })
    end
  },
  {
    "lukas-reineke/virt-column.nvim",
    config = function()
      require("virt-column").setup()
    end,
  },
  {
    "projekt0n/github-nvim-theme",
    lazy = false,
    priority = 1000,
    config = function()
      require("github-theme").setup({})
      vim.cmd("colorscheme github_dark_high_contrast")
    end,
  },
}

-- lazy.nvim
local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"
if not (vim.uv or vim.loop).fs_stat(lazypath) then
  vim.fn.system({
    "git",
    "clone",
    "--filter=blob:none",
    "https://github.com/folke/lazy.nvim.git",
    "--branch=stable",
    lazypath,
  })
end
vim.opt.rtp:prepend(lazypath)
require("lazy").setup(plugins)
