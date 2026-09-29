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
for p in customize-model-names provider-devin-cloud; do
  (cd $DIR/plugins/$p && npm ci --silent && bb plugin build)
  bb plugin install path:$DIR/plugins/$p --yes
done


# Disabled plugins
for p in account-pool agent-annotations monaco-editor plugin-api-docs plugin-api-tester provider-pi workflows; do
  bb plugin disable $p
done

# Plugin settings
bb plugin config customize-model-names set visibleModels '{"codex":["GPT-6*"]}'
