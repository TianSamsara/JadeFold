. "$PSScriptRoot\runtime.ps1"
$ProgressPreference = 'SilentlyContinue'
$BinaryDirectory = Join-Path $ProjectRoot 'node_modules\ffmpeg-static'
if (-not (Test-Path -LiteralPath $BinaryDirectory)) { throw 'Run pnpm install first. If binary downloads fail, run this script afterwards.' }
$BinaryPath = Join-Path $BinaryDirectory 'ffmpeg.exe'
$ExpectedHash = '04E1307997530F9CF2FE35CBA2CA7E8875CA91DA02F89D6C7243DF819C94AD00'
$DownloadRoot = 'https://registry.npmmirror.com/-/binary/ffmpeg-static/b6.1.1'
if (-not (Test-Path -LiteralPath $BinaryPath)) {
  $ArchivePath = Join-Path $env:TEMP ('frame-ffmpeg-' + [guid]::NewGuid().ToString() + '.gz')
  try {
    Invoke-WebRequest -Uri "$DownloadRoot/ffmpeg-win32-x64.gz" -OutFile $ArchivePath -TimeoutSec 180
    $InputFile = [IO.File]::OpenRead($ArchivePath)
    $GzipFile = [IO.Compression.GZipStream]::new($InputFile, [IO.Compression.CompressionMode]::Decompress)
    $OutputFile = [IO.File]::Create($BinaryPath)
    try { $GzipFile.CopyTo($OutputFile) } finally { $OutputFile.Dispose(); $GzipFile.Dispose(); $InputFile.Dispose() }
  } finally { if (Test-Path -LiteralPath $ArchivePath) { Remove-Item -LiteralPath $ArchivePath } }
}
if ((Get-FileHash -LiteralPath $BinaryPath -Algorithm SHA256).Hash -ne $ExpectedHash) { throw 'FFmpeg checksum does not match the pinned, tested binary. Delete it and retry.' }
foreach ($Notice in @('README','LICENSE')) {
  $NoticePath = "$BinaryPath.$Notice"
  if (-not (Test-Path -LiteralPath $NoticePath)) { Invoke-WebRequest -Uri "$DownloadRoot/win32-x64.$Notice" -OutFile $NoticePath -TimeoutSec 60 }
}
if (-not $env:ELECTRON_MIRROR) { $env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/' }
& $FrameNode 'node_modules\electron\install.js'
if ($LASTEXITCODE -ne 0) { throw 'Electron download failed.' }
Write-Output 'FFmpeg verified; Electron ready.'
