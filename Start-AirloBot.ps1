$ErrorActionPreference = 'Stop'
$env:AIRLOBOT_DATA_DIR = Join-Path $PSScriptRoot 'data'
New-Item -ItemType Directory -Path $env:AIRLOBOT_DATA_DIR -Force | Out-Null
$packaged = Join-Path $PSScriptRoot 'release\AirloBot-win32-x64\AirloBot.exe'
$development = Join-Path $PSScriptRoot 'node_modules\electron\dist\electron.exe'
if (Test-Path -LiteralPath $packaged) {
    Start-Process -FilePath $packaged -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
} elseif (Test-Path -LiteralPath $development) {
    Start-Process -FilePath $development -ArgumentList ('"' + $PSScriptRoot + '"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
} else {
    throw 'AirloBot is not built. Install the package dependencies and run npm run package first.'
}
