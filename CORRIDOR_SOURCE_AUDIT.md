# 途中瞭望区间来源与校验记录

## 数据边界

- 开发项目：`publish-hxd1c-running-lookout-training-pages`
- 贯通试验来源项目：`publish-passenger-train-operation-card-brake-continuity-test-pages`
- 来源项目验收提交：`839092b`，复核时工作树为干净状态
- 原游戏线路：`E:\200-生活\210游戏\Train Simulator\ROUTES\NEIYI`（只读）
- 轨道中心线：`5635——本务.pat` + `NEIYI.tdb`

途中瞭望修改仅写入开发项目。来源项目和原游戏资源未修改。

## 完整区间导出

- 原项目只包含 11 个 MSTS 世界块，覆盖约前 13.5 km。
- 本次按 TrackDB 中心线和 800 m 侧向边界重新选取 27 个世界块，覆盖考核全程。
- Web 场景：`assets/msts-neiyi-corridor/neiyi-lookout-full-scene.json`
- 场景 SHA-256：`FC5A1B6548F17A307B78AC58416BC05149FCF9A05485EDA9A1B44846EE7D59C5`
- 场景统计：197 种模型、8339 个实例、30211 个三角形。
- 每个世界块的原文件路径和 SHA-256 已写入场景 JSON 的 `source.worldTiles`。

## 问题与修正根据

| 现象 | 根因 | 修正 |
| --- | --- | --- |
| 树木、楼房纹理倒置 | MSTS UV 已按原坐标导出，Three.js 又默认翻转图像 | 设置 `texture.flipY = false` |
| 钢轨断缝、后段缺失 | 世界块导出只覆盖前半段，MSTS 分节模型还存在 Web 接缝 | 扩展全程世界块，并用同一 TrackDB 中心线生成连续轨面、钢轨及反光带 |
| 驾驶视点离开钢轨 | MSTS 的铁路和公路均被导出为 `TrackObj`，公路方向被误当成轨道切线 | 中心线对齐仅接受 `A1t/A2t/A3t` 系列铁路构件 |
| 无真实隧道 | 原导出范围未覆盖隧道世界块 | 直接引入原游戏 `Cn_tunnel*`、`JP1tunnel1t`和隧道轨道模型；教学层只叠加净空轮廓异常 |
| 信号机像临时模型 | 第一闭塞信号机由几何体临时搭建 | 使用原游戏 `SignalObj` 杆体与姿态，灯位来自 `NEIYI/sigcfg.dat` |

## 可视化验收点

- 0 km：站内发车场景、原游戏出站信号机。
- 13–16 km：连续轨道、树木正向显示。
- 16.0 km：正常道口。
- 17.87–18.80 km：原游戏隧道；18.48 km 净空轮廓异常。
- 26.0 km：钢轨反光带中断，钢轨本体不断。
- 28.6 km：人员/车辆侵限道口。
- 28.88 km：在大山铺进站信号机前结束考核。
