# 开发与验收

```powershell
git lfs install
git lfs pull
npm run config:generate
npm start
```

打开 http://127.0.0.1:8941/。生成配置后也可双击根目录 index.html。Node >=22，无第三方依赖，无需 npm install。

```powershell
npm run test:ci
npm run test:equivalence
npm run build
```

test:ci 包含结构、配置、发布产物、仿真、动画、难度、小怪和定向变异。test:equivalence 对照迁移基线 5d189a7 的四英雄逐帧完整局；后续有意调整玩法或数值时须更新/退役该一次性对照门和 workflow，不能继续要求与旧玩法一致。

真实阵亡允许，超时/停滞/异常/穿墙不算难度达标。数值修改追加 balance:difficulty 或相关英雄/小怪/Boss 专项。完整 batch、矩阵、随机变异独立于日常 CI。报告保留种子、英雄、bot 基因、配置摘要和实验覆盖；历史统计只对对应版本有效。

新增武器：JSON 定义、弹道行为、bot 适配、补给池、真实场景验收。新增敌人：定义、区域权重、AI/危险场、素材、回归。新增晶片/羁绊须同时更新配置与源码行为 registry。修改加载顺序须同步结构守护。

浏览器验收入口：test/visual-issues.html、test/navigation-browser.html、test/browser-smoke.html；动画预览在 assets/art/animations/preview.html。这些开发页不进入 dist。

localStorage 按 file://、localhost、Pages 站点隔离，无跨设备同步。Issue 004/005/006 状态以 issues/ 为准，历史交接中的延期说明不作为当前状态。
