param(
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'Programs\Extractor'),
  [string]$ProfileRoot = (Join-Path $env:LOCALAPPDATA 'Extractor\Profiles'),
  [switch]$NoLaunch
)

$ErrorActionPreference = 'Stop'
$source = [IO.Path]::GetFullPath($PSScriptRoot)
$localAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
if ([string]::IsNullOrWhiteSpace($localAppData)) {
  throw 'Windows did not provide a local application-data folder for this account.'
}
$buildFile = Join-Path $source 'network-build.txt'
if (-not (Test-Path -LiteralPath $buildFile -PathType Leaf)) {
  throw 'The shared Extractor package is missing network-build.txt. Rebuild it with the network packaging command.'
}
$buildId = (Get-Content -LiteralPath $buildFile -Raw).Trim()
if ($buildId -notmatch '^\d+\.\d+\.\d+-[a-f0-9]{12}$') {
  throw 'The shared Extractor build marker is invalid.'
}

$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$target = Join-Path $InstallRoot $buildId
$executable = Join-Path $target 'Extractor.exe'
$rootPrefix = $InstallRoot.TrimEnd('\') + '\'
if (-not $target.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'The local Extractor install path is outside the selected install folder.'
}
$requiredFiles = @(
  'Extractor.exe', 'icudtl.dat', 'resources.pak', 'snapshot_blob.bin',
  'resources\app\main.cjs', 'resources\app\package.json',
  'resources\app\index.html', 'resources\app\parser.js',
  'resources\app\styles.css', 'resources\app\vendor\xlsx.full.min.js',
  'resources\app\ocr-helper.ps1', 'resources\app\ocr-requirement.json',
  'resources\app\build-info.json'
)
$installIsComplete = {
  param([string]$Directory)
  foreach ($relative in $requiredFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $Directory $relative) -PathType Leaf)) { return $false }
  }
  return $true
}

function Get-ExtractorOcrLanguages {
  try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime -ErrorAction Stop
    $ocrType = [Windows.Media.Ocr.OcrEngine,Windows.Media.Ocr,ContentType=WindowsRuntime]
    return @($ocrType::AvailableRecognizerLanguages | ForEach-Object { [string]$_.LanguageTag })
  } catch {
    return @()
  }
}

