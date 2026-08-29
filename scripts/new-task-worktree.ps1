[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-z0-9][a-z0-9_-]{1,48}$')]
  [string]$TaskName,

  [string]$BaseRef = 'HEAD',

  [string]$Destination = '',

  [ValidateRange(1, 8760)]
  [int]$CleanupMinAgeHours = 24,

  [ValidateRange(1, 1024)]
  [int]$MinimumFreeGB = 20,

  [ValidateRange(1, 500)]
  [int]$MaximumTaskWorktrees = 12,

  [ValidateRange(0, 499)]
  [int]$CleanupTargetWorktrees = 8,

  [switch]$BypassRetentionGuard
)

$ErrorActionPreference = 'Stop'

$currentWorktree = (& git rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0 -or -not $currentWorktree) {
  throw 'This command must run inside the Context Reader Git repository.'
}
$currentWorktree = [IO.Path]::GetFullPath($currentWorktree)
$commonGitDir = (& git rev-parse --git-common-dir).Trim()
if ($LASTEXITCODE -ne 0 -or -not $commonGitDir) {
  throw 'Unable to resolve the shared Context Reader Git directory.'
}
if (-not [IO.Path]::IsPathRooted($commonGitDir)) {
  $commonGitDir = Join-Path $currentWorktree $commonGitDir
}
$commonGitDir = [IO.Path]::GetFullPath($commonGitDir)
$repoRoot = [IO.Path]::GetFullPath((Split-Path -Parent $commonGitDir))
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

$retention = $null
if (-not $BypassRetentionGuard) {
  $scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
  $cleanupScript = Join-Path $scriptRoot 'cleanup-task-worktrees.ps1'
  if (-not (Test-Path -LiteralPath $cleanupScript -PathType Leaf)) {
    throw "Missing task-worktree cleanup script: $cleanupScript"
  }
  if ($CleanupTargetWorktrees -ge $MaximumTaskWorktrees) {
    throw 'CleanupTargetWorktrees must be lower than MaximumTaskWorktrees.'
  }
  $taskWorktreeCountBefore = if (Test-Path -LiteralPath $worktreeRoot -PathType Container) {
    @(Get-ChildItem -LiteralPath $worktreeRoot -Directory -Force).Count
  } else {
    0
  }
  $cleanupArguments = @{
    Apply = $true
    MinAgeHours = $CleanupMinAgeHours
    MergedInto = 'origin/main'
  }
  if ($taskWorktreeCountBefore -ge $MaximumTaskWorktrees) {
    $cleanupArguments.IncludeUnmerged = $true
    $cleanupArguments.TargetCount = $CleanupTargetWorktrees
  }
  $cleanupJson = (& $cleanupScript @cleanupArguments | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) {
    throw 'Safe task-worktree cleanup failed; no new worktree was created.'
  }
  $cleanupResult = $cleanupJson | ConvertFrom-Json

  $taskWorktreeCount = if (Test-Path -LiteralPath $worktreeRoot -PathType Container) {
    @(Get-ChildItem -LiteralPath $worktreeRoot -Directory -Force).Count
  } else {
    0
  }
  $driveRoot = [IO.Path]::GetPathRoot($worktreeRoot)
  $freeGB = [math]::Round(([IO.DriveInfo]::new($driveRoot).AvailableFreeSpace / 1GB), 2)
  $retention = [pscustomobject]@{
    autoRemoved = $cleanupResult.summary.removed
    orphanDirectories = $cleanupResult.summary.orphanDirectories
    taskWorktreeCount = $taskWorktreeCount
    freeGB = $freeGB
    minimumFreeGB = $MinimumFreeGB
    maximumTaskWorktrees = $MaximumTaskWorktrees
    cleanupTargetWorktrees = $CleanupTargetWorktrees
  }
  if ($freeGB -lt $MinimumFreeGB) {
    throw "Only $freeGB GB is free on $driveRoot after safe cleanup; at least $MinimumFreeGB GB is required before creating another task worktree."
  }
  if ($taskWorktreeCount -ge $MaximumTaskWorktrees) {
    throw "There are still $taskWorktreeCount task-worktree directories after safe cleanup; the hard limit is $MaximumTaskWorktrees. Recent, dirty, locked, current, or orphan directories require review before creating another."
  }
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
  retention = $retention
  nextRule = 'Commit before handoff. New task creation keeps at most 12 task directories and, when the cap is reached, removes the oldest clean worktrees older than 24 hours until 8 remain. Branches and commits are retained.'
} | ConvertTo-Json
