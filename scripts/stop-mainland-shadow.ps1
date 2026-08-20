$ErrorActionPreference = "Stop"

$serverIp = "43.143.122.238"
$forwardSpec = "127.0.0.1:8080:127.0.0.1:8080"
$tunnels = Get-CimInstance Win32_Process -Filter "Name = 'ssh.exe'" | Where-Object {
  $_.CommandLine -like "*$serverIp*" -and $_.CommandLine -like "*$forwardSpec*"
}

if (-not $tunnels) {
  Write-Output "No Context Reader mainland shadow tunnel is running."
  exit 0
}

$tunnels | ForEach-Object { Stop-Process -Id $_.ProcessId }
Write-Output "Context Reader mainland shadow tunnel stopped."
