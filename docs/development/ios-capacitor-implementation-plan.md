# iOS (Capacitor) Implementation Plan

**Goal:** 把现有 React 前端用 Capacitor 打包成 iPhone App，后端 FastAPI 部署到远端服务器，实现"随时随地在 iPhone 上练习"。不重写任何业务逻辑。

**Architecture:** 前端代码不分叉——同一份 `frontend/` 同时产出 Web 版（Vite dev proxy → 本机后端）和 iOS 版（`dist/` 打进 Capacitor WKWebView → 远端 HTTPS 后端）。差异只有两个构建期环境变量：`VITE_API_BASE_URL` 与 `VITE_API_TOKEN`。

**Tech Stack:** Capacitor 8 (`@capacitor/core` / `@capacitor/ios` / `@capacitor/cli`)、Xcode 27、FastAPI、Caddy (自动 HTTPS)。

---

## 0. 现状盘点（决定方案的事实）

| 事实 | 对方案的影响 |
|---|---|
| 所有 `fetch` 都在 `frontend/src/api.ts`（16 处，全是相对路径 `/api/...`） | 只需一个 `apiFetch` 包装函数加前缀，无需改组件 |
| TTS 返回 `audio_base64`，无音频 URL | 不存在跨域资源 URL 问题 |
| `useRecorder.ts` 已按 `audio/webm;codecs=opus` → `audio/mp4` 特性检测 | **实测修正（iOS 27 Simulator WebKit）**：`isTypeSupported("audio/webm;codecs=opus")` 返回 `true`，所以 iOS 走的是 **webm/opus** 分支而非预期的 `audio/mp4`。结果无害——这正是桌面端一直在用的路径，后端原样支持。另已实测：把 MP4/AAC 字节命名为 `.webm`（`api.ts` 硬编码 `recording.webm`）后，`probe_audio_duration_seconds` / `convert_to_wav_16k_mono` 仍能正确解析并转成 16k mono WAV，因为 ffmpeg 按内容嗅探容器而非扩展名。录音链路确认零改动 |
| CSS 已有 640/768/850/1200 断点 | 移动端布局基本可用，只需处理刘海/安全区 |
| 无外部字体/CDN 依赖 | 打包后离线也能渲染 |
| 后端**没有任何鉴权**，CORS 写死 `localhost:5173` | 一旦公网可达，任何人可白嫖 Azure key 并读写你的练习历史 → 必须加鉴权 + CORS 可配置 |
| 主题存 `localStorage` | Capacitor WKWebView 持久化 localStorage，正常 |

## 1. 关键决策（需要你确认的用 ⚠️ 标出）

**D1. 后端如何对手机可达 —— 两个选项（结论见下方"D1 结论"）**
- **A. 公网 HTTPS + Bearer token**：Caddy 反代自动签 Let's Encrypt 证书；后端加 `API_TOKEN` 环境变量，`/api/*` 校验 `Authorization: Bearer <token>`。手机不需要开 VPN，体验最好。代码量约 30 行 + 1 个测试。
- **B. Tailscale**：服务器 + iPhone 装 Tailscale，`tailscale serve` 顺带解决 HTTPS，后端零鉴权代码。代价是手机要常开 VPN。若你选 B，Task 2 整个跳过。
- ⚠️ 需要你确认：选 A 还是 B？服务器是什么系统、有没有 Docker、有没有域名（A 需要域名指向服务器）？

**D1 结论（已确认：VPS 位于境外地域）**

