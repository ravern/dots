# Plugins
source $HOME/.local/zsh/plugins/zsh-autosuggestions/zsh-autosuggestions.zsh
source $HOME/.local/zsh/plugins/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh
export fpath=($HOME/.local/zsh/plugins/zsh-completions/zsh-completions/src $fpath)

# Environments
source $HOME/.cargo/env
eval "$(/opt/homebrew/bin/brew shellenv)"
eval "$(rbenv init - zsh)"
eval "$(opam env)"

# Exports
export LANG=en_US.UTF-8
export TERM=xterm-256color
export HOMEBREW_NO_AUTO_UPDATE=1
export GOPATH=$HOME/.go
export DOTS_PATH=$HOME/Repos/ravern/dots
export PNPM_HOME=$HOME/Library/pnpm
export ANDROID_HOME=$HOME/Library/Android/sdk
export VOLTA_HOME=$HOME/.volta
export PATH=/opt/homebrew/bin:$PATH
export PATH=$PATH:$ANDROID_HOME/emulator
export PATH=$PATH:$ANDROID_HOME/tools
export PATH=$PATH:$ANDROID_HOME/tools/bin
export PATH=$PATH:$ANDROID_HOME/platform-tools
export PATH=$PNPM_HOME:$PATH
export PATH=$PATH:/opt/homebrew/opt/openjdk@17/bin
export PATH=$PATH:/Library/TeX/texbin
export PATH=$PATH:$HOME/.dotnet/tools
export PATH=$HOME/.volta/bin:$PATH
export PATH=$HOME/.cabal/bin:$PATH
export PATH=$HOME/.zig/bin:$PATH
export PATH=$HOME/.go/bin:$PATH
export LIBRARY_PATH=$LIBRARY_PATH:/opt/homebrew/lib
export INCLUDE_PATH=$INCLUDE_PATH:/opt/homebrew/include

# Prompt and utilities
eval "$(pazi init zsh)"
eval "$(starship init zsh)"
