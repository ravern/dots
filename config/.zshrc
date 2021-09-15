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
export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=$PATH:$ANDROID_HOME/emulator
export PATH=$PATH:$ANDROID_HOME/tools
export PATH=$PATH:$ANDROID_HOME/tools/bin
export PATH=$PATH:$ANDROID_HOME/platform-tools
export PATH=$HOME/.cabal/bin:$PATH
export PATH=$HOME/.volta/bin:$PATH
export PATH=$HOME/.local/share/solana/bin:$PATH
export VOLTA_HOME="$HOME/.volta"
unset _VOLTA_TOOL_RECURSION # Temporary fix for Volta + React Native issue (https://github.com/volta-cli/volta/issues/1007)

# Prompt and utilities
eval "$(pazi init zsh)"
eval "$(starship init zsh)"
