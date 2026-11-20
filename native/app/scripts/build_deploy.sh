#!/usr/bin/env bash
# Mynote Flutter 流水线：分析 → 测试 → 构建 Web →（可选）部署 Cloudflare Pages。
# 用法：bash scripts/build_deploy.sh [--deploy]
# 部署需要环境变量 CLOUDFLARE_API_TOKEN 与 CLOUDFLARE_ACCOUNT_ID（勿写入仓库）。
set -euo pipefail
cd "$(dirname "$0")/.."

FLUTTER="${FLUTTER:-flutter}"
echo "== dart analyze =="
"$FLUTTER" analyze --no-fatal-infos --no-fatal-warnings lib/ test/
echo "== flutter test =="
"$FLUTTER" test
echo "== flutter build web =="
"$FLUTTER" build web --release --wasm --no-web-resources-cdn
rm -f build/web/*.symbols
# 包体修剪：golden_toolkit 是传递依赖（测试用），其 Roboto 字体被误打进
# release 并被首屏下载——删其包资源并同步 FontManifest（应用自带 Roboto）。
rm -rf build/web/assets/packages/golden_toolkit
python3 - <<'PYEOF'
import json, os
p = 'build/web/assets/FontManifest.json'
if os.path.exists(p):
    data = json.load(open(p))
    data = [e for e in data if 'golden_toolkit' not in json.dumps(e)]
    json.dump(data, open(p, 'w'))
PYEOF

# skwasm 多线程（用户 2026-11-19 裁决开启）：COOP/COEP 头让页面进入
# crossOriginIsolated，Flutter Web 自动切到 skwasm 多线程引擎。
# COEP 用 credentialless 而非 require-corp：跨域封面图/GSI 脚本无需 CORP
# 头也能加载（以无凭据模式放行），避免 require-corp 打断封面与登录脚本。
cat > build/web/_headers <<'HDRS'
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  Cross-Origin-Resource-Policy: same-origin
# P2：引擎/字体等带哈希或版本目录的静态资源长缓存（immutable），
# 部署换名即失效，不影响新版生效；入口与 version.json 不在此列
/*.wasm
  Cache-Control: public, max-age=31536000, immutable
/assets/fonts/*
  Cache-Control: public, max-age=31536000, immutable
/assets/assets/fonts/*
  Cache-Control: public, max-age=31536000, immutable
/icons/*
  Cache-Control: public, max-age=604800
/build_version.json
  Cache-Control: no-cache
HDRS

# D1：构建号（新版本检测的比对源；每次构建必变）
printf '{"build":"%s"}' "$(date -u +%Y%m%d%H%M%S)-$$" > build/web/build_version.json

if [[ "${1:-}" == "--deploy" ]]; then
  : "${CLOUDFLARE_API_TOKEN:?需要 CLOUDFLARE_API_TOKEN}"
  : "${CLOUDFLARE_ACCOUNT_ID:?需要 CLOUDFLARE_ACCOUNT_ID}"
  echo "== deploy to Cloudflare Pages (mynote-flutter) =="
  CI=true npx -y wrangler@4 pages deploy build/web \
    --project-name mynote-flutter --branch main --commit-dirty=true
fi
echo "DONE"
