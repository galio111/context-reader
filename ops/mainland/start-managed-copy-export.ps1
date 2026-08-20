param(
  [Parameter(Mandatory = $true)][string]$ToolDirectory,
  [Parameter(Mandatory = $true)][string]$ConnectionFile,
  [Parameter(Mandatory = $true)][string]$OutputFile,
  [Parameter(Mandatory = $true)][string]$StandardOutput,
  [Parameter(Mandatory = $true)][string]$StandardError
)

$env:PYTHONPATH = $ToolDirectory
$scriptPath = Join-Path $PSScriptRoot 'export-managed-supabase-copy.py'
$arguments = @($scriptPath, $ConnectionFile, $OutputFile) |
  ForEach-Object { '"' + $_.Replace('"', '\"') + '"' }
$process = Start-Process `
  -FilePath 'python' `
  -ArgumentList ($arguments -join ' ') `
  -WorkingDirectory (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) `
  -WindowStyle Hidden `
  -RedirectStandardOutput $StandardOutput `
  -RedirectStandardError $StandardError `
  -PassThru

Write-Output $process.Id
