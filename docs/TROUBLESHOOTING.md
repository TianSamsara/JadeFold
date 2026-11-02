# 体积增加与播放兼容性

## 为什么压缩后更大

CRF / CQ 是画质控制，不是目标体积。把已经低码率编码的 H.265 转成 H.264，或者要求编码器保留更多细节，可能得到更高码率、更大的文件。重新编码不能恢复源片已经丢失的细节。更大的输出也不能证明画质更好。

CPU + 显卡混合是批量调度方式，单个文件只使用一个视频编码器。只有一个任务时，不会把同一视频拆成 CPU / GPU 两份编码。体积问题应先比较原片与输出的编码、码率、时长、分辨率和帧率。

目标是改善播放兼容性时，可选择 H.264，但应接受体积和画质的取舍。目标是限制体积时，可设置明确的目标大小，或使用原片 85% 快捷操作；二遍编码会按音频和封装预算分配视频码率，不能承诺视觉无损。

## 为什么原片不能播放，转码后能播放

同样的 MP4 扩展名可以包含不同视频编码。Windows 自带播放器通常支持 H.264，但 HEVC 可能需要额外的视频扩展。软件自带 FFmpeg 的解码能力，与 Windows 系统播放器的解码能力不同。

可以检查 HEVC 视频扩展，或使用具备 HEVC 解码支持的播放器。仅将 HEVC 的封装标签改为 hvc1，无法补上系统缺少的 HEVC 解码器。不要把重新编码到 H.264 后能播放，直接当作原文件损坏的证据。

参考：[微软媒体播放器排查](https://support.microsoft.com/en-us/windows/apps/windowsmediaplayer/troubleshoot-windows-media-player-errors)、[微软编解码器说明](https://support.microsoft.com/en-us/windows/apps/windowsmediaplayer/codecs-faq)、[NVIDIA VBR-CQ 说明](https://docs.nvidia.com/video-technologies/video-codec-sdk/13.1/ffmpeg-with-nvidia-gpu/index.html)。

## v0.5.0 行为

- 导入并记录源编码、标签、视频和总码率。
- HEVC 转 H.264、HEVC 输出的播放要求与不合理目标体积会在任务开始前提示。
- 输出成功后重新探测编码与码率，分别显示源信息和输出信息。
- 输出未缩小显示黄色「转码完成」，并说明没有减小文件；保留实际输出。
- 不修改源文件，不删除历史版本已产生的输出，不自动安装系统解码器或更改默认播放器。