function Ensure-ExtractorEnglishOcr {
  $requirementPath = Join-Path $source 'resources\app\ocr-requirement.json'
  if (-not (Test-Path -LiteralPath $requirementPath -PathType Leaf)) {
    throw 'The network package is missing its Windows OCR requirement. Copy the complete updated Extractor package.'
  }
  $requirement = Get-Content -LiteralPath $requirementPath -Raw | ConvertFrom-Json
  $language = [string]$requirement.language
  $capability = [string]$requirement.capability
  if ($language -ne 'en-GB' -or $capability -ne 'Language.OCR~~~en-GB~0.0.1.0' -or $requirement.versionPolicy -ne 'windows-managed') {
    throw 'The Windows OCR requirement is invalid. Copy the complete updated Extractor package.'
  }

  if ((Get-ExtractorOcrLanguages) -contains $language) {
    Write-Host "Windows OCR is ready ($language; using the version managed by this PC)."
    return $true
  }

  Write-Host "Preparing the best en-GB Windows OCR capability available for this PC. Windows selects a compatible package from this PC's version and configured Features on Demand source. This may require administrator approval and Windows Update access."
  $powerShellExecutable = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  if ([Environment]::Is64BitOperatingSystem -and -not [Environment]::Is64BitProcess) {
    $powerShellExecutable = Join-Path $env:SystemRoot 'Sysnative\WindowsPowerShell\v1.0\powershell.exe'
  }
  $exitCode = -1
  $installError = ''
  $installOutput = ''
  $repairLog = ''
  $repairScript = ''
  $repairConfig = ''
  try {
    $repairId = [guid]::NewGuid().ToString('N')
    $repairScript = Join-Path $env:TEMP "extractor-ocr-setup-$repairId.ps1"
    $repairConfig = Join-Path $env:TEMP "extractor-ocr-setup-$repairId.json"
    $repairLog = Join-Path $env:TEMP "extractor-ocr-setup-$repairId.log"
    $repairSettings = @{
      capability = $capability
      logPath = $repairLog
    } | ConvertTo-Json
    $repairPowerShell = @'
param()
$ErrorActionPreference = 'Stop'
$settings = Get-Content -LiteralPath (Join-Path $PSScriptRoot '__SETTINGS_FILE__') -Raw | ConvertFrom-Json
$capabilityName = [string]$settings.capability
$logPath = [string]$settings.logPath
try {
  $ocrCapabilities = @(Get-WindowsCapability -Online -ErrorAction Stop | Where-Object { $_.Name -like 'Language.OCR*' })
  $capability = $ocrCapabilities | Where-Object { $_.Name -eq $capabilityName } | Select-Object -First 1
  if (-not $capability) {
    $availableNames = ($ocrCapabilities | ForEach-Object { $_.Name }) -join ', '
    throw "This Windows image does not list the required OCR capability '$capabilityName'. OCR capabilities reported by Windows: $availableNames"
  }
  Add-Content -LiteralPath $logPath -Encoding UTF8 -Value "Windows reports $($capability.Name) as $($capability.State)."
  if ($capability.State -in @('InstallPending', 'UninstallPending')) {
    Add-Content -LiteralPath $logPath -Encoding UTF8 -Value 'Restart Windows to finish the pending OCR capability change, then start Extractor again.'
    exit 3010
  }
  Add-Content -LiteralPath $logPath -Encoding UTF8 -Value 'Requesting the Windows-managed en-GB OCR capability. Windows selects a package compatible with this PC and its configured servicing source.'
  $installed = Add-WindowsCapability -Online -Name $capabilityName -ErrorAction Stop
  Add-Content -LiteralPath $logPath -Encoding UTF8 -Value (($installed | Format-List * | Out-String).Trim())
  if ($installed.RestartNeeded) { exit 3010 }
  exit 0
} catch {
  Add-Content -LiteralPath $logPath -Encoding UTF8 -Value (($_ | Format-List * -Force | Out-String).Trim())
  exit 1
}
'@
    $repairPowerShell = $repairPowerShell.Replace('__SETTINGS_FILE__', "extractor-ocr-setup-$repairId.json")
    [IO.File]::WriteAllText($repairConfig, $repairSettings, [Text.Encoding]::UTF8)
    [IO.File]::WriteAllText($repairScript, $repairPowerShell, [Text.Encoding]::UTF8)
    $arguments = '-NoLogo -NoProfile -ExecutionPolicy Bypass -File "' + $repairScript + '"'
    $process = Start-Process -FilePath $powerShellExecutable -Verb RunAs -PassThru -Wait -ArgumentList $arguments
    $exitCode = $process.ExitCode
    if (Test-Path -LiteralPath $repairLog -PathType Leaf) {
      $installOutput = (Get-Content -LiteralPath $repairLog -Tail 24 -ErrorAction SilentlyContinue) -join ' '
      if ($installOutput.Length -gt 1800) { $installOutput = $installOutput.Substring($installOutput.Length - 1800) }
    }
  } catch {
    $installError = $_.Exception.Message
  } finally {
    foreach ($temporaryFile in @($repairScript, $repairConfig)) {
      if ($temporaryFile -and (Test-Path -LiteralPath $temporaryFile -PathType Leaf)) {
        Remove-Item -LiteralPath $temporaryFile -Force -ErrorAction SilentlyContinue
      }
    }
  }

  if ((Get-ExtractorOcrLanguages) -contains $language) {
    if ($repairLog -and (Test-Path -LiteralPath $repairLog -PathType Leaf)) {
      Remove-Item -LiteralPath $repairLog -Force -ErrorAction SilentlyContinue
    }
    Write-Host "Windows OCR is ready ($language; using the version managed by this PC)."
    return $true
  }

  if ($installError) {
    $installDetail = "Windows did not install the OCR capability: $installError"
  } elseif ($exitCode -ne 0) {
    $restartText = if ($exitCode -eq 3010) { ' Restart Windows to finish the pending OCR change, then start Extractor again.' } else { '' }
    $logText = if ($installOutput) { " Windows servicing output: $installOutput" } else { '' }
    $logPathText = if ($repairLog -and (Test-Path -LiteralPath $repairLog -PathType Leaf)) { " Full setup log: $repairLog." } else { '' }
    $installDetail = "Windows OCR setup returned code $exitCode.$restartText$logText$logPathText Check Windows Update or ask your administrator to install the capability."
  } else {
    $installDetail = "Windows servicing completed, but the en-GB OCR recognizer is still unavailable. Check Windows Update and this PC's Features on Demand source."
  }
  throw "Required en-GB Windows OCR is unavailable, so Extractor has not started. $installDetail An administrator can install it with: DISM /Online /Add-Capability /CapabilityName:$capability"
}

