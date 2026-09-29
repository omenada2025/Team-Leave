#!/usr/bin/env bash
# Copy editable source from src/ into dist/ for GitHub Pages.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$root/dist"
cp -f "$root/src/index.html" "$root/src/app.mjs" "$root/src/auth-url.mjs" "$root/src/logic.mjs" "$root/src/styles.css" "$root/src/login.css" "$root/dist/"
echo "Built dist/ from src/"
