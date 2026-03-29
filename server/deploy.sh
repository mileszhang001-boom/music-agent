#!/bin/bash
# 服务端部署脚本 — 只更新代码，不碰数据
#
# 用法:
#   SSHPASS=密码 ./server/deploy.sh          # 密码登录
#   ./server/deploy.sh                       # SSH 密钥登录
#
# 安全规则:
# ✅ 更新: podcast-api.js, relay.js, ecosystem.config.cjs
# ❌ 不碰: podcast-store.json, audio/*, 环境变量

set -e

SERVER="root@47.94.241.139"
REMOTE_DIR="/opt/relay"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# SSH/SCP 封装（自动判断密码/密钥登录）
run_ssh() { if [ -n "$SSHPASS" ]; then sshpass -e ssh "$@"; else ssh "$@"; fi; }
run_scp() { if [ -n "$SSHPASS" ]; then sshpass -e scp "$@"; else scp "$@"; fi; }

echo "==============================="
echo "  服务端部署（仅更新代码）"
echo "==============================="
echo ""

# ── 1. 备份远程 store ──
echo "[1/4] 备份 podcast-store.json..."
run_ssh $SERVER "cp $REMOTE_DIR/podcast-store.json $REMOTE_DIR/podcast-store.json.bak.\$(date +%Y%m%d_%H%M%S) 2>/dev/null; echo '  已备份'"

# ── 2. 上传代码文件 ──
echo "[2/4] 上传代码..."
run_scp "$SCRIPT_DIR/relay.js" "$SERVER:$REMOTE_DIR/relay.js"
run_scp "$SCRIPT_DIR/podcast-api.js" "$SERVER:$REMOTE_DIR/podcast-api.js"
echo "  relay.js + podcast-api.js 已上传"

# ── 3. 重启服务 ──
echo "[3/4] 重启服务..."
run_ssh $SERVER "cd $REMOTE_DIR && pm2 restart all --update-env && pm2 save" 2>&1 | grep -E "│|✓"

# ── 4. 验证 ──
echo "[4/4] 验证..."
run_ssh $SERVER "echo \"  Store: \$(cat $REMOTE_DIR/podcast-store.json | grep -c '\"id\"') podcasts\" && echo \"  Audio: \$(ls $REMOTE_DIR/audio/*.mp3 2>/dev/null | wc -l) files\""

echo ""
echo "✅ 部署完成（数据未被修改）"
