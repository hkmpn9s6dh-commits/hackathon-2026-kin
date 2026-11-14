# 02 · PROOF — 你能证明它能用吗

> 闸 C 的产物。写于 2026-11-14 07:20。所有数字都来自本机实跑，不是估算。

## 一句话

`bash scripts/verify.sh` 退出 0；同一套浏览器检查对**线上 Pages** 也跑了一遍，14/14。

## 1. 一条命令

```
$ bash scripts/verify.sh

== node          node v22.22.2, npm 10.9.7
== install       node_modules present
== type check    (tsc --noEmit, 无输出)
== unit tests    72 tests passed
== build         dist/ 产出，wasm 6,932,319 字节
== end to end    14/14 checks passed
== ui measurement proof/ui/report.md updated
== hygiene       (无 TODO、无密钥、无非 wasm 大文件)
verify: all green
```

## 2. 单测（72 条）

| 文件 | 条数 | 守的是什么 |
| --- | --- | --- |
| `test/kinship.test.ts` | 33 | 27 组 (上溯, 下溯) → 英语称谓的对照表；half/full 分开；说法可逆；负数报错 |
| `test/graph.test.ts` | 21 | 真引擎（Node 绑定的同一个 Relate）建这 16 人，跑真 Cypher，断言表亲/半同胞/姑姑/姻亲/同一个人/查无关系 |
| `test/layout.test.ts` | 9 | 代数单调；同行不重叠；多配偶的人在两个配偶之间；子代挂在父母之下 |
| `test/ask.test.ts` | 9 | 问句解析：两个名字的顺序、长名优先、不匹配单词内部、单名的父母/子女/配偶意图 |

**为什么单测能跑真引擎**：`src/cypher.ts` 把 Cypher 语句和 Relate 的打开方式分开，测试用 `@relate/relate`（Node 原生绑定）打开一个内存库，跑的是**和浏览器一模一样的语句**。绑定不同，图是同一张图。

## 3. 浏览器检查（14 项，本地与线上各一遍）

```
ok   the chart draws every person — 16 names
ok   the first screen already answers a question — Theo Lind is Ada Vell's second cousin.
ok   the answer is drawn on the chart — 12 marks in vermilion
ok   the answer names both people — ADA VELL → THEO LIND
ok   a typed question reaches the graph — Noor Vell is Daan Vell's half-sister.
ok   the Cypher that produced it is on screen
ok   two names clicked on the chart answer too — Both married to Ivo Vell.
ok   one name lists its neighbours — IVO VELL
ok   a new person joins the chart — 17 names
ok   and is drawn under their mother
ok   the roster counts what is in the graph — 17 people, 18 parent links, 6 partnerships
ok   nothing spills out of its column — {"panel":0,"body":0}
ok   no console errors
ok   nothing is fetched from anywhere else
```

线上那一遍：

```
$ KIN_URL=https://hkmpn9s6dh-commits.github.io/hackathon-2026-kin/ node scripts/e2e.mjs
against https://hkmpn9s6dh-commits.github.io/hackathon-2026-kin/
... 14/14 checks passed
```

这一条比其余所有加起来都硬：**评委打开的那个链接，本身就是验过的那个东西**。

## 4. 全新 clone 复验（闸 C 的硬要求）

```
$ git clone https://github.com/hkmpn9s6dh-commits/hackathon-2026-kin /tmp/kin-fresh
$ cd /tmp/kin-fresh && npm ci && bash scripts/verify.sh
verify: all green
```

（做法与结论记在 `docs/02-PROOF.md` 本节；时间与终端输出见提交评论。）

## 5. 没有验的、以及为什么

| 项 | 状态 | 原因 |
| --- | --- | --- |
| Safari / Firefox | 未验 | 只在 Chromium 上跑过。WASM 与 OPFS 之外的 API 都是标准件，风险低但没证据。 |
| 手机真机 | 只有 430×900 的模拟截图 | `shots/06-phone.png`。断点会把面板折到图下面，但没在真机上划过。 |
| 大图（>200 人） | 未验 | 布局是 O(行 × 块 × 轮数)，查询有 `*0..6` 上限；图表大了首屏会需要横向滚动。 |
| 数据导入（GEDCOM） | 没做 | 明确在范围外（`00-SPEC.md` §4）。 |
| 持久化（OPFS） | 没做 | Relate 的 `opfs://` 必须在 worker 里打开；这一版用「导出 JSON + 拖回」代替，够用且可测。 |

## 6. 已知的软处

1. **问句框是模式匹配，不是理解**。认得名字和五类意图；「我奶奶的妹妹的女儿」这种链式问法不认。
2. **姻亲只解一层**。锚点只取「本人 + 直接配偶」，不处理「配偶的配偶的亲戚」这种多跳姻亲。
3. **称谓表覆盖到 11th cousin**，再远就退化成数字。英语里本来也很少这么说。
4. **`shared` 数的是共同祖先的个数**（含父母双方），不是「共同祖先对数」，文案里写的是「N shared ancestors」，与实现一致。
