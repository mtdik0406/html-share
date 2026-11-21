#!/usr/bin/env bash
# Claude Code の PostToolUse（Write|Edit）から呼ばれる。編集したファイルを Biome で整える。
# リポジトリの外のファイル（エージェントのメモリなど）には触れない。
set -euo pipefail
file=$(jq -r '.tool_input.file_path // .tool_response.filePath // empty')
[ -f "$file" ] || exit 0
root=$(cd "${CLAUDE_PROJECT_DIR:-$(pwd)}" && pwd -P)
# .. やシンボリックリンクを解いた実体の場所で判定する。文字列のままだと root/../x を中とみなしてしまう。
dir=$(cd "$(dirname "$file")" && pwd -P)
case "$dir/" in
  "$root"/*) ;;
  *) exit 0 ;;
esac
cd "$root"
pnpm exec biome check --write --files-ignore-unknown=true --no-errors-on-unmatched "$dir/$(basename "$file")" >/dev/null
