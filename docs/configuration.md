# 配置与数值

config/*.json 是正式数值来源，普通 Git 跟踪。JSON 不存可执行表达式；公式、碰撞、状态机、晶片与羁绊行为保留在源码，以稳定 ID 关联。

| 文件 | 内容 |
| --- | --- |
| weapons / heroes / enemies | 武器、英雄、小怪及 Boss 定义 |
| bosses | Boss 欲望、弹速、密度和伤害倍率 |
| difficulty | 区域敌人倍率、三档难度、道中/Boss 曲线 |
| chips / synergies | 描述、权重、引用与命名效果参数 |
| player | 基础属性、移动、护盾、冲刺、无敌与连击 |
| progression | 刷怪预算、补给、升级、商店、评分和解锁 |
| zones / maps / daily | 区域权重、地图、每日修改器 |

单位：时间为秒，坐标/距离/半径为逻辑像素，速度为像素/秒，夹角为弧度，概率为 0–1，倍率 1 为 100%，target 为百分数 0–100。生命和伤害保持现有浮点结算。

普通房 HP = 基础 HP × 区域 hpMul × curve.enemyHp；enemyTuning 按旧语义覆盖区域字段。Boss HP = 基础 HP × bossTuning.hpMul × curve.bossHp，其他 Boss 倍率与实验覆盖相乘。玩家承伤 = 攻击伤害 × 档位 damageScale × 对应道中/Boss 曲线；damageTuning 保留显式覆盖语义。护盾先吸收再扣生命。

整层刷怪预算 = base + (zoneIdx + 1) × zone + roomIdx × floor，分给三个战斗房后各加 curve.extraEnemies。晶片效果缩放为 chipUpgradeMultiplier^lv，仍使用既有 ceil/上下限。split 减伤补偿与晶片共用 damagePenalty。

编辑 JSON → npm run config:generate → 专项仿真 → 刷新页面开新局。Node 进程加载 core 时读取配置，改文件后启动新进程。配置深冻结，不提供局内热加载，现有局不随文件改变。

schemas/ 使用 JSON Schema。无依赖校验器支持 type、required、properties、additionalProperties、enum、anyOf、minimum、exclusiveMinimum、maximum、minLength、minItems、maxItems；新增关键字须同步代码和测试。还检查 ID 唯一性、引用、Boss 攻击池、地图边界。缺失或非法配置明确报错。

配置 SHA-256 包含所有组及顺序，浏览器生成文件、release.json 和仿真报告记录摘要；实验覆盖独立记录。数组顺序影响抽样与图集索引，不应随意重排。

本阶段抽离正式定义表与主要调参项。敌人/Boss 分支内的部分攻击时序、几何和特效常量仍属于参考源码；其他平台重写须结合规格、源码和回归场景，JSON 本身不是完整玩法实现。
