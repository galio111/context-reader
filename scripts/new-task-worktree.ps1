[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-z0-9][a-z0-9_-]{1,48}$')]
  [string]$TaskName,

  [string]$BaseRef = 'HEAD',

  [string]$Destination = ''
)

$ErrorActionPreference = 'Stop'

$repoRoot = (& git rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0 -or -not $repoRoot) {
  throw 'This command must run inside the Context Reader Git repository.'
}
$repoRoot = [IO.Path]::GetFullPath($repoRoot)
$worktreeRoot = [IO.Path]::GetFullPath((Join-Path $repoRoot 'artifacts\task-worktrees'))
$destinationPath = if ($Destination) {
  [IO.Path]::GetFullPath($Destination)
} else {
  [IO.Path]::GetFullPath((Join-Path $worktreeRoot $TaskName))
}
$allowedPrefix = $worktreeRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if (-not $destinationPath.StartsWith($allowedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Task worktrees must stay below $worktreeRoot"
}
if (Test-Path -LiteralPath $destinationPath) {
  throw "Task worktree destination already exists: $destinationPath"
}

$branch = "codex/$TaskName"
& git show-ref --verify --quiet "refs/heads/$branch"
if ($LASTEXITCODE -eq 0) {
  throw "Task branch already exists: $branch"
}
$baseCommit = (& git rev-parse --verify "$BaseRef`^{commit}").Trim()
if ($LASTEXITCODE -ne 0 -or -not $baseCommit) {
  throw "Base ref does not resolve to a commit: $BaseRef"
}

$parent = Split-Path -Parent $destinationPath
if (-not (Test-Path -LiteralPath $parent)) {
  New-Item -ItemType Directory -Path $parent | Out-Null
}
& git worktree add -b $branch $destinationPath $baseCommit
if ($LASTEXITCODE -ne 0) {
  throw "Git could not create task worktree $branch"
}

[pscustomobject]@{
  task = $TaskName
  branch = $branch
  baseRevision = $baseCommit
  worktree = $destinationPath
  nextRule = 'Commit in this worktree before handoff; merge or cherry-pick the commit into production integration.'
} | ConvertTo-Json
