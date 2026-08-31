# Daily off-site backup of the production database.
#
# ASCII only, on purpose. Windows PowerShell 5.1 reads .ps1 files in the ANSI
# codepage unless they carry a BOM, so Cyrillic identifiers turn into mojibake
# and the file stops parsing. The same trap had already broken the .cmd wrapper
# before this one. The reasoning in Russian lives in backup-database.mjs, where
# UTF-8 is safe; the wrappers stay plain.
#
# Why PowerShell and not .cmd: under the scheduler the batch wrapper could not
# resolve railway.cmd through PATH, and `if exist` kept failing on a path the
# same script printed correctly into its own log. Chasing that is more
# expensive than not depending on it.
#
# No connection string here: `railway run` injects it and the login sits in the
# user profile. Nothing is stored on disk or in the task.
#
# Register:
#   $a = New-ScheduledTaskAction -Execute "powershell.exe" `
#        -Argument '-NoProfile -ExecutionPolicy Bypass -File "<path>\backup-daily.ps1"'
#   Register-ScheduledTask -TaskName "Warehouse Pro backup" -Action $a `
#        -Trigger (New-ScheduledTaskTrigger -Daily -At 4:00am) -Force

# The child process prints UTF-8; PowerShell 5.1 decodes it in the console
# codepage and the log fills with mojibake. Unreadable diagnostics are the same
# as no diagnostics, and this log exists to be read on the day a backup failed.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root   = Split-Path -Parent $PSScriptRoot
$dir    = if ($env:BACKUP_DIR) { $env:BACKUP_DIR } else { Join-Path $env:USERPROFILE "WarehousePro-backups" }
$logSql = Join-Path $dir "backup.log"

if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

function Write-Log($text) {
  Add-Content -Path $logSql -Value $text -Encoding utf8
}

Write-Log ""
Write-Log "===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ====="

# railway is located by trying known paths. Under the scheduler the environment
# is reduced and resolving the bare name through PATH does not work - verified,
# it fails with "not recognized" even when the directory is prepended.
$candidates = @(
  (Join-Path $env:APPDATA "npm\railway.cmd"),
  (Join-Path $env:USERPROFILE "AppData\Roaming\npm\railway.cmd")
)
$railway = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

if (-not $railway) {
  Write-Log "railway.cmd not found. Tried: $($candidates -join ' | ')"
  # What the task can actually see. Under the scheduler Test-Path returned
  # false for a path that exists in an interactive session, so the listing
  # settles whether the directory is unreadable or simply not there.
  $npm = Join-Path $env:APPDATA "npm"
  Write-Log "whoami: $(whoami)"
  Write-Log "npm dir exists: $(Test-Path $npm)"
  if (Test-Path $npm) {
    Write-Log "contents: $((Get-ChildItem $npm -Filter 'railway*' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name) -join ', ')"
  }
  exit 1
}
Write-Log "railway: $railway"

Push-Location $root
try {
  # 2>&1 folds the error stream into output: railway writes part of its
  # messages there, and without this the reason for a failure never reaches
  # the log - which is the whole point of having one.
  $output = & $railway run --service MySQL-avuz node scripts/backup-database.mjs 2>&1
  $code = $LASTEXITCODE
} finally {
  Pop-Location
}

$output | ForEach-Object { Write-Log $_ }
Write-Log "----- exit code: $code"

exit $code
