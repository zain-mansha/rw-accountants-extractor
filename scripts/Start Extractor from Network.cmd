@echo off
setlocal
title "R&W Accountants Extractor - Checking shared updates"
set "ELECTRON_RUN_AS_NODE="
echo Checking the latest Extractor application files on the shared network...
pushd "%~dp0" >nul 2>&1
if errorlevel 1 (
  echo Extractor could not open its shared folder. Check that the network location is available and you have read access.
  pause
  exit /b 1
)
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%CD%\Start Extractor from Network.ps1" %*
set "RESULT=%ERRORLEVEL%"
popd
if not "%RESULT%"=="0" (
  echo Extractor could not be installed or started. Read the error above, then ask your administrator if access is blocked.
  pause
)
exit /b %RESULT%
