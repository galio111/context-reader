[CmdletBinding()]
param(
  [ValidateRange(1, 8760)]
  [int]$MinAgeHours = 24,

  [string]$MergedInto = 'origin/main',

  [switch]$IncludeUnmerged,

  [ValidateRange(0, 500)]
  [int]$TargetCount = 0,

  [switch]$Apply
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
$allowedPrefix = $worktreeRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar

$mergedCommit = (& git rev-parse --verify "$MergedInto`^{commit}").Trim()
if ($LASTEXITCODE -ne 0 -or -not $mergedCommit) {
  throw "Merged-into ref does not resolve to a commit: $MergedInto"
}

if (-not (Test-Path -LiteralPath $worktreeRoot -PathType Container)) {
  [pscustomobject]@{
    mode = if ($Apply) { 'apply' } else { 'audit' }
    mergedInto = $MergedInto
    mergedRevision = $mergedCommit
    minAgeHours = $MinAgeHours
    summary = [pscustomobject]@{
      registered = 0
      candidates = 0
      removed = 0
      dirty = 0
      unmerged = 0
      tooRecent = 0
      locked = 0
      orphanDirectories = 0
    }
    candidates = @()
    retained = @()
    orphanDirectories = @()
  } | ConvertTo-Json -Depth 6
  exit 0
}

$registeredByPath = @{}
$currentRecord = $null
$worktreeLines = @(& git -C $repoRoot worktree list --porcelain)
if ($LASTEXITCODE -ne 0) {
  throw 'Unable to list Git worktrees.'
}
foreach ($line in $worktreeLines) {
  if ($line.StartsWith('worktree ', [StringComparison]::Ordinal)) {
    $recordPath = [IO.Path]::GetFullPath($line.Substring(9).Trim())
    $currentRecord = [pscustomobject]@{
      path = $recordPath
      locked = $false
    }
    $registeredByPath[$recordPath] = $currentRecord
    continue
  }
  if ($currentRecord -and $line.StartsWith('locked', [StringComparison]::Ordinal)) {
    $currentRecord.locked = $true
  }
}

$now = Get-Date
$candidates = @()
$retained = @()
$orphans = @()

foreach ($directory in Get-ChildItem -LiteralPath $worktreeRoot -Directory -Force) {
  $path = [IO.Path]::GetFullPath($directory.FullName)
  if (-not $path.StartsWith($allowedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing path outside the task-worktree root: $path"
  }

  $record = $registeredByPath[$path]
  if (-not $record) {
    $orphans += [pscustomobject]@{
      name = $directory.Name
      path = $path
      ageHours = [math]::Round(($now - $directory.LastWriteTime).TotalHours, 1)
      reason = 'Directory is not registered as a Git worktree; inspect manually.'
    }
    continue
  }

  $status = @(& git -C $path status --porcelain=v1 --untracked-files=normal 2>$null)
  $statusOk = $LASTEXITCODE -eq 0
  $dirty = -not $statusOk -or @($status | Where-Object { $_ }).Count -gt 0
  $head = (& git -C $path rev-parse HEAD 2>$null | Select-Object -First 1)
  if ($head) {
    $head = $head.Trim()
  }
  $branch = (& git -C $path branch --show-current 2>$null | Select-Object -First 1)
  if ($branch) {
    $branch = $branch.Trim()
  } else {
    $branch = '(detached)'
  }
  $merged = $false
  if ($head) {
    & git -C $repoRoot merge-base --is-ancestor $head $mergedCommit 2>$null
    $merged = $LASTEXITCODE -eq 0
  }
  $ageHours = [math]::Round(($now - $directory.LastWriteTime).TotalHours, 1)
  $tooRecent = $ageHours -lt $MinAgeHours
  $isCurrent = $path.Equals($currentWorktree, [StringComparison]::OrdinalIgnoreCase)

  $reasons = @()
  if ($isCurrent) { $reasons += 'current worktree' }
  if ($record.locked) { $reasons += 'locked' }
  if ($dirty) { $reasons += 'dirty' }
  if ($branch -eq '(detached)') { $reasons += 'detached HEAD has no durable branch' }
  if (-not $merged -and -not $IncludeUnmerged) { $reasons += "not merged into $MergedInto" }
  if ($tooRecent) { $reasons += "younger than $MinAgeHours hours" }

  $item = [pscustomobject]@{
    name = $directory.Name
    path = $path
    branch = $branch
    head = $head
    ageHours = $ageHours
    clean = -not $dirty
    merged = $merged
    locked = $record.locked
    current = $isCurrent
    reasons = $reasons
  }
  if ($reasons.Count -eq 0) {
    $candidates += $item
  } else {
    $retained += $item
  }
}

$candidates = @($candidates | Sort-Object ageHours -Descending)
$selectedCandidates = $candidates
if ($TargetCount -gt 0) {
  $registeredCount = $candidates.Count + $retained.Count
  $removalCount = [math]::Max(0, $registeredCount - $TargetCount)
  $selectedCandidates = @($candidates | Select-Object -First $removalCount)
}

$removed = @()
if ($Apply) {
  foreach ($item in $selectedCandidates) {
    $path = [IO.Path]::GetFullPath($item.path)
    if (-not $path.StartsWith($allowedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing removal outside the task-worktree root: $path"
    }
    $status = @(& git -C $path status --porcelain=v1 --untracked-files=normal 2>$null)
    if ($LASTEXITCODE -ne 0 -or @($status | Where-Object { $_ }).Count -gt 0) {
      throw "Worktree changed after audit and is no longer clean: $path"
    }
    if (-not $IncludeUnmerged) {
      $head = (& git -C $path rev-parse HEAD).Trim()
      & git -C $repoRoot merge-base --is-ancestor $head $mergedCommit
      if ($LASTEXITCODE -ne 0) {
        throw "Worktree changed after audit and is no longer merged into ${MergedInto}: $path"
      }
    }

    Write-Host "Removing old clean worktree (branch retained): $($item.name)"
    & git -C $repoRoot -c core.longpaths=true worktree remove $path
    if ($LASTEXITCODE -ne 0) {
      throw "Git could not remove task worktree: $path"
    }
    $removed += $item
  }
  & git -C $repoRoot worktree prune --expire now
  if ($LASTEXITCODE -ne 0) {
    throw 'Git worktree metadata pruning failed.'
  }
}

[pscustomobject]@{
  mode = if ($Apply) { 'apply' } else { 'audit' }
  mergedInto = $MergedInto
  mergedRevision = $mergedCommit
  minAgeHours = $MinAgeHours
  includeUnmerged = [bool]$IncludeUnmerged
  targetCount = $TargetCount
  summary = [pscustomobject]@{
    registered = $candidates.Count + $retained.Count
    candidates = $candidates.Count
    selected = $selectedCandidates.Count
    removed = $removed.Count
    dirty = @($retained | Where-Object { -not $_.clean }).Count
    unmerged = @($retained | Where-Object { -not $_.merged }).Count
    tooRecent = @($retained | Where-Object { $_.ageHours -lt $MinAgeHours }).Count
    locked = @($retained | Where-Object { $_.locked }).Count
    orphanDirectories = $orphans.Count
  }
  candidates = $candidates
  selectedCandidates = $selectedCandidates
  removed = $removed
  retained = $retained
  orphanDirectories = $orphans
} | ConvertTo-Json -Depth 6
