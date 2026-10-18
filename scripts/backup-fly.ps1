<#
.SYNOPSIS
  Pulls a complete backup of Thalath Space off Fly onto this machine.

.DESCRIPTION
  Fly takes its own daily volume snapshots, but they live on the same platform
  and only go back five days. This is the copy that survives losing the Fly
  account, the volume, or the region.

  Takes a consistent database snapshot first (VACUUM INTO, safe while the app
  is serving), tars it with the uploads, downloads it, then removes the
  temporary files from the server.

  NOTE: keep this file pure ASCII -- PowerShell 5.1 reads .ps1 as Windows-1252
  and a UTF-8 dash becomes a smart quote that breaks the parse.

.EXAMPLE
  .\scripts\backup-fly.ps1
  .\scripts\backup-fly.ps1 -App thalath-space -OutDir D:\backups
#>

[CmdletBinding()]
param(
  [string]$App    = 'thalath-space',
  [string]$OutDir = "$HOME\thalath-backups",
  [int]   $Keep   = 12
)

$ErrorActionPreference = 'Continue'

function Say  { param($m) Write-Host "`n> $m" -ForegroundColor Cyan }
function Note { param($m) Write-Host "  $m" }
function Die  { param($m) Write-Host "  x $m" -ForegroundColor Red; exit 1 }

if (-not (Get-Command fly -ErrorAction SilentlyContinue)) { Die 'flyctl not found on PATH.' }
fly auth whoami *>$null
if ($LASTEXITCODE -ne 0) { Die 'Not logged in. Run: fly auth login' }

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$stamp  = Get-Date -Format 'yyyy-MM-dd-HHmm'
$local  = Join-Path $OutDir "thalath-$stamp.tgz"

Say 'Taking a consistent database snapshot on the server'
fly ssh console -a $App -C "node /app/scripts/snapshot.js /data/_snapshot.db"
if ($LASTEXITCODE -ne 0) { Die 'Snapshot failed. Nothing was downloaded; the live data is untouched.' }

Say 'Packing the snapshot and the uploads'
fly ssh console -a $App -C "tar czf /data/_backup.tgz -C /data _snapshot.db uploads"
if ($LASTEXITCODE -ne 0) { Die 'Could not pack the backup on the server.' }

Say 'Downloading'
fly ssh sftp get /data/_backup.tgz "$local" -a $App
$downloaded = Test-Path $local

Say 'Cleaning up the server'
fly ssh console -a $App -C "rm -f /data/_snapshot.db /data/_backup.tgz" *>$null

if (-not $downloaded) { Die 'Download did not produce a file. Try again.' }
$size = (Get-Item $local).Length
if ($size -lt 1024) { Die "Downloaded file is only $size bytes -- that is not a real backup. Investigate before trusting it." }

Note "saved $local"
Note ("size  {0:N1} MB" -f ($size / 1MB))

# Keep the most recent N, so this can run unattended without filling the disk.
if ($Keep -gt 0) {
  $old = Get-ChildItem $OutDir -Filter 'thalath-*.tgz' | Sort-Object LastWriteTime -Descending | Select-Object -Skip $Keep
  if ($old) { $old | Remove-Item -Force; Note "pruned $($old.Count) older backup(s), keeping $Keep" }
}

Write-Host @"

  ------------------------------------------------
   Backup complete.
  ------------------------------------------------

  Inside the archive:
    _snapshot.db   the whole database -- accounts, messages, posts
    uploads/       every photo and song

  This is the copy that survives losing Fly. Keep at least one
  somewhere else again: another drive, or encrypted cloud storage.

  To inspect it:  tar tzf "$local" | Select-Object -First 20

"@ -ForegroundColor Green
