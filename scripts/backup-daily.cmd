@echo off
rem Daily production database backup.
rem
rem ASCII only, on purpose. cmd.exe reads .cmd files in the OEM codepage, not
rem UTF-8, so Cyrillic comments and variable names come out mangled and the
rem file stops working. The reasoning in Russian lives in backup-database.mjs,
rem where UTF-8 is safe; this wrapper stays plain.
rem
rem A separate file rather than a command inline in the task: nested quotes in
rem the /tr field get mangled on the first edit and the task silently stops
rem working. Here everything is visible and edits normally.
rem
rem No connection string here by design - railway run injects it, and the login
rem sits in the user profile. No password is stored in the task or on disk.
rem
rem Register (current user, daily at 04:00):
rem
rem   schtasks /create /tn "Warehouse Pro backup" /sc daily /st 04:00 /tr "\"%~f0\""
rem
rem Check:   schtasks /query  /tn "Warehouse Pro backup"
rem Run now: schtasks /run    /tn "Warehouse Pro backup"
rem Remove:  schtasks /delete /tn "Warehouse Pro backup" /f

setlocal
cd /d "%~dp0.."

rem Destination is deliberately outside the repository: the repository is
rem public and a dump must never land inside it. backup-database.mjs refuses
rem to write inside the repo as well, so this is the second lock, not the only.
if "%BACKUP_DIR%"==""  set "BACKUP_DIR=%USERPROFILE%\WarehousePro-backups"
if "%BACKUP_KEEP%"=="" set "BACKUP_KEEP=14"

if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"

call railway run --service MySQL-avuz node scripts/backup-database.mjs
set "RC=%ERRORLEVEL%"

rem The task runs with no window, so without this line a failed backup goes
rem unnoticed until the day it is needed.
echo %DATE% %TIME% exit=%RC% >> "%BACKUP_DIR%\backup.log"

exit /b %RC%
