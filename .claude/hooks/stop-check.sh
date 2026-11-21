#!/usr/bin/env bash
# Claude Code の Stop から呼ばれる。作業ツリーに変更があれば pnpm run check を実行し、
# 失敗したら終わらせずに、出力を Claude に返して直させる。
set -uo pipefail
input=$(cat)
root=${CLAUDE_PROJECT_DIR:-$(pwd)}
cd "$root"
# 変更がなければ検査しない。コミット済みの変更は pre-commit で検査済み。
[ -z "$(git status --porcelain)" ] && exit 0
# 一度止めた後の再停止では止めない。直せない失敗（ネットワークなど）で終われなくなるのを防ぐ。
if [ "$(jq -r '.stop_hook_active // false' <<<"$input")" = "true" ]; then
  echo '{"systemMessage":"pnpm run check が失敗したまま終了しました"}'
  exit 0
fi
if output=$(pnpm run check 2>&1); then
  exit 0
fi
jq -n --arg out "$(tail -n 60 <<<"$output")" \
  '{decision: "block", reason: ("pnpm run check が失敗しました。直してから終えてください。\n" + $out)}'
