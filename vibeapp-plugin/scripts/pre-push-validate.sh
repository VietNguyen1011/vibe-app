#!/bin/bash
# PreToolUse hook: block a `git push` if app.yaml fails validation.
# Receives the tool input on $CLAUDE_TOOL_INPUT; plugin root on $CLAUDE_PLUGIN_ROOT.
if echo "$CLAUDE_TOOL_INPUT" | grep -q "git push"; then
  node "$CLAUDE_PLUGIN_ROOT/scripts/validate-manifest.mjs" app.yaml || exit 2
fi
exit 0
