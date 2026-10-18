<#
.SYNOPSIS
  Deploys Thalath Space to Fly.io from Windows. Safe to re-run — it is also
  the command to ship an update.

.DESCRIPTION
  Does the whole sequence in the right order, which matters: the storage
  volume must exist BEFORE the first deploy, or the app comes up writing its
  database to a disk that is wiped on the next deploy. Afterwards it pins the
  app to a single machine, because all state is one SQLite file and two
  machines sharing it would corrupt it.

  Requires: flyctl installed, and `fly auth login` already done.

.EXAMPLE
  .\scripts\deploy-fly.ps1

.EXAMPLE
  .\scripts\deploy-fly.ps1 -App thalath-space-fk -Region ams
#>

[CmdletBinding()]
param(
  [string]$App       = 'thalath-space',
  [string]$Region    = 'ams',
  [string]$Volume    = 'thalath_data',
  [int]   $VolumeGb  = 3
)

$ErrorActionPreference = 'Stop'

function Say  { param($m) Write-Host "`n> $m" -ForegroundColor Cyan }
function Note { param($m) Write-Host "  $m" }
function Warn { param($m) Write-Host "  ! $m" -ForegroundColor Yellow }
function Die  { param($m) Write-Host "  x $m" -ForegroundColor Red; exit 1 }

# ------------------------------------------------------------------ preflight
if (-not (Test-Path 'fly.toml')) {
  Die "Run this from the repository root (no fly.toml in $(Get-Location))."
}

if (-not (Get-Command fly -ErrorAction SilentlyContinue)) {
  Die @"
flyctl is not installed, or PowerShell has not picked it up yet.
    Install:  iwr https://fly.io/install.ps1 -useb | iex
    Then CLOSE AND REOPEN PowerShell and run this again.
"@
}

Say 'Checking you are logged in to Fly'
$who = (fly auth whoami 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0) { Die "Not logged in. Run:  fly auth login" }
Note "authenticated as $who"

# ----------------------------------------------------------------------- app
Say "Checking app '$App'"
fly status -a $App *>$null
if ($LASTEXITCODE -eq 0) {
  Note "app already exists"
} else {
  Note "creating it"
  fly apps create $App --org personal
  if ($LASTEXITCODE -ne 0) {
    Die @"
Could not create '$App'. Fly app names are globally unique, so it is
    probably taken. Pick another and pass it in, for example:
        .\scripts\deploy-fly.ps1 -App $App-fk
"@
  }
}

# -------------------------------------------------------------------- volume
# The one step that must not be skipped, and the one this script will never
# undo: it holds the database and every uploaded photo and song.
Say "Checking volume '$Volume'"
$vols = (fly volumes list -a $App 2>&1 | Out-String)
if ($vols -match [regex]::Escape($Volume)) {
  Note "volume already exists; leaving it alone"
} else {
  Note "creating ${VolumeGb}GB volume in $Region"
  fly volumes create $Volume --region $Region --size $VolumeGb --yes -a $App
  if ($LASTEXITCODE -ne 0) { Die "Could not create the volume. Stopping before deploy, deliberately." }
}

# -------------------------------------------------------------------- deploy
Say 'Building and deploying (first run takes a few minutes)'
fly deploy --remote-only --ha=false -a $App
if ($LASTEXITCODE -ne 0) { Die "Deploy failed. Scroll up for the build error, or run:  fly logs -a $App" }

Say 'Pinning to a single machine (SQLite cannot be shared)'
fly scale count 1 --yes -a $App

# -------------------------------------------------------------------- verify
$Url = "https://$App.fly.dev"
Say 'Waiting for the health check'
$healthy = $false
foreach ($i in 1..40) {
  try {
    $r = Invoke-WebRequest -Uri "$Url/healthz" -TimeoutSec 5 -UseBasicParsing
    if ($r.Content.Trim() -eq 'ok') { $healthy = $true; break }
  } catch { Start-Sleep -Seconds 3 }
}
if (-not $healthy) {
  Warn 'Never came up. Last 40 log lines:'
  fly logs -a $App --no-tail | Select-Object -Last 40
  Die 'Deploy finished but the app is not answering.'
}
Note "$Url/healthz -> ok"

Say 'Checking it is locked down'
try {
  Invoke-WebRequest -Uri "$Url/uploads/probe.png" -TimeoutSec 10 -UseBasicParsing | Out-Null
  Warn 'uploads are readable when logged out — expected 404'
} catch {
  # PowerShell 5.1 exposes the numeric code as .value__; PowerShell 7 gives an enum.
  $sc = $null
  try { $sc = [int]$_.Exception.Response.StatusCode } catch {}
  if ($sc -eq 404) {
    Note 'uploads require a session (404 when logged out)'
  } elseif ($sc) {
    Warn "unexpected response from /uploads: $sc (expected 404)"
  } else {
    Warn 'could not reach /uploads to check it is private'
  }
}
try {
  $h = Invoke-WebRequest -Uri "$Url/" -TimeoutSec 10 -UseBasicParsing
  if ($h.Headers['Strict-Transport-Security']) { Note 'HSTS present' } else { Warn 'HSTS header missing' }
} catch { Warn 'could not read headers from the home page' }

# ------------------------------------------------------------------ password
Say "Looking for Tom's first-run password"
$logs = (fly logs -a $App --no-tail 2>&1 | Out-String)
if ($logs -match 'password:\s*(\S+)') {
  Note "username: tom"
  Note "password: $($Matches[1])"
  Note "(printed once, on first boot only — save it now)"
} else {
  Note "Not in the recent logs. If this was not the first deploy, you already have it."
  Note "Otherwise:  fly logs -a $App --no-tail | Select-String -Context 0,5 'First run'"
}

Write-Host @"

  ------------------------------------------------
   Thalath Space is live:  $Url
  ------------------------------------------------

  Next:
    1. Log in as tom
    2. Go to /admin, generate invite codes, send the copy-links
    3. On your phone: open the URL, Add to Home Screen, open it
       from the icon, then Settings -> turn on notifications

  To ship an update later, just run this script again.

"@ -ForegroundColor Green
