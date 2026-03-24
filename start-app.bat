@echo off
setlocal

cd /d "%~dp0"
set "AGENTSYNC_DISPLAY_INDEX=2"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or not in PATH.
  echo Install Node.js 20+ and try again.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [SETUP] Installing npm packages...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
)

echo [SETUP] Releasing stale local ports if needed...
for %%P in (3847 5175) do (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$port=%%P; $procIds = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; foreach($procId in $procIds){ $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue; if($proc -and ($proc.ProcessName -match '^(node|electron)$')) { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue; Write-Host ('[SETUP] Released port ' + $port + ' from PID ' + $procId); } }"
)

echo [SETUP] Initializing database...
call npm run db:init
if errorlevel 1 (
  echo [ERROR] Database initialization failed.
  pause
  exit /b 1
)

echo [START] Launching Hydra (Autofill fix applied)...
call npm run dev

if errorlevel 1 (
  echo [ERROR] Hydra exited with an error.
  pause
  exit /b 1
)
