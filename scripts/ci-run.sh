#!/usr/bin/env bash
# Выполнить шаг CI и, если он упал, показать причину прямо на странице прогона.
#
# Логи GitHub Actions видны только после входа в учётную запись. Когда прогон
# смотрит кто-то без доступа — а это и посторонний, и любой инструмент, — на
# странице остаётся одно «Process completed with exit code 1», по которому
# нельзя понять ровно ничего. Причина при этом лежит в двадцати строках вывода.
#
# Пометки (::error::) отображаются на странице прогона всем, поэтому хвост
# вывода упавшей команды уходит туда.
#
#   scripts/ci-run.sh "Сборка" npm run build
set -uo pipefail

title="$1"
shift

log="$(mktemp)"
"$@" 2>&1 | tee "$log"
status="${PIPESTATUS[0]}"

# Пометка вмещает около четырёх тысяч знаков, а причина падения почти никогда
# не лежит в самом конце: у Playwright и vitest в конце список названий, а
# сообщение об ошибке — выше. Поэтому пометок две: начало первой ошибки и хвост.
annotate() {
  # Перевод строки кодируется как %0A, процент — как %25.
  sed -e 's/%/%25/g' \
    | awk '{ printf "%s%%0A", $0 }' \
    | { read -r body; [ -n "$body" ] && echo "::error title=$1::${body:0:3500}"; }
}

if [ "$status" -ne 0 ]; then
  first="$(grep -nE '^\s*(Error|AssertionError|[0-9]+\)|✘|×|FAIL|error TS|Timed out)' "$log" | head -1 | cut -d: -f1)"
  if [ -n "$first" ]; then
    start=$(( first > 3 ? first - 3 : 1 ))
    sed -n "${start},$((start + 45))p" "$log" | annotate "${title}: первая ошибка"
  fi
  tail -c 2500 "$log" | annotate "${title}: конец вывода"
fi

exit "$status"
