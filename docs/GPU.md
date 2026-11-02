# 显卡编码加速

v0.2.0 新增右侧「加速方式」。默认自动选择；可手动选择 NVIDIA NVENC、Intel Quick Sync、AMD AMF 或 CPU。

启动后使用内置 FFmpeg 对每个后端、每种视频编码做真实短片试编码。不以 Windows 显卡名称或 FFmpeg 编译列表直接认定可用。自动按 NVIDIA、Intel、AMD、CPU 顺序选取当前 H.264 / H.265 的可用编码器。手动选定不可用后端时不启动任务；自动模式的硬件编码失败会清理当前临时文件、显示原因并从头改用 CPU。

| 后端 | 实际编码器 | 画质控制 | 速度映射 |
| --- | --- | --- | --- |
| CPU | libx264 / libx265 | CRF | fast / medium / slow |
| NVIDIA | h264_nvenc / hevc_nvenc | VBR + CQ，目标码率为 0 | p3 / p5 / p7 |
| Intel | h264_qsv / hevc_qsv | global_quality（ICQ） | fast / medium / slow |
| AMD | h264_amf / hevc_amf | CQP，I/P 帧 QP；H.264 另设 B 帧 QP | speed / balanced / quality |

画质滑块仍为 18–35，数值不能跨编码器作为等画质比较。显卡编码通常以更低的 CPU 编码负担完成工作，但实际速度受素材、驱动、视频解码、分辨率和磁盘影响。本版本视频解码与缩放、音频编码仍在 CPU 上执行。

实现参数通过随软件打包的 FFmpeg 6.1.1 的 `-h encoder=h264_nvenc`、`-h encoder=h264_qsv`、`-h encoder=h264_amf` 帮助核对。NVIDIA 官方 FFmpeg 使用文档：https://docs.nvidia.com/video-technologies/video-codec-sdk/13.0/ffmpeg-with-nvidia-gpu/index.html 。本机测试详情见 TESTING.md。