- 境外地域**无 ICP 备案限制**，下面的备案决策表对你不适用，保留仅作参考。两条路都畅通。
- **决定的执行顺序：阶段 0 本机 → 阶段 1 VPS + Tailscale → 阶段 2（可选）公网 HTTPS + token。**
  - **阶段 0（本机，先做）**：后端照常在 Mac 上跑（`./scripts/dev.sh`）。Simulator 连 `http://127.0.0.1:8000`；真机与 Mac 同一 Wi-Fi，连 `http://<Mac 局域网 IP>:8000`。**iOS ATS 不约束 IP 地址目标**（只约束公网域名），所以明文 HTTP 可用，不需要证书、不需要 ATS 例外、不需要 Tailscale。这一阶段验证 Task 1–3 的全部内容，包括真机麦克风/音频。前提：后端要绑 `0.0.0.0` 而不是 `127.0.0.1`（检查 `scripts/dev.sh`），Mac 防火墙放行。
  - 阶段 0 完成后再做 Task 4（VPS 已确认可装 Docker）。
  - 阶段 1（Tailscale）：VPS `tailscale up` + `tailscale serve --bg 8000` 得到 `https://<vps>.<tailnet>.ts.net`，iPhone 装 Tailscale 客户端。不需要域名、证书、鉴权代码 → **Task 2 暂缓**，Task 4 只做 Dockerfile + compose。
  - 阶段 2（可选，公网 HTTPS）：买/用一个域名指向 VPS，Caddy 监听 443 自动签发，补 Task 2 鉴权。App 侧只改 `VITE_API_BASE_URL` 重新 build。
  - 后端代码始终在 VPS 上，两个阶段之间后端不动。
- 提示：若 iPhone 平时在大陆网络，Tailscale 协调服务器 `login.tailscale.com` 偶尔不稳（影响首次登录/密钥交换，不影响已建立的直连）。若体感不好，这就是切阶段 2 的信号。
- 后端出网：东南亚 VPS 访问 Azure Speech（建议 `AZURE_SPEECH_REGION` 选 `southeastasia`，就近）和 LLM 端点均无障碍。

**（参考）国内云厂商大陆地域的 ICP 备案问题**

若 VPS 在中国大陆地域，云厂商会在网络层拦截未备案域名到 80/443 端口的 HTTP(S) 请求。这意味着：

| 情况 | 结论 |
|---|---|
| VPS 在**香港/新加坡等境外地域** | 无备案要求，标准做法：Caddy 监听 443，自动 Let's Encrypt，Task 4 按原样做 |
| VPS 在**大陆地域**且域名**已备案** | 同上，标准做法 |
| VPS 在**大陆地域**且域名**未备案** | 80/443 走不通。可行的绕法（按推荐顺序）：<br>**A1. 非标端口 + DNS-01 签证**：后端 HTTPS 监听如 `8443`（备案拦截只针对 80/443），证书用 acme.sh 走 DNS-01（需要域名 DNS 托管在支持 API 的服务商，如 Cloudflare / 阿里云 DNS / 火山 DNS）。Caddy 的 HTTP-01/TLS-ALPN-01 都要用 80/443，所以这条路**用 acme.sh + nginx**（或 Caddy 加 DNS 插件）。App 的 `VITE_API_BASE_URL` 写成 `https://domain:8443`。<br>**A2. 只用 IP + 自签证书**：iOS 会拒绝，需要在手机上装 CA 描述文件并手动信任 —— 每台设备折腾一次，能用但脏，不推荐。<br>**B. Tailscale**：完全绕开备案和证书（`tailscale serve` 给 `*.ts.net` 域名自动 HTTPS）。大陆 VPS 与 iPhone 之间的直连成功率一般不错，直连不了会走 DERP 中继（境外，可能慢）。手机需常开 Tailscale VPN。 |
| 没有域名 | 只剩 A2 或 B → 推荐 B |

另外两个和云厂商相关的确认项：
- 后端要出网访问 **Azure Speech**（`*.cognitiveservices.azure.com` / `*.stt.speech.microsoft.com`）和你配置的 **LLM 端点**。你本地已经跑通，说明大陆网络到 Azure 是通的，但 VPS 出口 IP 不一定一样，部署后先 `curl` 一下 Azure region 端点确认。
- 云厂商安全组默认只放 22，需要放行你选的端口（443 或 8443，或 Tailscale 的 UDP 41641）。

