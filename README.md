# 零号协议 ZERO PROTOCOL

黑白灰像素风 2D 肉鸽弹幕射击游戏：四名英雄、六种武器、七种小怪、两位 Boss、多房间探索、晶片升级与羁绊，内置 AI 代打。

原生 HTML5 Canvas + Web Audio，零第三方运行依赖。浏览器为主版本，正式数值保存在 JSON，Node 提供确定性仿真与发布构建。

![游戏标题素材](assets/art/title.png)

[在线游玩](https://l4place0.github.io/l4p-knight/) · [版本历史](CHANGELOG.md) · [问题追踪](docs/issues/README.md)

## 运行

需要 Node >=22 和 Git LFS，无第三方依赖，无需 npm install。

```powershell
git clone https://github.com/l4place0/l4p-knight.git
cd l4p-knight
git lfs pull
npm start
```


打开 http://127.0.0.1:8941/。也可先执行 npm run config:generate，再双击 index.html。npm run build 生成 dist/ 离线发布目录。

## 操作

| 输入 | 功能 |
| --- | --- |
| WASD / 方向键 | 移动 |
| 鼠标 / 左键 | 瞄准 / 射击 |
| Shift / 右键 / 空格 | 冲刺 |
| F | 相位刃与弹反 |
| E | 互动、房门与传送门 |
| Q / 1 / 2 | 切换武器 |
| B / M / P | AI 代打 / 静音 / 暂停 |
| 手柄 | 左右摇杆移动/瞄准，RT 射击，LT 冲刺，X 近战，B 互动 |
| 触屏 | 虚拟摇杆与动作按钮，射击自动瞄准 |

URL 支持 ?seed=1&bot=1&autostart=1 固定种子自动游玩。

## 开发与发布

npm run config:generate → npm run test:ci → npm run build。

[架构](docs/architecture.md) · [配置与数值](docs/configuration.md) · [玩法规格](docs/gameplay.md) · [开发与验收](docs/development.md) · [发布流程](docs/releasing.md) · [美术资源](docs/art/README.md)

GitHub Actions 检查后部署 dist/ 到 GitHub Pages。素材使用 Git LFS，构建时下载并打包真实文件。

作者 **l4place**（GitHub：**l4place0**）。源码、文档及素材统一采用 [MIT License](LICENSE)。
