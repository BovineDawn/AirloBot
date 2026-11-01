$ErrorActionPreference = 'Stop'
$env:CROCBOT_DATA_DIR = Join-Path $PSScriptRoot 'data'
New-Item -ItemType Directory -Path $env:CROCBOT_DATA_DIR -Force | Out-Null
$packaged = Join-Path $PSScriptRoot 'release\CrocBot-win32-x64\CrocBot.exe'
$development = Join-Path $PSScriptRoot 'node_modules\electron\dist\electron.exe'
if (Test-Path -LiteralPath $packaged) {
    Start-Process -FilePath $packaged -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
} elseif (Test-Path -LiteralPath $development) {
    Start-Process -FilePath $development -ArgumentList ('"' + $PSScriptRoot + '"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
} else {
    throw 'CrocBot is not built. Install the package dependencies and run npm run package first.'
}
