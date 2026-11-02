# JadeFold · 凝影阁

**凝万千光影，藏于方寸之间。**

JadeFold（凝影阁）是白玉京系列的 Windows 本地离线视频压缩工具。以玉白、青黛、淡金与云海仙阙构成玄幻古风界面，使用 Electron + React + TypeScript + FFmpeg。

视频在本机处理，无需账号、无需上传。支持显卡编码加速、批量队列、画质预设、实时进度、取消与失败重试，输出新文件并保留原视频。

## 使用

打包后双击 `release/白玉京-凝影阁-0.2.0-Windows.exe`。无需另外安装 FFmpeg。

1. 拖入视频，或点击「添加视频」（快捷键 Ctrl + O）。
2. 选择画质预设，并按需调整编码、分辨率、CRF、速度和音频。
3. 选择输出文件夹，点击「开始压缩」。完成后通过文件夹按钮查看结果。

支持 MP4、MOV、MKV、AVI、WebM、M4V、WMV、FLV、TS、MTS、M2TS 输入，MP4 / MKV 输出。支持 NVIDIA NVENC、Intel Quick Sync、AMD AMF 显卡编码与 CPU 编码；启动时通过真实试编码检测支持，自动模式优先显卡，处理失败会提示并回退 CPU；支持 H.264 / H.265、批量顺序队列、实时进度、取消、失败重试和最近 100 条处理记录。文件同名时自动编号，不修改输入文件。

## 开发

环境：Node.js 22.12+（建议 Node.js 24）、pnpm 11，Windows x64。

```powershell
git clone https://github.com/TianSamsara/JadeFold.git
cd JadeFold
pnpm install
pnpm dev
```

构建、验证和打包：

```powershell
pnpm build
pnpm test
pnpm test:desktop
pnpm dist
```

便携包生成在 `release/`。依赖、测试素材、构建产物和便携包均不提交到 Git 仓库。

本机 Codex 环境只有内置 Node / pnpm，使用项目里的 `dev.ps1`、`build.ps1` 或 `start.ps1`；脚本会寻找系统或 Codex 内置运行时。

GitHub 二进制下载不可达时，Electron 可设置 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`。FFmpeg 镜像下载与校验安装方法见 `scripts/setup-binaries.ps1`。运行软件时不需要网络。

浏览器模式 `pnpm dev:web` 仅供布局预览；本地文件处理需要 Electron 桌面版。

## 当前限制

- 处理第一路视频和第一路音频；不复制字幕、多音轨、章节和附件。
- 暂不支持 HDR 色调映射、GPU 解码/缩放、目标体积两遍编码或暂停续传。
- CRF 控制画质，不承诺固定压缩比例；已压缩文件输出可能更大。
- 分辨率选项限制画面宽高边界，保持比例且不放大，竖屏以所选最高高度为限。
- 应用重启后保留完成记录与参数，不恢复未完成队列。取消会清理当前临时文件；系统断电或强制终止可能留下 `.frame-*.partial.*` 文件，可手动删除。
- 当前便携包为未签名的本地试用版。

设计与来源见 [docs/DESIGN.md](docs/DESIGN.md)、[docs/THIRD_PARTY.md](docs/THIRD_PARTY.md)。

## 显卡加速

在「压缩设置 → 加速方式」选择自动或指定显卡。NVIDIA / Intel / AMD 的 H.264 与 H.265 支持分别检测；不支持的选项不可选择。自动优先顺序为 NVIDIA、Intel、AMD、CPU。显卡仅加速视频编码；解码、缩放和音频仍会使用 CPU。不同编码器的 CRF / CQ / ICQ / QP 数值不可直接比较，实际速度和体积取决于素材与设置。若手动选定的显卡处理失败，会保留失败信息供重试；仅自动模式回退 CPU。
