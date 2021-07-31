source $HOME/.local/zsh/plugins/zsh-autosuggestions/zsh-autosuggestions.zsh
source $HOME/.local/zsh/plugins/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh

export DOTS_PATH=$HOME/Repos/ravern/dots

export PATH=$HOME/.volta/bin:$PATH

source "$HOME/.cargo/env"
eval "$(starship init zsh)"
