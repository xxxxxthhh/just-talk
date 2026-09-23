# Just Talk iOS 后端部署手册

本文只描述部署产物和操作步骤，不代表服务器已经部署。当前 VPS 尚未在雅加达与新山之间选定，所有尖括号占位符都必须在执行前替换。

## 占位符

| 占位符 | 需要替换为 |
| --- | --- |
| `<VPS_HOST>` | 最终选定的雅加达或新山 VPS 的 IP/SSH 主机名 |
| `<REPO_DIR>` | VPS 上的仓库绝对路径 |
| `<TAILNET_HOST>` | VPS 在 Tailscale 中的机器名 |
| `<TAILNET_NAME>` | tailnet DNS 名称中 `.ts.net` 前的部分 |
| `<DEVICE>` | `npx cap run ios --list` 显示的 iPhone target |
| `<PUBLIC_DOMAIN>` | 阶段 2 才需要、且已解析到 VPS 的公网域名 |

## 阶段划分

1. **阶段 0：本机验证。** 模拟器在 Mac 上运行 `./scripts/dev.sh`，使用 `http://127.0.0.1:8000`；真机与 Mac 在同一 Wi-Fi 时运行 `BACKEND_HOST=0.0.0.0 ./scripts/dev.sh`，使用 `http://<MAC_LAN_IP>:8000`。
2. **阶段 1：VPS + Tailscale。** 后端容器只发布到 VPS 的 `127.0.0.1:8000`，Tailscale Serve 在 tailnet 内提供 HTTPS。这是当前部署目标，不需要公网域名或 API token。
3. **阶段 2：可选公网 HTTPS。** 将来确认公网域名后，用 Caddy 监听 80/443，并先补齐后端 API token 鉴权。本阶段尚未实现，不可按当前代码直接开放公网。

## 阶段 1：VPS + Tailscale

### 1. 前置条件

- 先确定使用雅加达还是新山 VPS，并把仓库放到 `<REPO_DIR>`。
- VPS 安装 Docker Engine、Docker Compose plugin 和 Tailscale。安装命令随 VPS Linux 发行版而异，选定 VPS 后按对应系统的官方说明执行。
- 火山引擎安全组放行 **UDP 41641**，供 Tailscale 尝试直连。不要向公网放行 TCP 8000。

### 2. 配置后端环境变量

在仓库根目录执行：

```bash
cd <REPO_DIR>
cp .env.example deploy/.env
chmod 600 deploy/.env
```

编辑 `deploy/.env`，至少确认以下内容。所有 `<REPLACE_...>` 都必须替换；不使用 LLM 功能时可将三个 LLM 值留空。

```dotenv
AZURE_SPEECH_KEY=<REPLACE_WITH_AZURE_SPEECH_KEY>
AZURE_SPEECH_REGION=southeastasia
AZURE_TTS_VOICE=en-US-JennyNeural

DATABASE_URL=sqlite:///./data/just_talk.db
MAX_AUDIO_SECONDS=30
MAX_LONG_AUDIO_SECONDS=180
VOCABULARY_GRADUATION_SCORE=85
VOCABULARY_GRADUATION_STREAK=2

LLM_BASE_URL=<REPLACE_OR_LEAVE_EMPTY>
LLM_API_KEY=<REPLACE_OR_LEAVE_EMPTY>
LLM_MODEL=gpt-4o-mini

CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,capacitor://localhost
```

`AZURE_SPEECH_REGION` 建议使用离雅加达/新山较近的 `southeastasia`。`CORS_ORIGINS` 是逗号分隔值，必须包含 `capacitor://localhost`，否则 Capacitor App 的跨域请求会被拒绝。

### 3. 准备数据目录并启动后端

镜像固定以非特权 UID/GID `10001:10001` 运行。Compose 使用 bind mount；如果 `deploy/data` 不存在而由 Docker 创建，或该目录仍归 root 所有，容器会无法创建或写入 SQLite。首次启动前必须执行：

```bash
cd <REPO_DIR>
mkdir -p deploy/data && sudo chown -R 10001:10001 deploy/data
```

`10001:10001` 与 Dockerfile 中固定的应用用户 UID/GID 一致。完成目录赋权后再构建并启动：

```bash
cd <REPO_DIR>
docker compose -f deploy/docker-compose.yml up -d --build
docker compose -f deploy/docker-compose.yml ps
docker compose -f deploy/docker-compose.yml logs --tail=100 backend
```

Compose 只把容器端口映射到 `127.0.0.1:8000`。确认 VPS 本机能访问：

```bash
curl --fail-with-body --show-error http://127.0.0.1:8000/api/health
```

### 4. 接入 Tailscale

```bash
sudo tailscale up
sudo tailscale serve --bg 8000
sudo tailscale serve status
```

首次使用 Serve 时，Tailscale 可能要求在网页中启用 tailnet HTTPS。命令完成后会显示类似以下地址：

```text
https://<TAILNET_HOST>.<TAILNET_NAME>.ts.net
```

这不是公网入口，只有同一 tailnet 中且符合访问控制规则的设备可以访问。iPhone 安装 Tailscale 客户端并登录同一 tailnet。

### 5. 部署后验证

先在 VPS 上确认能出网访问 Azure 区域端点：

```bash
curl --show-error --connect-timeout 10 https://southeastasia.api.cognitive.microsoft.com/
```

