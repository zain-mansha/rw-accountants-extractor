@echo off
setlocal
set ELECTRON_RUN_AS_NODE=
start "Extractor" "%~dp0release\Extractor\Extractor.exe"
