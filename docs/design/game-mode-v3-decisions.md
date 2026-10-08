# Game Mode v3 — 定稿决策（用户已确认 2026-10-08）

来源：v3-astra-r1/r2、v3-fable-r1/r2；用户回答：题量更长（12）；Route 先听再读；Challenge 加 Target 85；12 题只给 Route；内容先起草，用户一起审 60 条。

## 玩法矩阵

| 参数 | Route 6 | Route 12 | Challenge · Target 60 | Challenge · Target 85 |
| --- | --- | --- | --- | --- |
| 题数 / W-F-C | 6 / 2-2-2 | 12 / 4-4-4 | 6 / 2-2-2 | 6 / 2-2-2 |
| 挑战目标 | 无 | 无 | 首次有效读数 ≥60 | ≥85 |
| 心 | 无 | 无 | 2 | 2 |
| 额外池（补救与未判定重录共享） | 2 | 4 | 2 | 4 |
| 最多计数评分 | 8 | 16 | 8 | 10 |
| 首读前听示范 | 可选按钮 | 可选按钮 | 无 | 无 |
| 低分后 | 可继续 | 可继续 | 听示范→补救 | 听示范→补救 |
| 连击线 / tier | ≥85 / 95-85-60 | 同 | 同 | 同 |
| summary 主位 | Practised n/N | 同 | Cleared / Failed / Incomplete | 同 |
| PB key | 旧 `route|focus|1`（字节不变） | 新 key（含 12） | 旧 `challenge|focus|1`（字节不变） | 新 key（含 85） |

- 业务层 `RunMode` 仍为 `route | challenge`；新增冻结的 `RunConfig`（length 6|12，target 60|85|null，maxExtra）。所有规则在 accepted Start 冻结；Play again 沿用；Done 后才可改。
- 命名：入口三段 `Route / Target 60 / Target 85`（无障碍名补全 "Challenge, target 85"）；局内标题 `Challenge · Target 85 · /θ/`。不用 Hard / Precision。
- 不自动升档、不按成绩暗中调线；改线需另行决策。

## 规则
- tier 线 95/85/60 与 `PASS_ACCURACY = 60` 不变（tier、弱词、review 证据线仍用 60）；目标线只经过 `scoreReceived` / `nextCapture` / `canSubmit` 等挑战判定。
- 计分按计划 N：`P = round((9/N)Σq + 100·Σmax(c−1,0)/(N(N−1)/2))`；N=6 与 v2 精确等价；缺失槽位贡献 0 且断链；分母永远是计划 N。连击不封顶。
- 评级：S 需 points ≥950 **且 fullCombo**；A ≥850；B ≥700；C。N=6 下与 v2 结果一致。评级资格不变（每题有首次有效读数，Route 完成 / Challenge cleared）。
- `RUN_RULES_VERSION` 保持 1；Route 6 与 Target 60 的 key 字节不变，加旧 key 兼容测试。
- Target 85 文案：tier 照常（80 · Good，琥珀色）；挑战状态单独一行（"Below this run's target 85 · listen, then read again"；扣心 "Both readings below 85 · one heart used"；保心 "Heart kept · 80 → 88"）。额外池耗尽 → cannot-confirm，文案说"补救额度用完"，不扣心。
- 扣心的石头要可见/可读（例如红色裂纹外圈），不另造一套 tier 配色；不做整套 Hard 主题色。

## Route 的身份
- ready 态加 "Hear it first" 按钮（调用现有 `playReference`）：不自动播放、不要求听完、不阻塞 Record；开始录音时停止正在播放及加载中的示范，迟到音频不得进入开麦期；TTS 失败时仍可练。
- summary：Route 主位 "Practised n/N" + 一个下一步建议；分数/评级次级（不删除）。
- summary 增加显式 "Next sound /x/" 动作：按现有五音素固定循环选下一个，沿用当前玩法/题量，走同一 starting / 错误 / 取消路径；不暗改 Play again；不把轮换的音称为"你最弱的音"。

