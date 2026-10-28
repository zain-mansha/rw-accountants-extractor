param(
  [string]$RuntimeRoot = (Join-Path $env:LOCALAPPDATA 'Programs\ExtractorRuntime'),
  [string]$ProfileRoot = (Join-Path $env:LOCALAPPDATA 'Extractor\Profiles'),
  [switch]$NoLaunch
)

$ErrorActionPreference = 'Stop'
$source = [IO.Path]::GetFullPath($PSScriptRoot)
$localAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
if ([string]::IsNullOrWhiteSpace($localAppData)) {
  throw 'Windows did not provide a local application-data folder for this account.'
}
$RuntimeRoot = [IO.Path]::GetFullPath($RuntimeRoot)
$runtimeVersionFile = Join-Path $source 'version'
if (-not (Test-Path -LiteralPath $runtimeVersionFile -PathType Leaf)) {
  throw 'The shared Extractor package is missing Electron runtime version information.'
}
$runtimeVersion = (Get-Content -LiteralPath $runtimeVersionFile -Raw).Trim()
if ($runtimeVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'The Electron runtime version marker is invalid.' }
$runtimeTarget = Join-Path $RuntimeRoot $runtimeVersion
$runtimeExecutable = Join-Path $runtimeTarget 'Extractor.exe'
$runtimePrefix = $RuntimeRoot.TrimEnd('\') + '\'
if (-not $runtimeTarget.StartsWith($runtimePrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'The local Electron runtime path is outside its selected folder.'
}

$repositoryOwner = 'zain-mansha'
$repositoryName = 'rw-accountants-extractor'
$repositoryBranch = 'main'
$currentBuildFile = Join-Path $source '.extractor-current.txt'
$buildRoot = Join-Path $source '.extractor-apps'
$requiredAppFiles = @(
  'main.cjs', 'package.json', 'index.html', 'parser.js', 'styles.css',
  'vendor\xlsx.full.min.js', 'ocr-helper.ps1', 'copy-helper.ps1', 'ocr-requirement.json', 'build-info.json'
)

function Test-ExtractorAppReady([string]$Directory) {
  if (-not (Test-Path -LiteralPath $Directory -PathType Container)) { return $false }
  foreach ($relative in $requiredAppFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $Directory $relative) -PathType Leaf)) { return $false }
  }
  return $true
}

function Get-CurrentExtractorApp {
  if (Test-Path -LiteralPath $currentBuildFile -PathType Leaf) {
    $currentBuild = (Get-Content -LiteralPath $currentBuildFile -Raw).Trim()
    if ($currentBuild -match '^[a-f0-9]{40}$') {
      $currentApp = Join-Path (Join-Path $buildRoot $currentBuild) 'resources\app'
      if (Test-ExtractorAppReady $currentApp) { return $currentApp }
    }
  }
  $packagedApp = Join-Path $source 'resources\app'
  if (Test-ExtractorAppReady $packagedApp) { return $packagedApp }
  return $null
}

function Get-ExtractorCommitFromFeed([string]$FeedContent) {
  $shaMatch = [regex]::Match($FeedContent, 'tag:github\.com,2008:Grit::Commit/(?<sha>[a-f0-9]{40})')
  if (-not $shaMatch.Success) { throw 'GitHub returned a commit feed without a readable commit identifier.' }
  $sha = [string]$shaMatch.Groups['sha'].Value
  if ($sha -notmatch '^[a-f0-9]{40}$') { throw 'GitHub returned an invalid Extractor commit identifier.' }
  return $sha
}

