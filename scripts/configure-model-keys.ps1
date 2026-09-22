[CmdletBinding()]
param([string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference = 'Stop'
$rootPath = [IO.Path]::GetFullPath($ProjectRoot)
if (-not (Test-Path -LiteralPath (Join-Path $rootPath 'package.json'))) { throw 'Choose the Context Reader project directory.' }
$targetPath = Join-Path $rootPath '.env.local'
Write-Host 'MiMo: https://platform.xiaomimimo.com/ (ordinary pay-as-you-go API key)'
Write-Host 'Jev:  https://console.typesafe.ai/ (official TypeSafe key)'
Write-Host 'Input is hidden. Leave blank to keep the existing value. Keys stay in .env.local; no deployment occurs.'
$content = if (Test-Path -LiteralPath $targetPath) { [IO.File]::ReadAllText($targetPath) } else { '' }
foreach ($entry in @(@('MIMO_API_KEY','MiMo API key'), @('TYPESAFE_API_KEY','TypeSafe Jev API key'))) {
  $secure = Read-Host $entry[1] -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    $value = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr).Trim()
    if (-not $value) { continue }
    if ($value -match '[\s"''`$#]') { throw 'The key contains unsupported characters. Copy only the key.' }
    $name = $entry[0]
    $pattern = '(?m)^' + [regex]::Escape($name) + '=.*\r?$'
    $content = [regex]::Replace($content, $pattern, '')
    $content = $content.TrimEnd() + "`r`n" + $name + '=' + $value + "`r`n"
  } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr); $value = $null; $secure.Dispose() }
}
# No key is passed as a command-line argument, printed, uploaded or placed in Git.
[IO.File]::WriteAllText($targetPath, $content, [Text.UTF8Encoding]::new($false))
Write-Host 'Saved privately. Tell Codex that key entry is complete; do not paste keys into chat.'
