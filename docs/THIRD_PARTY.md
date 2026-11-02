# 第三方组件与参考来源

本项目自行实现 UI、队列和 FFmpeg 调度，参考以下项目的产品工作流：

- HandBrake：https://github.com/HandBrake/HandBrake
- Shutter Encoder：https://github.com/paulpacifico/shutter-encoder
- 用户指定的 Stageshow：https://github.com/benjitaylor/skills/tree/main/stageshow
- UI/UX Pro Max：https://github.com/nextlevelbuilder/ui-ux-pro-max-skill

运行时组件：

| 组件 | 许可 / 说明 |
| --- | --- |
| Electron | MIT；Chromium、Node.js 的第三方许可见随附 LICENSE / LICENSES.chromium.html |
| React、React DOM | MIT |
| Lucide | ISC |
| ffmpeg-static 包 | GPL-3.0-or-later；当前 Windows 引擎为 FFmpeg 6.1.1，Gyan essentials 静态构建，GPL v3 |
| ffprobe-static 包 | 包装代码 MIT；随附 Windows FFprobe 4.0.2 静态构建含 GPL 组件 |

FFmpeg 引擎可执行文件、构建说明及 GPL 原文随应用保存在 `resources/app.asar.unpacked/node_modules/ffmpeg-static/` 下的 `ffmpeg.exe`、`ffmpeg.exe.README` 和 `ffmpeg.exe.LICENSE`。

FFmpeg 对应源码：https://github.com/FFmpeg/FFmpeg/commit/e38092ef93

静态构建与构建配置：https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1 以及随附 README。

FFprobe 对应 FFmpeg 4.0.2 源码：https://ffmpeg.org/releases/ffmpeg-4.0.2.tar.xz ，构建配置可执行 `ffprobe -buildconf` 查看。FFprobe 二进制来自 ffprobe-static 包所附 Zeranoe 构建。

当前产物用于本地开发和试用。若向第三方正式分发，需依各组件许可提供完整的对应源码、构建脚本及许可声明，并处理发行签名；本文件中的上游链接不替代 GPL 要求的完整对应源码交付。
