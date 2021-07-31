vim.api.nvim_set_keymap('n', '<space>', '<nop>',  { noremap = true })
vim.g.mapleader = ' '

vim.api.nvim_command('filetype plugin off')
vim.api.nvim_command('colorscheme monotone')

vim.o.hlsearch       = false
vim.o.number         = true
vim.o.relativenumber = true
vim.o.expandtab      = true
vim.o.tabstop        = 2
vim.o.shiftwidth     = 2
