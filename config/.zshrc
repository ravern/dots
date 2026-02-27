# OPENSPEC:START
# OpenSpec shell completions configuration
fpath=("/Users/ravern/.zsh/completions" $fpath)
autoload -Uz compinit
compinit
# OPENSPEC:END

# Plugins
source $HOME/.local/zsh/plugins/zsh-autosuggestions/zsh-autosuggestions.zsh
source $HOME/.local/zsh/plugins/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh

# Completions
autoload -Uz compinit
compinit -u
[ -s "/Users/ravern/.bun/_bun" ] && source "/Users/ravern/.bun/_bun"
export FPATH=$HOME/.local/zsh/plugins/zsh-completions/src:$FPATH
export FPATH=$(brew --prefix)/share/zsh-completions:$FPATH

# Prompt and utilities
eval "$(pazi init zsh)"
eval "$(starship init zsh)"

# Shortcuts and aliases
alias gst="git status"
alias ga="git add"
alias gaa="git add -A"
alias gc="git commit"
alias gcnv="git commit --no-verify"
alias gcm="git commit -m"
alias gcmnv="git commit --no-verify -m"
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
alias grbc="git rebase --continue"
alias grs="git reset"
alias grsh="git reset --hard"
alias gr="git remote"
alias grv="git remote -v"
alias gb="git branch"
alias gbv="git branch -v"
alias gbd="git branch -d"
alias gsh="git stash"
alias gshp="git stash pop"
alias gshl="git stash list"
alias lsl="ls -lh"
alias lsa="ls -ah"
alias lsal="ls -alh"
mkcd() { mkdir -p "$1" && cd "$1" }
pyact() {
  local candidates=(".venv" "venv" "env" "virtualenv")
  for d in $candidates; do
    if [ -f "$d/bin/activate" ]; then
      source "$d/bin/activate"
      echo "activated virtual environment from $d/bin/activate"
      return 0
    elif [ -f "$d/Scripts/activate" ]; then
      source "$d/Scripts/activate"
      echo "activated virtual environment from $d/Scripts/activate"
      return 0
    fi
  done
  local joined=$(printf ", %s" "${candidates[@]}")
  echo "no virtual environment found in ${joined#, }"
  return 1
}
gi() { curl -sLw "\n" https://www.toptal.com/developers/gitignore/api/$@ }
