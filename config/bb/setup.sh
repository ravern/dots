#!/bin/sh
# bb has no declarative config: plugin installs, toggles, and settings live in
# ~/.bb/bb.db. This script replays them. Safe to rerun.
set -e

DIR=$HOME/Repos/ravern/dots/config/bb

if ! bb status >/dev/null 2>&1; then
  echo "bb is not running; open bb, then rerun $DIR/setup.sh"
  exit 0
fi

# Local plugins
for p in customize-model-names provider-devin-cloud provider-plugin-manager; do
  (cd $DIR/plugins/$p && npm ci --silent && bb plugin build)
  bb plugin install path:$DIR/plugins/$p --yes
done


# Disabled plugins
for p in account-pool agent-annotations monaco-editor plugin-api-docs plugin-api-tester workflows; do
  bb plugin disable $p
done

# Model picker provider order
bb settings general providerOrder '["codex","claude-code","acp-cursor","antigravity","devin-cloud"]'

# Plugin settings
bb plugin config customize-model-names set visibleModels '{"claude-code":["Opus 5.5","Fable 5.1"],"codex":["GPT-6*"],"acp-cursor":["Grok 4.7"],"devin-cloud":["SWE-2*","Fusion"]}'
bb plugin config provider-claude-code set memoryEnabled false
bb plugin config provider-claude-code set subagentsDisabled true
bb plugin config provider-claude-code set workflowsDisabled true
