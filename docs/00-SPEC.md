# 00 · SPEC — 我们对要做的东西达成一致了吗

> 赛道 L｜Relate by Neo4j Hackathon。作品 **Kin**。写于 2026-11-14 05:10，闸 A 的产物。

## 0. 官方评分表（原文，rules 第 5 节）

> There will be three winning entries, awarded first, second, and third prize.
> Winners will be chosen by a panel of Neo4j judges.
>
> Judges will score each eligible entry on the following criteria, **weighted equally**.
>
> - **Creativity**: how original the idea and approach are.
> - **Usefulness**: how well the project solves a real problem.
> - **Completeness**: whether it works end to end and can be run from the setup instructions.
> - **Clarity**: the quality of the written explanation, demo, and visual presentation.
> - **Effective use of connected context**: how well it uses the Product's graph, retrieval, and agent features.

提交要求（rules 第 4 节，原文）：

> A project title and description… A link to the public GitHub repository… tagged with the topic `relate`.
> Setup instructions that let a judge install and run the project.
> A demo: a video of up to 2 minutes **or a link to a working demo**, plus screenshots if useful.
> A statement of which Product capabilities, third-party tools, and AI tools the project uses.

**由此定的两条硬约束**：

1. **不做视频**。规则允许「可打开的 demo 链接」代替。走 GitHub Pages 的 WASM demo，省掉的正是上一场（K）卡住的那一环。
2. **`relate` topic 必须打在仓库上**，否则算提交不完整。

## 1. 一句话

家谱在浏览器标签页里回答「我们是什么亲戚」，并把那条血脉路径用一根红线画出来。

## 2. 60 秒演示脚本（先写脚本，再写验收条件）

| 秒 | 画面 | 旁白 |
| --- | --- | --- |
| 0–6 | 打开 `hkmpn9s6dh-commits.github.io/hackathon-2026-kin/`，整屏家谱，Ada 与 Theo 之间一条朱红细线 | 这是十六个人的五代家谱。它刚刚回答了一个问题。 |
| 6–16 | 鼠标落在答案卡：「Theo Lind is Ada Vell's second cousin.」下面一行小字：3 up · 3 down | 表亲这个说法不存在于任何一个人的字段里。它是两个数字：各自往上数几代，两条线在哪里碰头。 |
| 16–30 | 在问句框里打 `how are Milo and Theo related`，回车：红线重画，答案变成 second cousin once removed | 换两个人，答案重算。这张表里没有什么是预先算好的。 |
| 30–42 | 输入 `how are Wilma and Suze related`：卡片写「没有共同祖先」，但走的是 Daan——「Wilma 嫁给 Daan，而 Suze 是 Daan 的表亲」 | 没有共同祖先不等于没有关系。红线走的是婚姻那条边，另一头接回血缘。 |
| 42–52 | 点开 THE QUERY BEHIND THAT ANSWER：`MATCH up = (a)<-[:PARENT*0..6]-(ca) …` | 每一个答案下面都摆着产生它的那条 Cypher，和它跑完用的毫秒数。 |
| 52–60 | 点 Add a person，填 Nina、母亲选 Ada，图重新排布，Nina 出现在 Milo 旁边 | 加一个人，整张图重排，所有答案同时重算。全部在这个标签页里，一个请求都不发。 |

## 3. 验收条件（每条都要有可跑的证据）

- **AC-1 家谱画得出来**：打开页面，`.chart-svg .person` 计数 = 16。
- **AC-2 首屏就有一个答案**：`.answer .term` 含 `second cousin`。
- **AC-3 答案画在图上**：`.chart-svg .is-path` ≥ 5。
- **AC-4 打字能问**：输入 `how are Daan and Noor related` → 答案含 `half-sister`。
- **AC-5 Cypher 可查**：`#cypher` 文本含 `MATCH up` 与 `PARENT`。
- **AC-6 点两个人也能问**：依次点 roster 里的 Marta、Hedy → 答案含 `both married`。
- **AC-7 一个人也是一问**：点 Ivo → 答案列出父母。
- **AC-8 能加人**：Add a person 填 Nina/母亲 Ada → 图上 17 人，`data-id="nina-vell"` 存在。
- **AC-9 半同胞不混**：`daan`↔`noor` = half-sister（两人各有两个已知父母、共一个）；只有单亲记录时不得擅自说「half」。
- **AC-10 姻亲说得清**：`wilma`↔`suze` = marriage，锚点 `daan`，血亲关系 = first cousin。
- **AC-11 不发生任何网络请求**：e2e 断言非 `127.0.0.1` 请求数 = 0。
- **AC-12 布局不重叠**：同一行任意两人 x 间距 ≥ COL；多配偶的人必须站在两个配偶之间（`test/layout.test.ts`）。
- **AC-13 一条命令验完**：全新 clone 只照 README 跑 `bash scripts/verify.sh`，退出码 0。

## 4. 范围：做什么，不做什么

**做**：家谱图的自动布局、亲属称谓（含 half/removed）、姻亲路径、问句框（5 类句式）、加人、JSON 存取、Cypher 披露、UI 量测。

**不做**（明确写下，避免范围膨胀）：

- 不做账号、不做云同步、不做多人协作。嵌入式的卖点就是「不上云」。
- 不接 LLM。家谱是封闭世界，问句是模式匹配，答案必须可复现。
- 不做 GEDCOM 导入。时间够才做；不做不影响任何一条 AC。
- 不做 2 分钟视频。规则允许 demo 链接代替，闸 D 不过不录片的规矩也一致。

## 5. 为什么这是图问题（写给评委看的那一版在 README）

「表亲」不是人的属性，是两个人之间的路径长度。要回答「哪一位共同祖先、各上几代、隔几代」，必须走两步：从 A 上溯到汇合点，再从汇合点下溯到 B。用关系库要写递归 CTE，而且拿不到「汇合在哪一位」这个附带信息——那正是画红线需要的。加一个人，全表答案失效重算，这正是图数据库的主场。
