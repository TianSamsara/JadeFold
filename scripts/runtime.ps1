$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$SystemNode = Get-Command node -ErrorAction SilentlyContinue
$BundledNodeRoot = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node'
if ($SystemNode) { $FrameNode = $SystemNode.Source }
elseif (Test-Path -LiteralPath (Join-Path $BundledNodeRoot 'bin\node.exe')) { $FrameNode = Join-Path $BundledNodeRoot 'bin\node.exe' }
else { throw 'Node.js 22.12+ is required.' }
$BundledPnpm = Join-Path $BundledNodeRoot 'node_modules\pnpm\bin\pnpm.cjs'
$env:PATH = (Split-Path -Parent $FrameNode) + [IO.Path]::PathSeparator + $env:PATH
Set-Location -LiteralPath $ProjectRoot
function Invoke-FramePnpm {
  if (Get-Command pnpm.cmd -ErrorAction SilentlyContinue) { & pnpm.cmd @args }
  elseif (Test-Path -LiteralPath $BundledPnpm) { & $FrameNode $BundledPnpm @args }
  else { throw 'pnpm is required.' }
  if ($LASTEXITCODE -ne 0) { throw "pnpm exited with code $LASTEXITCODE" }
}
