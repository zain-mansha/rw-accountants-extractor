@echo off
setlocal
title "R&W Accountants Extractor - Checking for updates"
set "ELECTRON_RUN_AS_NODE="
if defined LOCALAPPDATA (set "LOGDIR=%LOCALAPPDATA%\Extractor\Logs") else (set "LOGDIR=%TEMP%\Extractor-Logs")
if not exist "%LOGDIR%" mkdir "%LOGDIR%" >nul 2>&1
set "LOG=%LOGDIR%\Start Extractor from Network.log"
>"%LOG%" echo Extractor network launcher started at %DATE% %TIME%.
echo Checking for Extractor updates before launch.
set "FARE_EXTRACTOR_NETWORK_ROOT=%~dp0"
pushd "%~dp0" >nul 2>&1
if errorlevel 1 (
  echo Extractor could not open its shared folder. Check that the network location is available and you have read access.
  >>"%LOG%" echo Extractor could not open the shared folder: %~dp0
  type "%LOG%"
  echo Error details saved to "%LOG%".
  if not "%FARE_EXTRACTOR_NO_PAUSE%"=="1" pause
  exit /b 1
)
if "%FARE_EXTRACTOR_NO_PAUSE%"=="1" (
  powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%CD%\Start Extractor from Network.ps1" %* 2>>"%LOG%"
) else (
  powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%CD%\Start Extractor from Network.ps1" %* >>"%LOG%" 2>&1
)
set "RESULT=%ERRORLEVEL%"
popd
if not "%FARE_EXTRACTOR_NO_PAUSE%"=="1" if "%RESULT%"=="0" (
  findstr /I /C:"Extractor is running (process ID" /C:"EXTRACTOR_UPDATE_RESTART_COMPLETE:" /C:"Shared application files are ready." /C:"The local application copy is ready." "%LOG%" >nul
  if errorlevel 1 set "RESULT=1"
)
if not "%RESULT%"=="0" (
  echo Extractor did not confirm that the local application opened. The complete startup output follows.
  type "%LOG%"
  echo Full error details saved to "%LOG%".
  if not "%FARE_EXTRACTOR_NO_PAUSE%"=="1" pause
)
exit /b %RESULT%