**D2. API 地址和 token 怎么进 App —— 构建期注入**
- 用 `VITE_API_BASE_URL` / `VITE_API_TOKEN`（写在 `frontend/.env.ios.local`，git-ignore）。个人自用、不上架，token 打进包里可接受。
- 不做设置页 / 运行时配置——换服务器就重新 build 一次，成本很低。以后需要再加。

**D3. Apple 签名 —— 已确认：暂无付费账号，用免费个人 Apple ID**
- 免费账号限制：App **每 7 天过期**，到期后需把手机连 Mac 重新 `Run` 一次（Xcode 一键，约 1 分钟）；同一时间最多 3 个 App ID；无 TestFlight。
- 应对：在 Task 3 里把"重装"做成一条命令（`npm run build:ios && npx cap run ios --target <device>`），把 7 天重装的摩擦压到最低。若之后用得顺再升级付费账号，代码不用改。
- Bundle ID 暂定 `com.kyx.justtalk`（可改）。
- **首次真机安装**还需要在 iPhone 上 设置 → 通用 → VPN 与设备管理 里信任开发者证书；开启 设置 → 隐私与安全性 → 开发者模式。

**D5. 目标 iOS 版本 —— 已确认：iPhone 跑最新 beta（iOS 27 beta）**
- 和本机 Xcode 27 beta 匹配，真机调试没问题（beta 系统需要 beta Xcode 才能识别，正好）。
- Capacitor 8 最低 iOS 15，MediaRecorder / WKWebView getUserMedia 早已支持，无兼容问题。
- 风险：beta 系统 WebKit 可能有新回归（尤其音频路由）。若真机遇到怪问题，先在 Simulator（稳定版 runtime）对照一次，区分是代码问题还是 beta 问题。

**D4. `ios/` 目录纳入 git**：Capacitor 惯例，提交 `frontend/ios/`（`Pods/`、`build/`、`DerivedData` 忽略）。

## 2. iOS WKWebView 已知风险与应对

| 风险 | 何时验证 | 应对 |
|---|---|---|
| ATS 拦截明文 HTTP | 编译期即知 | **真机实测通过（2026-08-16，iPhone / iOS 27）**：App 经 `capacitor://localhost` 以明文 HTTP 访问 `http://192.168.1.8:8000`，后端实收该机 `192.168.1.11` 的 `/api/health`、`/api/words`、`/api/materials`、`/api/sessions` 全部 200，未被 ATS 拦截，**未加任何 ATS 例外**（也不需要 `NSAllowsLocalNetworking`）。阶段 1/2 走 HTTPS 时同样不加例外 |
| `getUserMedia` 需要安全上下文 | 真机 | Capacitor 的 `capacitor://localhost` 是安全上下文，OK；仍需 `NSMicrophoneUsageDescription` |
| 静音拨片开着时 TTS 无声 | **真机**（模拟器测不出） | 先观察；若发生，在 `AppDelegate` 里设 `AVAudioSession` category 为 `.playAndRecord` + `.defaultToSpeaker`。**不预先解决** |
| 录音后声音走听筒而不是扬声器 | 真机 | 同上 |
| App 切后台录音中断 | 真机 | 接受，不处理 |
| 状态栏/刘海遮住顶部 | 模拟器可见 | `viewport-fit=cover` + `env(safe-area-inset-*)` |
| `100vh` 在 iOS 含地址栏高度 | Capacitor 无地址栏 | 不处理 |
| 键盘快捷键（`App.tsx:766`）在手机上无意义 | — | 不处理，无害 |
| **流式录制的 WebM 不写 duration** → 后端 `probe_audio_duration_seconds` 抛 KeyError，`/api/score` 返回 400 | **真机首次录音即复现**（模拟器/桌面测不出） | **已修（backend/app/audio.py）**：容器有 duration 走原快路径；缺失时扫音频包取 `max(pts_time + duration_time)` 回退。iOS 只是第一个踩到的客户端，根因是后端假设该字段必然存在，与 Capacitor 无关 |

