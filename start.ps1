. "$PSScriptRoot\scripts\runtime.ps1"
if (-not (Test-Path -LiteralPath 'dist\index.html')) { Invoke-FramePnpm build }
$env:ELECTRON_RUN_AS_NODE = $null
& $FrameNode 'node_modules\electron\cli.js' '.'
