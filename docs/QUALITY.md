# 画质、压缩效率与小丸参考

小丸工具箱是 x264 / 音频编码 / 封装工具的图形前端。其历史版本还可能使用 tMod 等特殊构建，不能仅凭“都用 x264”就承诺任何设置下的输出相同。

本项目参考公开旧版源码中的命令参数，独立映射到 FFmpeg libx264。参考来源：[小丸说明](https://maruko.appinn.me/config/readme.html)、[旧版 MainForm.cs](https://github.com/wzxjohn/marukotoolbox/blob/master/mp4box/MainForm.cs#L226)。

## 原理与模式

编码器利用空间预测、运动补偿、变换和熵编码减少重复信息；有损量化决定保留多少细节。恒定画质模式按复杂度变化码率，不保证大小。二遍编码先分析，再依据目标码率分配各帧预算，适合限制总大小，不自动优于同样大小的优质 CRF 编码。较慢预设投入更多搜索，画质、体积和速度的变化依素材而异。

- 日常精细推荐：CPU x265、slow、CRF 24、10bit、原分辨率。
- 动漫精细推荐：CPU x265、slow、CRF 22、10bit、animation 调优。
- 录屏精细推荐：CPU x264、slow、CRF 18、8bit、原分辨率，优先文字可读性。
- 小丸经典参考：CPU x264、veryslow，参数 ref=3、bframes=3、me=umh、min-keyint=1、scenecut=60、deblock=1,1、qcomp=0.5、psy-rd=0.3,0、aq-mode=2、aq-strength=0.8，CRF 可调整。

这些是起点，不是所有片源的最优参数。二遍模式仅支持 CPU x264 / x265，目标按音频和封装预算扣除；原音轨复制可避免再次有损压缩，但受容器兼容性限制。

## 可复现短片测试

日期：2026-11-02。FFmpeg 6.1.1，CPU 线程上限 4。三个样本都由 FFmpeg 合成，640 × 360、24 fps、3 秒、72 帧、无音频，参考文件使用 FFV1 保存。没有降低分辨率、帧率或改变片长。

两方案都使用相同 0.12 MB 总体积目标及两遍编码。小丸参考用 libx264 veryslow；x265 方案用 10bit slow，边缘样本使用 animation 调优。VMAF 使用默认模型，SSIM 取帧平均；测量前统一为 8bit 420 以适配模型。耗时只包含编码，不包含质量测量。

| 合成样本 | 编码方案 | 输出字节 | VMAF | SSIM | 编码秒数 |
| --- | --- | ---: | ---: | ---: | ---: |
| general-stress | classic-reference | 120,360 | 73.615 | 0.923552 | 1.51 |
| general-stress | h265-10bit | 123,621 | 74.107 | 0.922943 | 3.07 |
| animation-edges | classic-reference | 124,664 | 72.455 | 0.976752 | 0.61 |
| animation-edges | h265-10bit | 123,007 | 71.423 | 0.974041 | 2.48 |
| screen-text | classic-reference | 36,282 | 96.625 | 0.999752 | 0.40 |
| screen-text | h265-10bit | 38,145 | 96.346 | 0.999621 | 1.63 |

这些数据不能证明已超过原版小丸：没有运行原小丸二进制，测试素材也不是实拍、动画成片或真实录屏。它们验证的是参数实现、码率预算与质量测量链条。两方案在不同指标和样本上各有胜负；x265 10bit 不会在每个片源都更优。屏幕样本过于简单，两种方案均远低于体积上限，不能当作严格同实际码率比较。

实际验收应使用相同原片、相同裁切区间、分辨率、帧率和音频处理，对照明确版本的小丸；在相同体积附近比较 VMAF / SSIM，并人工检查暗部、运动、线条、色带和小字。VMAF / SSIM 不能替代主观观看，尤其不能单靠高分判断动漫和录屏。

运行 `pnpm benchmark -- "D:/videos/input.mp4"` 可对自己的素材前 6 秒生成相同流程的 JSON 报告，结果保存在 `.test-artifacts/benchmark/`。默认不传参数则运行以上合成样本。源文件不上传。

编码文档：[FFmpeg libx264 / libx265](https://ffmpeg.org/ffmpeg-codecs.html)、[x265 码率控制](https://x265.readthedocs.io/en/master/cli.html#quality-rate-control-and-rate-distortion-options)。AV1 等更现代编码也值得单独评估，但本版本未以它们作成熟质量承诺。
