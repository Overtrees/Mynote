#!/usr/bin/env bash
# Mynote Rust 全量回归：一键跑 单元测试 + 构建 + 全部页面冒烟。
# 用法：bash run_all_tests.sh [--live]   (--live 打线上地址，只跑冒烟)
set -u
cd "$(dirname "$0")"
export PATH="$HOME/.cargo/bin:$PATH"
FAIL=0
step() { echo; echo "######## $1"; }

if [ "${1:-}" != "--live" ]; then
  step "cargo test (core + storage)"
  (cd rust && TMPDIR=$HOME/.tmp cargo test 2>&1 | tail -3) || FAIL=1
  step "build web"
  bash rust/apps/web/build.sh >/dev/null 2>&1 || { echo "BUILD FAILED"; exit 1; }
  python3 ~/workspace/mynote-ab/tools/serve_headers.py rust/apps/web/dist 8096 >/tmp/mynote-serve.log 2>&1 &
  SERVE_PID=$!
  trap 'kill $SERVE_PID 2>/dev/null' EXIT
  sleep 1
  BASE="http://localhost:8096/"
else
  BASE="https://mynote-rustweb.pages.dev/"
fi

for t in smoke-rustweb smoke-rustweb-w2 smoke-rustweb-w3 smoke-rustweb-i18n \
         smoke-rustweb-settings smoke-rustweb-list smoke-rustweb-editor2 smoke-rustweb-misc \
         smoke-rustweb-visual smoke-rustweb-highlight smoke-rustweb-blocks smoke-rustweb-tails smoke-rustweb-wiki smoke-rustweb-gaps; do
  step "$t"
  if node "$t.mjs" "$BASE" > "/tmp/$t.out" 2>&1; then
    grep -E "^✗" "/tmp/$t.out" && FAIL=1
    grep -qE "ERRORS: none" "/tmp/$t.out" || { echo "($t 未输出 ERRORS: none)"; }
    tail -2 "/tmp/$t.out"
    echo "PASS $t"
  else
    tail -5 "/tmp/$t.out"
    echo "FAIL $t"
    FAIL=1
  fi
done

echo
if [ $FAIL -eq 0 ]; then echo "ALL GREEN"; else echo "SOME SUITES FAILED"; exit 1; fi
