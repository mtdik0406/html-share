#!/usr/bin/env bash
# Claude Code の PostToolUse（Write|Edit）から呼ばれる。編集したファイルを Biome で整える。
# リポジトリの外のファイル（エージェントのメモリなど）には触れない。
set -euo pipefail
file=$(jq -r '.tool_input.file_path // .tool_response.filePath // empty')
root=${CLAUDE_PROJECT_DIR:-$(pwd)}
case "$file" in
  "$root"/*) ;;
  *) exit 0 ;;
esac
cd "$root"
# Biome が扱わない種類のファイルや、.gitignore の対象は黙って飛ばす。
pnpm exec biome check --write --files-ignore-unknown=true --no-errors-on-unmatched "$file" >/dev/null
