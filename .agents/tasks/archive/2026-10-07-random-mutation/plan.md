## 随机变异测试功能(test/mutation.js)· 实现计划

### 设计原则(照搬 SQLite 的思想)
测试系统本身也要被测试:**随机在代码中注入一个小变异 → 跑验收 → 必须发现;幸存变异暴露的是测试盲区**(不是代码 bug)。每次运行完全可复现(seed + file:line + 算子 + 原文/变异文 diff 全记录)。

### 新增交付物:`test/mutation.js`(单文件 CLI,~300 行,零依赖)

**1. 目标池采集**
- 扫描 `js/core.js`、`js/game/*.js`、`js/bot.js`(无头可测层;render/audio/music/input/hud/ui/storage/main 为浏览器专用层,headless 原理性不可测——消融实验已实证,排除并在报告注明)
- 逐行分类(复用消融实验分类逻辑):跳过空行/注释/块注释内/纯结构符号,其余为候选变异点

**2. 变异算子集(SQLite 风格,8 种,随机选「变异点 × 算子」组合)**
| 算子 | 变异方式 | 例 |
|---|---|---|
| CONST | 数值常量 ±1 或 ×2 | `0.35 → 0.36` |
| CMP | 比较符翻转 | `< ↔ <=`、`=== ↔ !==` |
| LOGIC | 逻辑符交换 | `&& ↔ \|\|` |
| ARITH | 算术符交换 | `+ ↔ -`、`* ↔ /` |
| BOOL | 布尔翻转 | `true ↔ false` |
| NEG | `!` 移除/插入 | `if (!x)` → `if (x)` |
| DEL | 整行语句删除 | (消融实验同款) |
| RET | 返回值变异 | `return x` → `return undefined` |
- 安全约束:行内引号感知扫描,绝不改字符串字面量内部(精灵画/地图行保护);变异后 `node --check` 必须通过,失败则换算子重采样(有界重试)

**3. 检测器(分层复用现有基建)**
- tier-1:`node test/abl/run.js`(~0.7s,三场景 + 逐帧不变量)
- tier-2(仅 tier-1 存活者):`SEEDS=1 node test/sim.test.js`(~2.3s)
- 判定:killed(任一层失败)/ survived(两层都过)

**4. 安全与恢复(硬约束)**
- 启动时断言工作树干净,脏树拒绝运行
- 每个变异后 `git checkout -- <file>` 恢复并校验;try/finally 兜底;结束断言树干净
- 全程不改 test/abl 探针与其他文件

**5. CLI 与报告**
```
node test/mutation.js [--count N=20] [--seed S] [--file <关键词>] [--strict [阈值=60]] [--json]
```
- 控制台逐变异判定 + 汇总(注入数/杀死/幸存/杀率);`--seed` 打印供复现
- `--json`:写 `test/mutation-results/mutation-<seed>.json`(gitignore 该目录),含每个变异的 file:line、算子、diff、判定、杀死层级
- 幸存者自动归类标签:数据-表现层(SPRITES/MAPS/FONT35)/ 表现层(sfx·addParts·flash 调用行)/ 逻辑盲区(其余)——继承消融实验的聚类结论
- `--strict`:杀率低于阈值或 game/ 逻辑层存在幸存者 → 退出码 1(可选 CI 门;当前杀率 ~38%,门会红——这是诚实信号,默认不开启)

**6. 文档与集成**
- HANDOFF §3 命令表 + §8 DoD 加可选门一行;README 验收节一句;归档笔记

### 验证方案(实现后必做)
1. `--seed 42 --count 20` 基线运行 → 结果可复现(再跑一次逐字节一致)
2. 杀伤力抽检:人工注入已知 bug(如 ComparisonOperator 翻转)→ 确认 killed 且报告 diff 正确
3. 运行前后 `git status --porcelain` 均为空;structure.check 不受影响
4. `--strict` 在当前杀率下正确退出 1

### 明确不做
- UI/渲染层变异(需浏览器自动化逐变异执行,成本不可行;消融实验已给出该层的静态结论)
- JS 解析器依赖(行级启发 + --check 兜底足够,保持零依赖)
- 把变异测试并入 sim.test(会污染并行测试;独立工具单独跑)

### 预估
test/mutation.js ~300 行;`--count 50` 全程 ~1.5 分钟。