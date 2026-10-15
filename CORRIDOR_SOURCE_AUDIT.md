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
| 钢轨断缝、后段缺失 | 世界块导出只覆盖前半段，MSTS 分节主线轨道在 WebGL 中仍有接缝和重叠；真实轨头超过数百米后小于一像素 | 保留原场景侧线；本务运行线按同一 TrackDB 中心线在加载时一次性生成至完整约38.3 km路径终点，使用有宽度和高度的连续实体钢轨头，并在150–310 m后渐入不覆盖故障段的远景LOD，不在考核终点截断 |
| 驾驶视点离开钢轨 | MSTS 的铁路和公路均被导出为 `TrackObj`，公路方向被误当成轨道切线 | 中心线对齐仅接受 `A1t/A2t/A3t` 系列铁路构件 |
| 无真实隧道 | 原导出范围未覆盖隧道世界块 | 直接引入原游戏 `Cn_tunnel*`、`JP1tunnel1t`和隧道轨道模型；教学层只叠加净空轮廓异常 |
| 信号机像临时模型 | 第一闭塞信号机由几何体临时搭建 | 使用原游戏 `SignalObj` 杆体与姿态，灯位来自 `NEIYI/sigcfg.dat` |

## 近程课堂考核重排

原线路真实隧道位于约17.87 km，首轮直接沿用该里程导致课堂运行3–5分钟仍看不到道口或隧道。本项目保留原线路中心线、地形和隧道构件，但将考核事件压缩到前6 km：

- 1.75 km：结束贯通试验阶段。
- 2.20 km：正常道口。
- 3.20–3.50 km：由3段100 m原NEIYI直线隧道轨道段和原洞门搭建短隧道，3.52 km设置轮廓异常。
- 4.60 km：钢轨反光带中断，连续钢轨本体不切断。
- 5.60 km：人员/车辆侵限道口。
- 6.00 km：完成全部场景后结算。

## 地形来源

- 原65×65导出文件保留作为回归基线；瞭望项目单独使用同8个近程世界块的257×257高程网格（8 m原生采样）。
- 高程由Open Rails的 `TerrainFile` 和 `TerrainAltitudeFile` 解析，并转换到与轨道、建筑相同的原点坐标。
- 地表使用原线路 `TERRTEX/terrain.ace` 与 `microtex.ace` 转换纹理。
- 原始 `.t`、`_y.raw` 文件路径及SHA-256写入 `neiyi-lookout-terrain.json`，原游戏文件保持只读。
- 瞭望原生地形：`assets/msts-neiyi-corridor/neiyi-lookout-terrain-native.json`。
- 瞭望原生地形 SHA-256：`1A98DAC2056ECEBD21956087CB4E145F0D69AA0187324E6EE862F8AAC9F68093`。
- 原道口预制体：`assets/msts-neiyi-corridor/lookout-source-prefabs.json`，SHA-256：`CFC22028523BD650A7119878B3D490659C54253288A07F39F369463E2BA673CC`。

## 已弃用的首轮长距离布置

以下里程只用于定位原线路资产和解释首轮问题，已不再作为当前考核场景坐标：

- 0 km：站内发车场景、原游戏出站信号机。
- 13–16 km：连续轨道、树木正向显示。
- 16.0 km：正常道口。
- 17.87–18.80 km：原游戏隧道；18.48 km 净空轮廓异常。
- 26.0 km：钢轨反光带中断，钢轨本体不断。
- 28.6 km：人员/车辆侵限道口。
- 28.88 km：在大山铺进站信号机前结束考核。
