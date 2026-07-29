param(
  [switch]$KeepRelease
)

$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$generatedTargets = @(
  'release',
  'tmp',
  'forge-bridge\forge-1.12.2\.gradle',
  'forge-bridge\forge-1.12.2\build',
  'forge-bridge\forge-1.12.2\run',
  'forge-bridge\forge-1.16.5\.gradle',
  'forge-bridge\forge-1.16.5\build',
  'forge-bridge\forge-1.18.2\.gradle',
  'forge-bridge\forge-1.18.2\build',
  'forge-bridge\forge-1.19.2\.gradle',
  'forge-bridge\forge-1.19.2\build',
  'forge-bridge\forge-1.20.1\.gradle',
  'forge-bridge\forge-1.20.1\build',
  'forge-bridge\forge-1.20.1\run'
)

foreach ($relativePath in $generatedTargets) {
  if ($KeepRelease -and $relativePath -eq 'release') {
    continue
  }
  $candidate = Join-Path $projectRoot $relativePath
  if (-not (Test-Path -LiteralPath $candidate)) {
    continue
  }

  $resolved = (Resolve-Path -LiteralPath $candidate).Path
  $insideProject = $resolved.StartsWith(
    $projectRoot + [IO.Path]::DirectorySeparatorChar,
    [StringComparison]::OrdinalIgnoreCase
  )
  if (-not $insideProject) {
    throw "Refusing to remove a path outside the project: $resolved"
  }

  Write-Host "Removing generated path: $resolved"
  Remove-Item -LiteralPath $resolved -Recurse -Force
}

if (-not $KeepRelease) {
  New-Item -ItemType Directory -Path (Join-Path $projectRoot 'release') -Force | Out-Null
}
Write-Host 'Generated files removed. Source files and forge-bridge/dist are preserved.'
