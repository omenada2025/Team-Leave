#!/usr/bin/env bash
set -euo pipefail
mkdir -p dist/server
node scripts/embed.mjs