## 3. Tasks

每个 Task 独立可验证；按顺序做，Task 1/2 完成后即可先用 Vite dev + curl 验证，不依赖 Xcode。

### Task 1: 前端 API 地址 / token 可配置

**Files:** `frontend/src/api.ts`, `frontend/src/vite-env.d.ts`, `frontend/.env.example`(新), `.gitignore`

- [x] `api.ts` 顶部加 `API_BASE_URL`（读 `import.meta.env.VITE_API_BASE_URL`，去尾斜杠，默认 `""`）和 `apiFetch(path, init)`：拼前缀；若 `VITE_API_TOKEN` 非空则注入 `Authorization: Bearer` header（不覆盖调用方已有 headers）
- [x] 16 处 `fetch(` → `apiFetch(`
- [x] `vite-env.d.ts` 声明两个 env 类型
- [x] `.gitignore` 加 `frontend/.env*.local`
- [x] 补 `api.test.ts` 用例：设了 base/token 时请求 URL 与 header 正确；未设时行为不变
- **验证：** `npm test`、`npm run build` 通过；`npm run dev` 走 proxy 行为不变

### Task 2: 后端 CORS 可配置（阶段 1 必做）+ 鉴权（阶段 2 再做）

**Files:** `backend/app/config.py`, `backend/app/main.py`, `backend/tests/test_auth.py`(新), `.env.example`

- [x] **阶段 1**：`config.py` 加 `CORS_ORIGINS`（逗号分隔，默认保持现值 + `capacitor://localhost`），`main.py` 读它。这一步 Tailscale 也需要，因为 App 的 origin 是 `capacitor://localhost`
- [ ] **阶段 2**：`config.py` 加 `API_TOKEN`（默认空 = 关闭鉴权，本地开发不受影响）
- [ ] **阶段 2**：`main.py` 加中间件：`API_TOKEN` 非空时，`/api/*` 请求缺失或错误 Bearer 一律 401；`/api/health` 是否豁免——**豁免**（方便探活）
- [ ] 测试：token 未配置 → 放行；已配置 → 无 header 401、错 token 401、对 token 200、health 豁免
- **验证：** `PYTHONPATH=backend python3.11 -m pytest backend/tests`

### Task 3: Capacitor iOS 工程

**Files:** `frontend/package.json`, `frontend/capacitor.config.ts`(新), `frontend/ios/`(新), `frontend/index.html`, `frontend/src/styles.css`, `.gitignore`

- [x] `npm i @capacitor/core @capacitor/ios && npm i -D @capacitor/cli`
- [x] `npx cap init "Just Talk" com.kyx.justtalk --web-dir dist`；`npx cap add ios`
- [x] `ios/App/App/Info.plist` 加 `NSMicrophoneUsageDescription`
- [x] `index.html` viewport 加 `viewport-fit=cover`；`styles.css` 给顶层容器加 `padding-top: env(safe-area-inset-top)` / bottom
- [x] `package.json` 加脚本 `build:ios`（`vite build --mode ios && cap sync ios`），读取 `.env.ios.local`
- [x] `.gitignore` 加 `frontend/ios/App/Pods/`, `frontend/ios/App/build/`, `frontend/ios/App/App/public/`（sync 产物）
- **验证：** `xcodebuild -workspace ios/App/App.xcworkspace -scheme App -sdk iphonesimulator build` 成功；用 iOS Simulator 跑起来能看到界面、能请求到 Mac 本机后端（`VITE_API_BASE_URL=http://127.0.0.1:8000`，ATS 不约束 IP 目标）
- [x] `scripts/dev.sh` 后端 host 改为 `${BACKEND_HOST:-127.0.0.1}`，真机调试时 `BACKEND_HOST=0.0.0.0 ./scripts/dev.sh`（默认行为不变）
- **真机（阶段 0）**：`VITE_API_BASE_URL=http://<Mac 局域网 IP>:8000`，同一 Wi-Fi；`ipconfig getifaddr en0` 取 IP
- **真机验证清单**（模拟器覆盖不到的）：麦克风权限弹窗 → 录音 → 评分返回 → TTS 播放（静音拨片开/关各试一次）→ 录音后播放的出声设备

