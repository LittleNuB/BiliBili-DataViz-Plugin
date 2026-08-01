param(
  [string]$Version = '0.13.0-alpha'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression

function Get-FileHashMap {
  param([Parameter(Mandatory = $true)][string]$Root)

  $normalizedRoot = [IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar)
  $result = @{}
  Get-ChildItem -LiteralPath $normalizedRoot -Recurse -File | ForEach-Object {
    $relativePath = $_.FullName.Substring($normalizedRoot.Length + 1).Replace([IO.Path]::DirectorySeparatorChar, '/')
    $result[$relativePath] = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash
  }
  return $result
}

function New-DeterministicZip {
  param(
    [Parameter(Mandatory = $true)][string]$SourceRoot,
    [Parameter(Mandatory = $true)][string]$DestinationPath
  )

  $normalizedRoot = [IO.Path]::GetFullPath($SourceRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)
  $files = @(Get-ChildItem -LiteralPath $normalizedRoot -Recurse -File | Sort-Object FullName)
  $fixedTimestamp = [DateTimeOffset]::new(2026, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
  $zipStream = [IO.File]::Open($DestinationPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
  try {
    $archive = [IO.Compression.ZipArchive]::new($zipStream, [IO.Compression.ZipArchiveMode]::Create, $false)
    try {
      foreach ($file in $files) {
        $relativePath = $file.FullName.Substring($normalizedRoot.Length + 1).Replace([IO.Path]::DirectorySeparatorChar, '/')
        $entry = $archive.CreateEntry($relativePath, [IO.Compression.CompressionLevel]::Optimal)
        $entry.LastWriteTime = $fixedTimestamp
        $sourceStream = [IO.File]::OpenRead($file.FullName)
        try {
          $entryStream = $entry.Open()
          try {
            $sourceStream.CopyTo($entryStream)
          }
          finally {
            $entryStream.Dispose()
          }
        }
        finally {
          $sourceStream.Dispose()
        }
      }
    }
    finally {
      $archive.Dispose()
    }
  }
  finally {
    $zipStream.Dispose()
  }
}

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$distRoot = [IO.Path]::GetFullPath((Join-Path $repositoryRoot 'dist'))
$artifactRoot = [IO.Path]::GetFullPath((Join-Path $repositoryRoot 'release-artifacts'))
$zipName = "bili-bill-$Version.zip"
$zipPath = Join-Path $artifactRoot $zipName
$shaPath = "$zipPath.sha256"

if (-not (Test-Path -LiteralPath (Join-Path $distRoot 'manifest.json') -PathType Leaf)) {
  throw 'dist/manifest.json is missing. Run npm run build first.'
}

New-Item -ItemType Directory -Force -Path $artifactRoot | Out-Null
if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath
}
if (Test-Path -LiteralPath $shaPath) {
  Remove-Item -LiteralPath $shaPath
}

New-DeterministicZip -SourceRoot $distRoot -DestinationPath $zipPath
$zipHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $zipPath).Hash.ToLowerInvariant()
[IO.File]::WriteAllText(
  $shaPath,
  "$zipHash  $zipName`n",
  [Text.UTF8Encoding]::new($false)
)

$systemTempRoot = [IO.Path]::GetFullPath($env:TEMP).TrimEnd([IO.Path]::DirectorySeparatorChar)
$auditRoot = [IO.Path]::GetFullPath(
  (Join-Path $systemTempRoot ("bili-bill-release-audit-" + [guid]::NewGuid().ToString('N')))
)
if (-not $auditRoot.StartsWith($systemTempRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to create an audit directory outside the system temp root: $auditRoot"
}

New-Item -ItemType Directory -Path $auditRoot | Out-Null
try {
  [IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $auditRoot)
  $distMap = Get-FileHashMap -Root $distRoot
  $zipMap = Get-FileHashMap -Root $auditRoot

  if ($distMap.Count -ne $zipMap.Count) {
    throw "ZIP file count mismatch: dist=$($distMap.Count), zip=$($zipMap.Count)"
  }

  foreach ($relativePath in $distMap.Keys) {
    if (-not $zipMap.ContainsKey($relativePath)) {
      throw "ZIP is missing $relativePath"
    }
    if ($zipMap[$relativePath] -ne $distMap[$relativePath]) {
      throw "ZIP hash mismatch for $relativePath"
    }
  }

  $requiredPaths = @(
    'manifest.json',
    'LICENSE.txt',
    'THIRD_PARTY_NOTICES.txt',
    'third_party_licenses/Apache-2.0.txt',
    'third_party_licenses/BSD-3-Clause-d3.txt',
    'third_party_licenses/MIT-wordcloud2.txt'
  )
  foreach ($relativePath in $requiredPaths) {
    if (-not $zipMap.ContainsKey($relativePath)) {
      throw "Required release file is missing: $relativePath"
    }
  }

  $forbiddenPaths = @(
    $zipMap.Keys | Where-Object {
      $_ -match '^(dist/|node_modules/|src/|tests/|\.git/)' -or
      $_ -match '(?i)(cookie|profile|login-state|key\.txt|\.pem$)'
    }
  )
  if ($forbiddenPaths.Count -gt 0) {
    throw "Forbidden ZIP entries: $($forbiddenPaths -join ', ')"
  }

  [PSCustomObject]@{
    zip = $zipPath
    sha256 = $zipHash
    bytes = (Get-Item -LiteralPath $zipPath).Length
    files = $zipMap.Count
  } | ConvertTo-Json -Compress
}
finally {
  $resolvedAuditRoot = [IO.Path]::GetFullPath($auditRoot)
  if ($resolvedAuditRoot.StartsWith($systemTempRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $resolvedAuditRoot -Recurse -Force
  }
}
