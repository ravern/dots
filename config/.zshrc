# Plugins
source $HOME/.local/zsh/plugins/zsh-autosuggestions/zsh-autosuggestions.zsh
source $HOME/.local/zsh/plugins/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh
export fpath=($HOME/.local/zsh/plugins/zsh-completions/zsh-completions/src $fpath)

# Environments
source $HOME/.cargo/env

# Exports
export LANG=en_US.UTF-8
export TERM=xterm-256color
export DOTS_PATH=$HOME/Repos/ravern/dots
export PATH=$HOME/.volta/bin:$PATH

# Prompt and utilities
eval "$(pazi init zsh)"
eval "$(starship init zsh)"
