# Plugins
source $HOME/.local/zsh/plugins/zsh-autosuggestions/zsh-autosuggestions.zsh
source $HOME/.local/zsh/plugins/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh

# Completions
autoload -Uz compinit
compinit -u

# Exports
export LANG=en_US.UTF-8
export TERM=xterm-256color
export HOMEBREW_NO_AUTO_UPDATE=1
export FPATH=$HOME/.local/zsh/plugins/zsh-completions/src:$FPATH
export FPATH=$(brew --prefix)/share/zsh-completions:$FPATH
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
export PATH=$HOME/.local/bin:$PATH
export PATH=$HOME/.volta/bin:$PATH
export PATH=$HOME/.cabal/bin:$PATH
export PATH=$HOME/.zig/bin:$PATH
export PATH=$HOME/.go/bin:$PATH
export LIBRARY_PATH=$LIBRARY_PATH:/opt/homebrew/lib
export INCLUDE_PATH=$INCLUDE_PATH:/opt/homebrew/include

# Environments
source $HOME/.cargo/env
eval "$(/opt/homebrew/bin/brew shellenv)"
eval "$(rbenv init - zsh)"
eval "$(opam env)"

# Prompt and utilities
eval "$(pazi init zsh)"
eval "$(starship init zsh)"

# Shortcuts and aliases
alias gst="git status"
alias ga="git add"
alias gaa="git add -A"
alias gc="git commit"
alias gcm="git commit -m"
alias gca="git commit --amend"
alias gcam="git commit --amend -m"
alias gcan="git commit --amend --no-edit"
alias gf="git fetch"
alias gdf="git diff"
alias gp="git push"
alias gpf="git push -f"
alias gpl="git pull"
alias gplr="git pull --rebase"
alias glg="git log"
alias glgo="git log --oneline"
alias gco="git checkout"
alias gcob="git checkout -b"
alias grb="git rebase"
alias grbi="git rebase -i"
alias grs="git reset"
alias grsh="git reset --hard"
alias gr="git remote"
alias grv="git remote -v"
alias gb="git branch"
alias gbv="git branch -v"
alias gbd="git branch -d"
alias lsl="ls -lh"
alias lsa="ls -ah"
alias lsal="ls -alh"
mkcd() { mkdir -p "$1" && cd "$1" }
