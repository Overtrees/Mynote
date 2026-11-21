#!/usr/bin/env bash
# Rust Web 构建：cargo release → wasm-bindgen → dist（壳 +
# 语言包）。部署：deploy_api.py dist mynote-rustweb
set -euo pipefail
export PATH="$HOME/.cargo/bin:$PATH"
WEB_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$WEB_DIR/../.."
cargo build -p mynote-web --target wasm32-unknown-unknown --release
cd "$WEB_DIR"
rm -rf dist
wasm-bindgen --target web --out-dir dist --out-name mynote-web ../../target/wasm32-unknown-unknown/release/mynote-web.wasm
cp index.html dist/index.html
cp manifest.json dist/manifest.json
cp Mynoteicon.png dist/Mynoteicon.png
cp -r lang dist/lang
VER=$(md5sum dist/mynote-web_bg.wasm | cut -c1-10)
sed "s/__VERSION__/$VER/" sw.js > dist/sw.js
echo "dist ready: $(du -sh dist | cut -f1) (wasm $(stat -c%s dist/mynote-web_bg.wasm) B)"