## 内容
- 每音素 4 warm-up / 4 focus / 4 context = 60 条（+30，AI 起草）。新旧 60 条合成一张审核表交用户审；审完前新条目不进 runtime 题库。
- 6 题局：每阶段从 4 条中按 runId 种子抽 2 条（解决同音素复读）；12 题局用满 4-4-4。warm-up 仍是个人弱词/到期词优先，starter 补齐；一局一个 focus 音素；同局不重复文本。
- 同步 `backend/app/main.py` `GAME_STARTER_TEXTS`、`backend/tests/test_game_starter_cache.py`、`docs/CONTENT-PROVENANCE.md`（如实记录 AI 起草 + 审核状态）。
- 不加 level/CEFR 字段。

## UI
- 入口卡：三段玩法选择 + 仅 Route 显示的 `[6] [12]` chip + 一行说明（目标/心/最多评分次数）；删除六颗装饰占位石头以腾出空间；卡片不高于当前基线；无横向溢出；点击区 ≥44 px；记住最后玩法与 Route 题量（新偏好 key 进 `clearRunStorage`、PRIVACY、Delete my data 测试）。
- 12 颗石头布局（4+4+4 分组，缩小或两行，390 px 内）；summary 网格与点亮时序适配 N（徽章不得早于最后一颗石头点亮）。
- 公开版 usage 行显示 "Up to N scores · M left today"；不预占配额、不自动缩题。

## 不做
连续难度滑块；配比滑块/预设；Route 3；Challenge 12；10/15 题；计时；改心数；改 Standard extras；随机顺序；自动轮换最弱音；通用设置面板；整套主题换皮；改 VAD；后端接口/配额规则变更（白名单同步除外）；`RUN_RULES_VERSION` bump。

## 验收要点
- 59.6/60、84.9/85、94.9/95 边界；Target 85 下 80→82 扣心仍 Good、80→88 保心且首读点数不变、额外池耗尽只 cannot-confirm。
- N=6 全部 v2 算例回归；N=12 算例；S 需 fullCombo。
- 旧 PB 记录升级后仍显示。
- Hear it first 与录音/示范竞态。
- 12 石头与 summary 在 390×844、短屏、大字下的布局。
- 用户真机：Target 85 打若干局，记录补救/扣心/不能确认次数与主观感受（只用于定位问题，不自动改线）。

---

## 增补（owner 确认 2026-10-08，看过 v3 mockup 后）

- **Route 下一题动作：变体 B**：主按钮 Record next；次按钮 "Hear next first"（替代 v2 的 "Hear it again"）。Ready 自身仍有 Hear it first。
- mockup 中 impl-ui 列的待定项按 lead 建议：Route Summary 四个动作按图（See review / Play again / Next sound / Done）；Route Summary 去掉大评级圆环，points/rating/chain 三个小块；Hear it first 胶囊在 ring 下方 + "Optional · Record works any time"；公开版说明行**不再**重复 "up to N scores"，只留 usage 行；Challenge 开始按钮 "Start Challenge"；新文案照图；扣心石头红圈 + 裂纹；Best 标签 "Best · /θ/ · Route 12" / "· Target 85"。
- **内容 60 条 r1 全部通过**（commit ceb6144 记录）。A5 的审批门槛已满足。
- **新增：用我的词开一局（My words run）**，并入 v3：
  - 规则同 Route（无心、Hear it first、Record next / Hear next first、summary Practised n/N）；题数 6 / 12；全部是单词。
  - 题源：词库中未掌握（非 graduated）的词，先到期（`getDueWordsForReview` 顺序），再按 latest_score 由低到高；同局不重复。
  - 入口：① Words 页 "Start a run with my words"；② 每局 summary 一个"用这局读错的词再开一局"动作（本局首次有效读数 <85 的单词/句子目标词 + 词库补足）。
  - SRS：单词评分已经由后端 `record_word_practice` 更新复习计划，无需新后端接口。
  - 不记 PB（题目每局不同）；显示本局分数与评级。
  - 词不够 N 个时怎么办、是否用到 graduated 词、读错词的精确挑选规则、与 Next sound 的关系、与普通 "Start review" 的关系：由设计补充，给默认值。