if (-not (& $installIsComplete $target)) {
  New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
  $lockPath = Join-Path $InstallRoot "$buildId.install.lock"
  $lock = $null
  $deadline = [DateTime]::UtcNow.AddMinutes(10)
  while (-not $lock -and -not (& $installIsComplete $target)) {
    try {
      $lock = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    } catch [IO.IOException] {
      if ([DateTime]::UtcNow -ge $deadline) { throw 'Another install did not finish within 10 minutes. Close Extractor and try again.' }
      Start-Sleep -Milliseconds 500
    }
  }

  try {
    if (-not (& $installIsComplete $target)) {
      if (Test-Path -LiteralPath $target) {
        try { Remove-Item -LiteralPath $target -Recurse -Force }
        catch { throw "An incomplete local Extractor copy could not be repaired. Close Extractor and run the network launcher again. $($_.Exception.Message)" }
      }
      $stage = Join-Path $InstallRoot "$buildId.staging"
      $stageFull = [IO.Path]::GetFullPath($stage)
      if (-not $stageFull.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'The temporary install path is outside the selected install folder.'
      }
      try {
        if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
        New-Item -ItemType Directory -Path $stage | Out-Null
        & "$env:SystemRoot\System32\robocopy.exe" $source $stage /E /COPY:DAT /DCOPY:DAT /R:2 /W:1 /NFL /NDL /NJH /NJS /NC /NS /NP /XF network-build.txt debug.log /XD data | Out-Null
        $copyResult = $LASTEXITCODE
        if ($copyResult -ge 8) {
          throw "Windows could not copy the Extractor package from the shared folder (Robocopy code $copyResult). Check your network permissions and free disk space."
        }
        if (-not (& $installIsComplete $stage)) {
          throw 'The shared folder does not contain all required Extractor application files. Copy the complete network package and try again.'
        }
        Move-Item -LiteralPath $stage -Destination $target
      } catch {
        if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
        throw
      }
    }
  } finally {
    if ($lock) { $lock.Dispose() }
  }
}

if (-not (& $installIsComplete $target)) {
  throw 'The local Extractor application could not be installed.'
}
Write-Output "Using local Extractor build $buildId."
Write-Output "Application: $target"
if (-not $NoLaunch) {
  [void](Ensure-ExtractorEnglishOcr)
  New-Item -ItemType Directory -Path $ProfileRoot -Force | Out-Null
  $env:FARE_EXTRACTOR_PROFILE_ROOT = [IO.Path]::GetFullPath($ProfileRoot)
  try {
    $desktop = [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)
    if (-not [string]::IsNullOrWhiteSpace($desktop)) {
      New-Item -ItemType Directory -Path $desktop -Force | Out-Null
      $shortcutPath = Join-Path $desktop 'R&W Accountants Extractor.lnk'
      $shell = New-Object -ComObject WScript.Shell
      $shortcut = $shell.CreateShortcut($shortcutPath)
      $shortcut.TargetPath = $executable
      $shortcut.WorkingDirectory = $target
      $shortcut.IconLocation = "$executable,0"
      $shortcut.Description = 'Launch your local R&W Accountants Extractor workspace'
      $shortcut.Save()
      [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell)
      Write-Output "Desktop shortcut: $shortcutPath"
    }
  } catch {
    Write-Warning "Could not create the desktop shortcut: $($_.Exception.Message)"
  }
  Start-Process -FilePath $executable -WorkingDirectory $target
}
