# Plugins
source $HOME/.local/zsh/plugins/zsh-autosuggestions/zsh-autosuggestions.zsh
source $HOME/.local/zsh/plugins/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh

# Environments
source $HOME/.cargo/env

# Exports
export LANG=en_US.UTF-8
export DOTS_PATH=$HOME/Repos/ravern/dots
export PATH=$HOME/.volta/bin:$PATH

# Prompt
eval "$(starship init zsh)"