### Task 4: 后端部署到 VPS

**Files:** `backend/Dockerfile`(新), `deploy/docker-compose.yml`(新), `deploy/Caddyfile` 或 `deploy/nginx.conf`(新，取决于 D1 补充表), `docs/development/ios-deploy.md`(新)

- [x] Dockerfile：python3.11-slim + ffmpeg + requirements；数据卷挂 `/app/data`（SQLite 在此，**记得备份**）
- [ ] **阶段 1（Tailscale）**：VPS 上装 Tailscale，`tailscale up`，`tailscale serve --bg 8000`；后端容器只绑 `127.0.0.1:8000`，不暴露公网端口。安全组放行 UDP 41641（直连用；不放也能走中继，只是慢）
- [ ] **阶段 2（公网 HTTPS，可选）**：compose 加 `caddy`，监听 443 自动签发；安全组放行 80/443
- [ ] iPhone 装 Tailscale 客户端，登录同一 tailnet
- [x] 部署文档：`.env` 里要填的东西（Azure key、`API_TOKEN` 用 `openssl rand -hex 32` 生成、`CORS_ORIGINS`）、如何生成 `frontend/.env.ios.local`、如何 build + 装机、7 天重装步骤
- **验证：**
  - VPS 上 `curl https://<azure-region>.api.cognitive.microsoft.com` 能通（确认出网到 Azure）
  - `curl https://<host>[:port]/api/health` 200；`curl -H "Authorization: Bearer <token>" .../api/materials` 200；无 token 401
  - **在 iPhone Safari 里**打开 `https://<host>[:port]/api/health`：无证书警告才算过（这一步替 ATS 提前把关）
- ⚠️ 依赖你的答复：VPS 地域、是否有域名、域名是否备案、DNS 托管在哪、VPS 系统与有无 Docker。

### Task 5: 收尾

- [x] README 加 "iOS" 小节链到部署文档
- [ ] 一次真机完整练习流程走通（Short Drill + Long Passage + 词库）
  - [x] **Short Drill 已在真机跑通**（2026-08-16）：录音 → 上传 → ffmpeg 转 16k mono WAV → Azure 评分 → 正确返回分数。
        期间修掉一个后端 bug：流式录制的 WebM 不写 duration，`probe_audio_duration_seconds` 抛 KeyError 导致 `/api/score` 400（详见第 2 节风险表）。
  - [ ] Long Passage、词库流程
  - [ ] TTS 播放（静音拨片开/关各一次）、录音后出声设备（扬声器 vs 听筒）

## 4. 明确不做的事

- 不做设置页 / 运行时改服务器地址（D2）
- 不做离线模式、不做本地缓存历史
- 不预先处理 AVAudioSession（等真机复现再说）
- 不加 `@capacitor/status-bar` 等原生插件（CSS 能解决）
- 不接 Ollama——手机端 LLM drill 生成走服务器上配置的 `LLM_BASE_URL`

## 5. 待你确认的问题汇总

已确认：无付费 Apple 账号（走免费签名，7 天重装）；iPhone 为最新 beta；服务器为自有 VPS。

已确认：VPS 在境外（无备案问题），可装 Docker；先在本机（阶段 0）跑通，再上 VPS + Tailscale。Bundle ID 用 `com.kyx.justtalk`（未反对即采用，随时可改）。

Task 4 开工前再定具体使用哪台 VPS（就近原则）。