function Get-LatestExtractorCommit {
  if ($env:EXTRACTOR_NETWORK_UPDATE_TESTS -eq '1') {
    if ($env:EXTRACTOR_TEST_COMMIT -notmatch '^[a-f0-9]{40}$' -or -not (Test-Path -LiteralPath $env:EXTRACTOR_TEST_ARCHIVE -PathType Leaf)) {
      throw 'Extractor updater test configuration is incomplete.'
    }
    if ($env:EXTRACTOR_TEST_FEED_CONTENT) {
      $testSha = Get-ExtractorCommitFromFeed $env:EXTRACTOR_TEST_FEED_CONTENT
      if ($testSha -ne $env:EXTRACTOR_TEST_COMMIT) { throw 'The test commit feed did not match its configured source archive.' }
      return $testSha
    }
    return $env:EXTRACTOR_TEST_COMMIT
  }
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $uri = "https://github.com/$repositoryOwner/$repositoryName/commits/$repositoryBranch.atom"
  $headers = @{ Accept = 'application/atom+xml'; 'User-Agent' = 'RW-Accountants-Extractor-Updater' }
  $feed = Invoke-WebRequest -UseBasicParsing -Method Get -Uri $uri -Headers $headers -TimeoutSec 20
  return Get-ExtractorCommitFromFeed ([string]$feed.Content)
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

function Ensure-ExtractorEnglishOcr([string]$ApplicationDirectory) {
  $requirementPath = Join-Path $ApplicationDirectory 'ocr-requirement.json'
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

function New-SharedExtractorBuild([string]$CommitSha) {
  $updatesDirectory = Join-Path $source '.extractor-update'
  New-Item -ItemType Directory -Path $updatesDirectory -Force | Out-Null
  New-Item -ItemType Directory -Path $buildRoot -Force | Out-Null
  $archivePath = Join-Path $updatesDirectory "source-$CommitSha.zip"
  $extractDirectory = Join-Path $updatesDirectory "extract-$CommitSha"
  $targetRoot = Join-Path $buildRoot $CommitSha
  $stageRoot = Join-Path $buildRoot ".staging-$CommitSha-$([guid]::NewGuid().ToString('N'))"
  try {
    if ($env:EXTRACTOR_NETWORK_UPDATE_TESTS -eq '1') {
      Copy-Item -LiteralPath $env:EXTRACTOR_TEST_ARCHIVE -Destination $archivePath -Force
    } else {
      $archiveUri = "https://codeload.github.com/$repositoryOwner/$repositoryName/zip/$CommitSha"
      Invoke-WebRequest -UseBasicParsing -Method Get -Uri $archiveUri -OutFile $archivePath -TimeoutSec 120
    }
    if (Test-Path -LiteralPath $extractDirectory) { Remove-Item -LiteralPath $extractDirectory -Recurse -Force }
    Expand-Archive -LiteralPath $archivePath -DestinationPath $extractDirectory -Force
    $repoRoot = Get-ChildItem -LiteralPath $extractDirectory -Directory | Select-Object -First 1
    if (-not $repoRoot) { throw 'The downloaded GitHub archive did not contain a source folder.' }
    $extractorSource = Join-Path $repoRoot.FullName 'extractor'
    $vendorSource = Join-Path $repoRoot.FullName 'dist\vendor'
    $scriptsSource = Join-Path $repoRoot.FullName 'scripts'
    if (-not (Test-Path -LiteralPath (Join-Path $extractorSource 'main.cjs') -PathType Leaf) -or -not (Test-Path -LiteralPath (Join-Path $vendorSource 'xlsx.full.min.js') -PathType Leaf)) {
      throw 'The downloaded GitHub source is missing the Extractor application files.'
    }

    $applicationStage = Join-Path $stageRoot 'resources\app'
    New-Item -ItemType Directory -Path $applicationStage -Force | Out-Null
    Get-ChildItem -LiteralPath $extractorSource -Force | Where-Object { $_.Name -notin @('license.cjs','license-config.json') } | ForEach-Object {
      Copy-Item -LiteralPath $_.FullName -Destination $applicationStage -Recurse -Force
    }
    $vendorStage = Join-Path $applicationStage 'vendor'
    New-Item -ItemType Directory -Path $vendorStage -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $vendorSource 'xlsx.full.min.js') -Destination $vendorStage -Force
    Copy-Item -LiteralPath (Join-Path $vendorSource 'SHEETJS-LICENSE.txt') -Destination $vendorStage -Force
    $applicationPackage = Get-Content -LiteralPath (Join-Path $applicationStage 'package.json') -Raw | ConvertFrom-Json
    $buildId = "$($applicationPackage.version)-$($CommitSha.Substring(0,12))"
    [IO.File]::WriteAllText((Join-Path $applicationStage 'build-info.json'), (@{buildId=$buildId;commit=$CommitSha} | ConvertTo-Json -Depth 4), [Text.Encoding]::UTF8)
    if (-not (Test-ExtractorAppReady $applicationStage)) { throw 'The updated Extractor application is incomplete; the existing shared version has been kept.' }

    New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null
    if (Test-Path -LiteralPath $targetRoot) { Remove-Item -LiteralPath $targetRoot -Recurse -Force }
    Move-Item -LiteralPath $stageRoot -Destination $targetRoot

    foreach ($launcherName in @('Start Extractor from Network.ps1','Start Extractor from Network.cmd')) {
      $updatedLauncher = Join-Path $scriptsSource $launcherName
      if (Test-Path -LiteralPath $updatedLauncher -PathType Leaf) {
        $temporaryLauncher = Join-Path $source (".$launcherName.$([guid]::NewGuid().ToString('N')).tmp")
        Copy-Item -LiteralPath $updatedLauncher -Destination $temporaryLauncher -Force
        Move-Item -LiteralPath $temporaryLauncher -Destination (Join-Path $source $launcherName) -Force
      }
    }
    $markerTemp = "$currentBuildFile.$([guid]::NewGuid().ToString('N')).tmp"
    [IO.File]::WriteAllText($markerTemp, "$CommitSha`n", [Text.Encoding]::ASCII)
    Move-Item -LiteralPath $markerTemp -Destination $currentBuildFile -Force
    return (Join-Path $targetRoot 'resources\app')
  } finally {
    foreach ($temporaryPath in @($archivePath,$extractDirectory,$stageRoot)) {
      if (Test-Path -LiteralPath $temporaryPath) { Remove-Item -LiteralPath $temporaryPath -Recurse -Force -ErrorAction SilentlyContinue }
    }
  }
}

Write-Progress -Activity 'Checking Extractor updates' -Status 'Checking the shared network application against GitHub...' -PercentComplete 10
$applicationDirectory = Get-CurrentExtractorApp
$commitSha = ''
try {
  $commitSha = Get-LatestExtractorCommit
  $updatedDirectory = Join-Path (Join-Path $buildRoot $commitSha) 'resources\app'
  if (-not (Test-ExtractorAppReady $updatedDirectory)) {
    $updateLockPath = Join-Path $source '.extractor-update.lock'
    $updateLock = $null
    $updateDeadline = [DateTime]::UtcNow.AddMinutes(10)
    while (-not $updateLock) {
      try { $updateLock = [IO.File]::Open($updateLockPath,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None) }
      catch [IO.IOException] {
        $applicationDirectory = Get-CurrentExtractorApp
        if ((Test-ExtractorAppReady $updatedDirectory)) { break }
        if ([DateTime]::UtcNow -ge $updateDeadline) { throw 'Another Extractor update did not finish within 10 minutes. Try launching again.' }
        Write-Progress -Activity 'Checking Extractor updates' -Status 'Waiting for another user to finish the shared update...' -PercentComplete 20
        Start-Sleep -Milliseconds 500
      }
    }
    try {
      if (-not (Test-ExtractorAppReady $updatedDirectory)) {
        Write-Progress -Activity 'Checking Extractor updates' -Status 'Downloading and preparing the update on the shared network folder...' -PercentComplete 35
        $updatedDirectory = New-SharedExtractorBuild $commitSha
      }
    } finally {
      if ($updateLock) { $updateLock.Dispose() }
    }
  }
  if (Test-ExtractorAppReady $updatedDirectory) { $applicationDirectory = $updatedDirectory }
  Write-Progress -Activity 'Checking Extractor updates' -Status 'Shared application files are current.' -PercentComplete 70
} catch {
  if (-not $applicationDirectory) { throw "Extractor could not check GitHub or find a usable application on the network. $($_.Exception.Message)" }
  Write-Warning "GitHub could not be reached, so Extractor will use the last complete version on the network. $($_.Exception.Message)"
}
if (-not $applicationDirectory -or -not (Test-ExtractorAppReady $applicationDirectory)) {
  throw 'No complete Extractor application is available on the shared network folder.'
}

$runtimeRequiredFiles = @('Extractor.exe','icudtl.dat','resources.pak','snapshot_blob.bin','v8_context_snapshot.bin')
  $runtimeReady = $true
  foreach ($relative in $runtimeRequiredFiles) { if (-not (Test-Path -LiteralPath (Join-Path $runtimeTarget $relative) -PathType Leaf)) { $runtimeReady = $false; break } }
  if (-not $runtimeReady) {
    New-Item -ItemType Directory -Path $RuntimeRoot -Force | Out-Null
    $runtimeLockPath = Join-Path $RuntimeRoot "$runtimeVersion.install.lock"
    $runtimeLock = $null
    $runtimeDeadline = [DateTime]::UtcNow.AddMinutes(10)
    while (-not $runtimeLock) {
      try { $runtimeLock = [IO.File]::Open($runtimeLockPath,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None) }
      catch [IO.IOException] {
        if ([DateTime]::UtcNow -ge $runtimeDeadline) { throw 'The shared Electron runtime could not be prepared within 10 minutes. Try launching again.' }
        Start-Sleep -Milliseconds 500
      }
    }
    try {
      $runtimeReady = $true
      foreach ($relative in $runtimeRequiredFiles) { if (-not (Test-Path -LiteralPath (Join-Path $runtimeTarget $relative) -PathType Leaf)) { $runtimeReady = $false; break } }
      if (-not $runtimeReady) {
        if (Test-Path -LiteralPath $runtimeTarget) { Remove-Item -LiteralPath $runtimeTarget -Recurse -Force }
        $runtimeStage = Join-Path $RuntimeRoot "$runtimeVersion.staging-$([guid]::NewGuid().ToString('N'))"
        $runtimeStageFull = [IO.Path]::GetFullPath($runtimeStage)
        if (-not $runtimeStageFull.StartsWith($runtimePrefix,[StringComparison]::OrdinalIgnoreCase)) { throw 'The temporary Electron runtime path is outside its selected folder.' }
        $excludedDirectories = @((Join-Path $source 'resources\app'),(Join-Path $source 'data'),$buildRoot,(Join-Path $source '.extractor-update'))
        try {
          New-Item -ItemType Directory -Path $runtimeStage | Out-Null
          Write-Progress -Activity 'Checking Extractor updates' -Status 'Preparing the Windows Electron runtime on this PC (first launch only)...' -PercentComplete 80
          & "$env:SystemRoot\System32\robocopy.exe" $source $runtimeStage /E /COPY:DAT /DCOPY:DAT /R:2 /W:1 /NFL /NDL /NJH /NJS /NC /NS /NP /XF debug.log .extractor-current.txt .extractor-head-cache.json .extractor-update.lock /XD $excludedDirectories | Out-Null
          $copyResult = $LASTEXITCODE
          if ($copyResult -ge 8) { throw "Windows could not prepare the Electron runtime (Robocopy code $copyResult). Check network access and free disk space." }
          foreach ($relative in $runtimeRequiredFiles) { if (-not (Test-Path -LiteralPath (Join-Path $runtimeStage $relative) -PathType Leaf)) { throw "The Electron runtime is missing $relative." } }
          Move-Item -LiteralPath $runtimeStage -Destination $runtimeTarget
        } catch {
          if (Test-Path -LiteralPath $runtimeStage) { Remove-Item -LiteralPath $runtimeStage -Recurse -Force -ErrorAction SilentlyContinue }
          throw
        }
      }
    } finally {
      if ($runtimeLock) { $runtimeLock.Dispose() }
    }
  }

if (-not $NoLaunch) {
  [void](Ensure-ExtractorEnglishOcr $applicationDirectory)
  New-Item -ItemType Directory -Path $ProfileRoot -Force | Out-Null
  $env:FARE_EXTRACTOR_PROFILE_ROOT = [IO.Path]::GetFullPath($ProfileRoot)
  try {
    $desktop = [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)
    if (-not [string]::IsNullOrWhiteSpace($desktop)) {
      New-Item -ItemType Directory -Path $desktop -Force | Out-Null
      $shortcutPath = Join-Path $desktop 'R&W Accountants Extractor.lnk'
      $shell = New-Object -ComObject WScript.Shell
      $shortcut = $shell.CreateShortcut($shortcutPath)
      $shortcut.TargetPath = Join-Path $source 'Start Extractor from Network.cmd'
      $shortcut.WorkingDirectory = $source
      $shortcut.Description = 'Launch the latest R&W Accountants Extractor from the shared network folder'
      $shortcut.Save()
      [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell)
      Write-Output "Desktop shortcut: $shortcutPath"
    }
  } catch {
    Write-Warning "Could not create the desktop shortcut: $($_.Exception.Message)"
  }
  Write-Progress -Activity 'Checking Extractor updates' -Status 'Starting the latest shared application...' -PercentComplete 100 -Completed
  $applicationArgument = '"' + $applicationDirectory + '"'
  Start-Process -FilePath $runtimeExecutable -ArgumentList $applicationArgument -WorkingDirectory $applicationDirectory
} else {
  Write-Progress -Activity 'Checking Extractor updates' -Status 'Shared application files are ready.' -PercentComplete 100 -Completed
  Write-Output "Shared application: $applicationDirectory"
  Write-Output "Electron runtime prepared: $runtimeTarget"
  if ($commitSha) { Write-Output "GitHub source commit: $commitSha" }
}
