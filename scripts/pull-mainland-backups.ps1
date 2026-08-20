$ErrorActionPreference = "Stop"

$serverIp = "43.143.122.238"
$keyPath = Join-Path $env:USERPROFILE ".ssh\context-reader-mainland_ed25519"
$backupRoot = Join-Path $env:USERPROFILE "Documents\Context Reader Backups\mainland-postgres"
$timestamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$finalPath = Join-Path $backupRoot "context-reader-backups-$timestamp.tar.gz"
$temporaryPath = "$finalPath.partial"

New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null

$latestLocalBackup = Get-ChildItem -LiteralPath $backupRoot -Filter "context-reader-backups-*.tar.gz" |
  Sort-Object LastWriteTimeUtc -Descending |
  Select-Object -First 1
if ($latestLocalBackup -and $latestLocalBackup.LastWriteTimeUtc -gt (Get-Date).ToUniversalTime().AddHours(-20)) {
  Write-Output "Recent mainland backup already exists: $($latestLocalBackup.FullName)"
  exit 0
}

$arguments = @(
  "-i", $keyPath,
  "-o", "BatchMode=yes",
  "-o", "StrictHostKeyChecking=yes",
  "ubuntu@$serverIp",
  "sudo tar -C /var/backups/context-reader/postgres -czf - daily weekly monthly"
)

$process = Start-Process -FilePath "ssh.exe" -ArgumentList $arguments -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput $temporaryPath
if ($process.ExitCode -ne 0) {
  Remove-Item -LiteralPath $temporaryPath -ErrorAction SilentlyContinue
  throw "Remote backup download failed with exit code $($process.ExitCode)"
}

if ((Get-Item -LiteralPath $temporaryPath).Length -lt 256) {
  Remove-Item -LiteralPath $temporaryPath -ErrorAction SilentlyContinue
  throw "Downloaded backup archive is unexpectedly small"
}

Move-Item -LiteralPath $temporaryPath -Destination $finalPath
Get-ChildItem -LiteralPath $backupRoot -Filter "context-reader-backups-*.tar.gz" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -Skip 14 |
  Remove-Item -Force

Write-Output $finalPath
