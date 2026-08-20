$ErrorActionPreference = "Stop"

$serverIp = "43.143.122.238"
$localPort = 8080
$keyPath = Join-Path $env:USERPROFILE ".ssh\context-reader-mainland_ed25519"
$forwardSpec = "127.0.0.1:${localPort}:127.0.0.1:8080"

if (-not (Test-Path -LiteralPath $keyPath)) {
  throw "SSH key not found: $keyPath"
}

$existing = Get-CimInstance Win32_Process -Filter "Name = 'ssh.exe'" | Where-Object {
  $_.CommandLine -like "*$serverIp*" -and $_.CommandLine -like "*$forwardSpec*"
}

if (-not $existing) {
  $arguments = @(
    "-N",
    "-L", $forwardSpec,
    "-i", $keyPath,
    "-o", "BatchMode=yes",
    "-o", "ExitOnForwardFailure=yes",
    "-o", "ServerAliveInterval=30",
    "-o", "ServerAliveCountMax=3",
    "ubuntu@$serverIp"
  )
  Start-Process -FilePath "ssh.exe" -ArgumentList $arguments -WindowStyle Hidden
}

$deadline = (Get-Date).AddSeconds(15)
do {
  Start-Sleep -Milliseconds 300
  $listener = Get-NetTCPConnection -LocalPort $localPort -State Listen -ErrorAction SilentlyContinue
} until ($listener -or (Get-Date) -ge $deadline)

if (-not $listener) {
  throw "SSH tunnel did not open localhost:$localPort"
}

Write-Output "Context Reader mainland shadow: http://127.0.0.1:$localPort"
