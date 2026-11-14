# 05 · SUBMISSION — 逐栏该填什么

> 提交入口：https://relate.devpost.com/ 。截止 **2026-12-11 18:00 PST = 2026-12-12 10:00 北京**。
> 用户只需在 Devpost 上点 Join、粘贴下面五栏、提交。**不需要上传视频**（规则允许用 demo 链接代替）。

## 0. 用户要做的三步（约 12 分钟）

1. **报名**：https://relate.devpost.com/ → 右上 `Join hackathon`（已有 Devpost 账号则直接点）。
2. **建草稿**：`My projects` → `Submit a project`，先把项目建出来（规则建议报名当天先建，占位）。
3. **粘贴**：把下面「§1 逐栏文案」五段按顺序贴进去，保存。**先别点最终提交**——留一次通读。

## 1. 逐栏文案

**Project name**

```
Kin — how are two people related?
```

**Elevator pitch（一行）**

```
A family chart that answers "how are we related?" in words, and draws the answer on the chart — entirely inside your browser tab, on an embedded graph database.
```

**Inspiration / What it does（描述第一段）**

```
Family trees are the most personal data most people own, and every app that holds them wants an account and a server. Kin takes the opposite bet: the whole graph database ships as WebAssembly, so the chart lives in the tab and nothing is ever fetched.

You ask a question in plain words — "how are Milo and Theo related?" — and Kin answers with the kinship term (second cousin once removed), the ancestor where the two lines meet, how many generations each side climbs, and how many ancestors they share. Then it draws that path on the chart in vermilion, so the answer is a line you can follow rather than a sentence you have to trust.

It is not a demo with sixteen people in it. Import GEDCOM — the format every genealogy program writes — and the app opens on your own file: a 1,089-person village imports and paints in about a second. Big files open focused on one person's neighbourhood, with the generation numbers kept absolute. Report answers the four questions nobody can see by eye: which couples share an ancestor (one Cypher query for the whole chart), the longest unbroken parent line, who connects any two or three people, and what is missing.
```

**How we built it（描述第二段，必须写技术栈）**

```
The engine is Relate, an embedded property-graph database, compiled to WebAssembly and running in-process. Every answer is one Cypher query with two variable-length legs:

MATCH up   = (a:Person {id: $a})<-[:PARENT*0..6]-(ca:Person)
MATCH down = (ca)-[:PARENT*0..6]->(b:Person {id: $b})
RETURN ca.id AS ancestor, length(up) AS up, length(down) AS down,
       [n IN nodes(up) | n.id] AS upIds,
       [n IN nodes(down) | n.id] AS downIds
ORDER BY up + down ASC, abs(up - down) ASC, ancestor ASC
LIMIT 1

Nothing is precomputed: add one person and every answer in the chart is re-derived. When the two people share no ancestor at all, Kin walks `shortestPath((a)-[:PARENT|PARTNER*0..5]-(b))` instead and names the blood relation on the far side of the marriage ("Wilma is married to Daan, and Suze is Daan's first cousin") rather than reporting a hop count.

The chart itself is deliberately not a node-link diagram. Generations are rows, a couple is one block, partners stand side by side, children hang from their parents' marriage line — computed, not simulated, so the same data always draws the same page.
```

**Challenges / What we learned（描述第三段）**

```
Naming a relationship is a much sharper problem than drawing one. "Second cousin once removed" is not a property of a person: it is a function of two integers you only get by walking the graph. Getting the edge cases honest took longer than the layout — a person married twice has to stand between their partners or the second marriage line crosses the first spouse's name; siblings who share one parent are half-siblings, but only when the chart actually knows two parents each, otherwise the honest word is "sister".
```

**What's next**

```
Persistence through Relate's OPFS store, so the chart survives a reload without a file; multi-hop in-law naming beyond one marriage; and lazy layout so a ten-thousand-person file opens as fast as a thousand-person one.
```

## 2. 别的字段

| 字段 | 值 |
| --- | --- |
| GitHub repository | `https://github.com/hkmpn9s6dh-commits/hackathon-2026-kin` |
| **Built with**（逗号分隔） | `relate, neo4j, cypher, webassembly, typescript, vite, graph-database` |
| **Try it out** 链接 | `https://hkmpn9s6dh-commits.github.io/hackathon-2026-kin/` |
| Video demo URL | **留空**（用 Try it out 链接代替，规则允许） |
| Gallery image | `submission/cover-1500x1000.png`（待出，闸 D 之后再截） |
| 团队 | 个人参赛 |

## 3. 规则要求的「声明」（必须在描述里出现）

> A statement of which Product capabilities, third-party tools, and AI tools the project uses.

建议在描述末尾原样加一段：

```
Built with: Relate by Neo4j (embedded WebAssembly engine; openCypher — MATCH, variable-length paths, shortestPath, length(), nodes(), MERGE, property indexes). Third-party tools: TypeScript, Vite, Newsreader and JetBrains Mono (SIL OFL). AI tools: an AI coding assistant was used for implementation and review; every claim in this description is backed by a test in the repository (`bash scripts/verify.sh`, 68 unit tests and 14 browser checks).
```

## 4. 提交前自查

- [ ] 仓库已打 `relate` topic（已打，`gh repo edit --add-topic relate`）
- [ ] 仓库公开、不登录可 clone（已验证：全新 clone 后 `verify.sh` 全绿）
- [ ] demo 链接不登录可打开（已验证：线上 14/14）
- [ ] 描述里写了技术栈与 AI 工具声明
- [ ] 没有上传视频（不需要）
- [ ] 封面待补：`submission/cover-1500x1000.png`