该端点可能返回 401 或 404；只要 DNS、TCP 和 TLS 能成功建立，就证明基础出网链路可达。然后验证 Tailscale HTTPS 与 API health：

```bash
curl --fail-with-body --show-error \
  https://<TAILNET_HOST>.<TAILNET_NAME>.ts.net/api/health
```

此命令必须返回 HTTP 200 和 JSON health 响应。最后在已登录同一 tailnet 的 iPhone Safari 打开：

```text
https://<TAILNET_HOST>.<TAILNET_NAME>.ts.net/api/health
```

Safari 必须显示 health JSON，且不能出现任何证书警告；否则不要继续安装 App 验收。

### 6. 配置并重装 iOS App

在 Mac 的仓库中创建 `frontend/.env.ios.local`。不要提交该本地配置文件：

```dotenv
VITE_API_BASE_URL=https://<TAILNET_HOST>.<TAILNET_NAME>.ts.net
VITE_API_TOKEN=
```

阶段 1 没有 API token 鉴权，所以 `VITE_API_TOKEN` 保持为空。重新构建并同步 iOS 工程：

```bash
cd frontend
npm run build:ios
```

随后任选一种方式安装：

- 在 Xcode 打开 `frontend/ios/App/App.xcworkspace`，选择已连接的 iPhone 后点击 Run。
- 或在手机连接 Mac 后执行：

  ```bash
  cd frontend
  npx cap run ios --target <DEVICE>
  ```

免费个人 Apple ID 签名的 App 约每 7 天过期。到期后把 iPhone 连接到 Mac，再执行一次 Xcode Run 或上述 `npx cap run ios --target <DEVICE>`；代码和后端数据不需要重建。

## SQLite 数据备份与恢复

容器内数据库固定为 `/app/data/just_talk.db`，对应 VPS 宿主机的：

```text
<REPO_DIR>/deploy/data/just_talk.db
```

为避免复制正在写入的 SQLite 文件，备份时短暂停止后端：

```bash
cd <REPO_DIR>
sudo mkdir -p deploy/data/backups
docker compose -f deploy/docker-compose.yml stop backend
sudo cp deploy/data/just_talk.db \
  "deploy/data/backups/just_talk-$(date +%Y%m%d-%H%M%S).db"
docker compose -f deploy/docker-compose.yml start backend
```

备份完成后，将 `deploy/data/backups/` 中的文件再复制到 VPS 之外的安全位置。恢复前同样停止后端，用选定的备份覆盖 `deploy/data/just_talk.db`，再执行 `sudo chown -R 10001:10001 deploy/data`，最后启动并访问 `/api/health` 验证。升级镜像、迁移 VPS 或删除数据目录前必须先备份。

## 阶段 2 预留：公网 HTTPS + Caddy

**阶段 2 的 API token 鉴权代码尚未实现。当前后端不能安全地直接暴露到公网；在鉴权实现、测试和验收完成前，不要启用 Caddy 服务，也不要向公网放行 80/443。**

### 尚未实现：鉴权实现时必须处理

- **鉴权中间件必须放行 CORS 预检。** 浏览器和 WKWebView 的 `OPTIONS` 预检请求不会携带 `Authorization`；如果中间件把“没有 Bearer”一律判为 401，预检会失败，而前端通常只显示模糊的 CORS 错误。实现时必须豁免所有 `OPTIONS` 请求，同时豁免 `/api/health` 以便探活。
- **导出下载链接无法携带 Bearer。** 当前备份导出使用 `<a href={apiUrl("/api/export")} download>`，原生链接请求不能添加自定义 `Authorization` header；启用 `API_TOKEN` 后按钮会因 401 失效。实现时必须选择并测试一种方案：a) 仅为 `/api/export` 支持查询参数 token；b) 改用 `apiFetch` 获取 blob，再用 `URL.createObjectURL` 触发下载；c) 将 `/api/export` 加入鉴权豁免名单（最省事但端点不设防，不推荐）。

后续决定启用阶段 2 时，需要：

1. 确认 `<PUBLIC_DOMAIN>`，将 DNS A/AAAA 记录指向最终选定 VPS。
2. 实现并测试后端 `API_TOKEN` / Bearer 鉴权，再生成 token：

   ```bash
   openssl rand -hex 32
   ```

   将结果写入服务器 `deploy/.env` 的 `API_TOKEN`，并在 Mac 的 `frontend/.env.ios.local` 写入同一个 `VITE_API_TOKEN`。这些步骤只能在鉴权代码落地后执行。
3. 将 `deploy/Caddyfile` 中的 `YOUR_DOMAIN.example.com` 替换为 `<PUBLIC_DOMAIN>`。
4. 按 `deploy/docker-compose.yml` 中的注释启用 `caddy` 服务和顶层 volumes，并删除 backend 的宿主机 `ports` 配置。Caddy 会通过 Compose 内部网络反代到 `backend:8000`。
5. 火山引擎安全组放行 TCP 80/443。域名解析正确且这两个端口公网可达时，Caddy 会自动申请和续期 Let's Encrypt 证书。
6. 将 `VITE_API_BASE_URL` 改为 `https://<PUBLIC_DOMAIN>`，重新执行 `npm run build:ios` 并安装 App。

是否进入阶段 2，取决于用户后续是否选择公网域名方案；当前交付不包含实际部署、域名配置或鉴权实现。
