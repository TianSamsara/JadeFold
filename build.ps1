. "$PSScriptRoot\scripts\runtime.ps1"
Invoke-FramePnpm build
Invoke-FramePnpm test
if (-not $env:ELECTRON_MIRROR) { $env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/' }
if (-not $env:ELECTRON_BUILDER_BINARIES_MIRROR) { $env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/' }
if (-not $env:ELECTRON_BUILDER_COMPRESSION_LEVEL) { $env:ELECTRON_BUILDER_COMPRESSION_LEVEL = '3' }
& $FrameNode 'node_modules\electron-builder\cli.js' --win portable --publish never
if ($LASTEXITCODE -ne 0) { throw 'Packaging failed.' }
