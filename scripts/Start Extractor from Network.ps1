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
$applicationDirectory = Join-Path $source 'resources\app'
$initialBuildSha = ''
try {
  $initialBuildInfo = Get-Content -LiteralPath (Join-Path $applicationDirectory 'build-info.json') -Raw | ConvertFrom-Json
  $initialBuildSha = [string]$initialBuildInfo.commit
  if ($initialBuildSha -notmatch '^[a-f0-9]{40}$') { $initialBuildSha = '' }
} catch { $initialBuildSha = '' }
$sessionDirectory = Join-Path $source '.extractor-app-sessions'
$updatePendingPath = Join-Path $source '.extractor-update.pending'
$requiredAppFiles = @(
  'main.cjs', 'network-bootstrap.cjs', 'package.json', 'index.html', 'app.js', 'preload.cjs', 'parser.js', 'styles.css',
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

function Get-InstalledExtractorCommit {
  try {
    $info = Get-Content -LiteralPath (Join-Path (Join-Path $source 'resources\app') 'build-info.json') -Raw | ConvertFrom-Json
    $commit = [string]$info.commit
    if ($commit -match '^[a-f0-9]{40}$') { return $commit }
  } catch { }
  return ''
}

function Get-ActiveExtractorSessions {
  if (-not (Test-Path -LiteralPath $sessionDirectory -PathType Container)) { return @() }
  $active = @()
  $staleBefore = [DateTime]::UtcNow.AddSeconds(-90)
  foreach ($session in Get-ChildItem -LiteralPath $sessionDirectory -Filter '*.json' -File -ErrorAction SilentlyContinue) {
    if ($session.LastWriteTimeUtc -lt $staleBefore) {
      Remove-Item -LiteralPath $session.FullName -Force -ErrorAction SilentlyContinue
    } else { $active += $session.Name }
  }
  return $active
}

function New-SharedExtractorBuild([string]$CommitSha) {
  $updatesDirectory = Join-Path $source '.extractor-update'
  New-Item -ItemType Directory -Path $updatesDirectory -Force | Out-Null
  $archivePath = Join-Path $updatesDirectory "source-$CommitSha.zip"
  $extractDirectory = Join-Path $updatesDirectory "extract-$CommitSha"
  $stageRoot = Join-Path $updatesDirectory "stage-$CommitSha-$([guid]::NewGuid().ToString('N'))"
  $backupApp = Join-Path $updatesDirectory "previous-app-$([guid]::NewGuid().ToString('N'))"
  $pendingCreated = $false
  $appMovedToBackup = $false
  $newAppInstalled = $false
  try {
    if (Test-Path -LiteralPath $updatePendingPath -PathType Leaf) { Remove-Item -LiteralPath $updatePendingPath -Force }
    [IO.File]::WriteAllText($updatePendingPath, "$CommitSha`n", [Text.Encoding]::ASCII)
    $pendingCreated = $true
    Write-Output 'EXTRACTOR_UPDATE_WAIT_NOTICE: Extractor is notifying open workspaces before updating the shared application.'
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

    $applicationStage = Join-Path $stageRoot 'app'
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

    $sessionDeadline = [DateTime]::UtcNow.AddMinutes(10)
    while ($true) {
      $activeSessions = @(Get-ActiveExtractorSessions)
      if ($activeSessions.Count -eq 0) { break }
      if ([DateTime]::UtcNow -ge $sessionDeadline) { throw 'The update is ready, but other users still have Extractor open. Close their Extractor windows and launch again; the shared files have not been changed.' }
      Write-Progress -Activity 'Checking Extractor updates' -Status "Waiting for $($activeSessions.Count) Extractor session(s) to close before replacing shared files..." -PercentComplete 55
      Start-Sleep -Seconds 1
    }

    $liveApp = Join-Path $source 'resources\app'
    New-Item -ItemType Directory -Path (Split-Path -Parent $liveApp) -Force | Out-Null
    if (Test-Path -LiteralPath $liveApp) { Move-Item -LiteralPath $liveApp -Destination $backupApp; $appMovedToBackup = $true }
    try {
      Move-Item -LiteralPath $applicationStage -Destination $liveApp
      $newAppInstalled = $true
      if (-not (Test-ExtractorAppReady $liveApp)) { throw 'The replacement shared application failed its completeness check.' }

      foreach ($launcherName in @('Start Extractor from Network.ps1','Start Extractor from Network.cmd','ExtractorRuntimeLoader.cjs','ExtractorRuntimePackage.json')) {
        $updatedLauncher = Join-Path $scriptsSource $launcherName
        if (Test-Path -LiteralPath $updatedLauncher -PathType Leaf) {
          $temporaryLauncher = Join-Path $source (".$launcherName.$([guid]::NewGuid().ToString('N')).tmp")
          Copy-Item -LiteralPath $updatedLauncher -Destination $temporaryLauncher -Force
          Move-Item -LiteralPath $temporaryLauncher -Destination (Join-Path $source $launcherName) -Force
        }
      }

      $networkBuildTemp = Join-Path $source ".network-build.$([guid]::NewGuid().ToString('N')).tmp"
      [IO.File]::WriteAllText($networkBuildTemp, "$buildId`n", [Text.Encoding]::ASCII)
      Move-Item -LiteralPath $networkBuildTemp -Destination (Join-Path $source 'network-build.txt') -Force
      if ($appMovedToBackup -and (Test-Path -LiteralPath $backupApp)) { Remove-Item -LiteralPath $backupApp -Recurse -Force; $appMovedToBackup = $false }
    } catch {
      if ($newAppInstalled -and (Test-Path -LiteralPath $liveApp)) { Remove-Item -LiteralPath $liveApp -Recurse -Force -ErrorAction SilentlyContinue }
      if ($appMovedToBackup -and (Test-Path -LiteralPath $backupApp)) { Move-Item -LiteralPath $backupApp -Destination $liveApp -Force; $appMovedToBackup = $false }
      throw
    }
    return $liveApp
  } finally {
    if ($pendingCreated -and (Test-Path -LiteralPath $updatePendingPath -PathType Leaf)) { Remove-Item -LiteralPath $updatePendingPath -Force -ErrorAction SilentlyContinue }
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
  if (-not $applicationDirectory) { throw 'The shared application folder is incomplete.' }
  if ((Get-InstalledExtractorCommit) -ne $commitSha) {
    $updateLockPath = Join-Path $source '.extractor-update.lock'
    $updateLock = $null
    $updateDeadline = [DateTime]::UtcNow.AddMinutes(10)
    while (-not $updateLock) {
      try { $updateLock = [IO.File]::Open($updateLockPath,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None) }
      catch [IO.IOException] {
        if ((Get-InstalledExtractorCommit) -eq $commitSha) { break }
        if ([DateTime]::UtcNow -ge $updateDeadline) { throw 'Another Extractor update did not finish within 10 minutes. Try launching again.' }
        Write-Progress -Activity 'Checking Extractor updates' -Status 'Waiting for another user to finish the shared update...' -PercentComplete 20
        Start-Sleep -Milliseconds 500
      }
    }
    try {
      if ($updateLock) {
        $commitSha = Get-LatestExtractorCommit
      }
      if ((Get-InstalledExtractorCommit) -ne $commitSha) {
        Write-Progress -Activity 'Checking Extractor updates' -Status 'Downloading and preparing the update on the shared network folder...' -PercentComplete 35
        $applicationDirectory = New-SharedExtractorBuild $commitSha
      }
    } finally {
      if ($updateLock) { $updateLock.Dispose() }
    }
  }
  if ((Get-InstalledExtractorCommit) -eq $commitSha -and (Test-Path -LiteralPath $updatePendingPath -PathType Leaf)) {
    $recoveryLockPath = Join-Path $source '.extractor-update.lock'
    $recoveryLock = $null
    $recoveryDeadline = [DateTime]::UtcNow.AddMinutes(10)
    while (-not $recoveryLock -and (Test-Path -LiteralPath $updatePendingPath -PathType Leaf)) {
      try { $recoveryLock = [IO.File]::Open($recoveryLockPath,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None) }
      catch [IO.IOException] {
        if ([DateTime]::UtcNow -ge $recoveryDeadline) { throw 'Another Extractor update is still finishing. Try launching again in a few minutes.' }
        Start-Sleep -Milliseconds 500
      }
    }
    if ($recoveryLock) {
      try {
        if ((Get-InstalledExtractorCommit) -eq $commitSha -and (Test-Path -LiteralPath $updatePendingPath -PathType Leaf)) {
          Remove-Item -LiteralPath $updatePendingPath -Force -ErrorAction SilentlyContinue
        }
      } finally { $recoveryLock.Dispose() }
    }
  }
  $applicationDirectory = Get-CurrentExtractorApp
  Write-Progress -Activity 'Checking Extractor updates' -Status 'Shared application files are current.' -PercentComplete 70
} catch {
  if ($_.Exception.Message -match 'other users still have Extractor open') { throw "The update could not be applied because another user still has Extractor open. Close all Extractor windows and launch again. $($_.Exception.Message)" }
  if (-not $applicationDirectory) { throw "Extractor could not check GitHub or find a usable application on the network. $($_.Exception.Message)" }
  Write-Warning "GitHub could not be reached, so Extractor will use the last complete version on the network. $($_.Exception.Message)"
}
if (-not $applicationDirectory -or -not (Test-ExtractorAppReady $applicationDirectory)) {
  throw 'No complete Extractor application is available on the shared network folder.'
}
$updateWillReset = $commitSha -match '^[a-f0-9]{40}$' -and $initialBuildSha -ne $commitSha
if ($updateWillReset -and -not $NoLaunch) {
  Write-Output 'EXTRACTOR_UPDATE_RESET_NOTICE: An update is ready. Extractor will restart automatically to apply it.'
}
$runtimeLoaderSource = Join-Path $source 'ExtractorRuntimeLoader.cjs'
$runtimePackageSource = Join-Path $source 'ExtractorRuntimePackage.json'
foreach ($requiredLoaderFile in @($runtimeLoaderSource,$runtimePackageSource)) {
  if (-not (Test-Path -LiteralPath $requiredLoaderFile -PathType Leaf)) {
    throw 'The shared Extractor package is missing its runtime loader. Copy the complete updated network package and try again.'
  }
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
        $excludedDirectories = @((Join-Path $source 'resources\app'),(Join-Path $source 'data'),(Join-Path $source '.extractor-app-sessions'),(Join-Path $source '.extractor-apps'),(Join-Path $source '.extractor-update'))
        $excludedRuntimeFiles = @('debug.log','network-build.txt','.extractor-current.txt','.extractor-head-cache.json','.extractor-update.lock','.extractor-update.pending','Start Extractor from Network.cmd','Start Extractor from Network.ps1','ExtractorRuntimeLoader.cjs','ExtractorRuntimePackage.json')
        try {
          New-Item -ItemType Directory -Path $runtimeStage | Out-Null
          Write-Progress -Activity 'Checking Extractor updates' -Status 'Preparing the Windows Electron runtime on this PC (first launch only)...' -PercentComplete 80
          & "$env:SystemRoot\System32\robocopy.exe" $source $runtimeStage /E /COPY:DAT /DCOPY:DAT /R:2 /W:1 /NFL /NDL /NJH /NJS /NC /NS /NP /XF $excludedRuntimeFiles /XD $excludedDirectories | Out-Null
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

# Electron's sandboxed Chromium processes need read/execute access to the local
# runtime directory through the ALL APPLICATION PACKAGES SID. Grant it once
# when the inherited local folder ACL does not already provide it.
$allPackagesSid = 'S-1-15-2-1'
$runtimeAcl = Get-Acl -LiteralPath $runtimeTarget
$requiredRuntimeRights = [System.Security.AccessControl.FileSystemRights]::ReadAndExecute
$requiredRuntimeInheritance = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
$hasSandboxReadAccess = $false
foreach ($accessRule in $runtimeAcl.Access) {
  if ($accessRule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) { continue }
  try { $ruleSid = $accessRule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value }
  catch { $ruleSid = $accessRule.IdentityReference.Value }
  if ($ruleSid -ne $allPackagesSid) { continue }
  $rightsReady = ($accessRule.FileSystemRights -band $requiredRuntimeRights) -eq $requiredRuntimeRights
  $inheritanceReady = ($accessRule.InheritanceFlags -band $requiredRuntimeInheritance) -eq $requiredRuntimeInheritance
  if ($rightsReady -and $inheritanceReady) { $hasSandboxReadAccess = $true; break }
}
if (-not $hasSandboxReadAccess) {
  $icacls = Join-Path $env:SystemRoot 'System32\icacls.exe'
  $aclOutput = & $icacls $runtimeTarget '/grant' '*S-1-15-2-1:(OI)(CI)(RX)' '/T' '/C' '/Q' 2>&1
  $aclResult = $LASTEXITCODE
  if ($aclResult -ne 0) { throw "Windows could not grant Electron's sandbox read access to its local runtime (icacls code $aclResult). $($aclOutput -join ' ')" }
}

# Electron's built-in `electron` module is available to a packaged app, but not
# when its loose source directory is passed as a development app. Install a
# tiny packaged entry point beside the per-user runtime; it loads the current
# shared app folder without copying the application onto this PC.
$runtimeLoaderDirectory = Join-Path $runtimeTarget 'resources\app'
$runtimeLoaderPath = Join-Path $runtimeLoaderDirectory 'ExtractorRuntimeLoader.cjs'
$runtimePackagePath = Join-Path $runtimeLoaderDirectory 'package.json'
$runtimeLoaderMarker = Join-Path $runtimeLoaderDirectory '.extractor-runtime-loader'
$loaderHash = (Get-FileHash -LiteralPath $runtimeLoaderSource -Algorithm SHA256).Hash
$packageHash = (Get-FileHash -LiteralPath $runtimePackageSource -Algorithm SHA256).Hash
$loaderSignature = "$loaderHash`n$packageHash"
$runtimeLoaderLockPath = Join-Path $RuntimeRoot "$runtimeVersion.loader.lock"
$runtimeLoaderLock = $null
$loaderDeadline = [DateTime]::UtcNow.AddMinutes(2)
while (-not $runtimeLoaderLock) {
  try { $runtimeLoaderLock = [IO.File]::Open($runtimeLoaderLockPath,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None) }
  catch [IO.IOException] {
    if ([DateTime]::UtcNow -ge $loaderDeadline) { throw 'The local Extractor launcher could not be prepared within 2 minutes. Close other launch attempts and try again.' }
    Start-Sleep -Milliseconds 250
  }
}
try {
  New-Item -ItemType Directory -Path $runtimeLoaderDirectory -Force | Out-Null
  $installedSignature = if (Test-Path -LiteralPath $runtimeLoaderMarker -PathType Leaf) { (Get-Content -LiteralPath $runtimeLoaderMarker -Raw).Trim() } else { '' }
  $loaderReady = $installedSignature -eq $loaderSignature -and (Test-Path -LiteralPath $runtimeLoaderPath -PathType Leaf) -and (Test-Path -LiteralPath $runtimePackagePath -PathType Leaf)
  if (-not $loaderReady) {
    foreach ($filePair in @(
      @{Source=$runtimeLoaderSource;Destination=$runtimeLoaderPath},
      @{Source=$runtimePackageSource;Destination=$runtimePackagePath}
    )) {
      $temporaryFile = "$($filePair.Destination).$([guid]::NewGuid().ToString('N')).tmp"
      Copy-Item -LiteralPath $filePair.Source -Destination $temporaryFile -Force
      if (Test-Path -LiteralPath $filePair.Destination -PathType Leaf) { [IO.File]::Replace($temporaryFile,$filePair.Destination,$null) }
      else { Move-Item -LiteralPath $temporaryFile -Destination $filePair.Destination }
    }
    $temporaryMarker = "$runtimeLoaderMarker.$([guid]::NewGuid().ToString('N')).tmp"
    [IO.File]::WriteAllText($temporaryMarker,$loaderSignature,[Text.Encoding]::ASCII)
    if (Test-Path -LiteralPath $runtimeLoaderMarker -PathType Leaf) { [IO.File]::Replace($temporaryMarker,$runtimeLoaderMarker,$null) }
    else { Move-Item -LiteralPath $temporaryMarker -Destination $runtimeLoaderMarker }
  }
} finally {
  if ($runtimeLoaderLock) { $runtimeLoaderLock.Dispose() }
}

# Earlier launcher builds copied these bootstrap files along with Electron.
# Remove them so a local runtime can never mistake itself for the network
# updater when it starts the packaged loader.
foreach ($runtimeBootstrapFile in @('network-build.txt','Start Extractor from Network.cmd','Start Extractor from Network.ps1','ExtractorRuntimeLoader.cjs','ExtractorRuntimePackage.json')) {
  $runtimeBootstrapPath = Join-Path $runtimeTarget $runtimeBootstrapFile
  if (Test-Path -LiteralPath $runtimeBootstrapPath -PathType Leaf) { Remove-Item -LiteralPath $runtimeBootstrapPath -Force }
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
      $shortcut.TargetPath = Join-Path $source 'Extractor.exe'
      $shortcut.WorkingDirectory = $source
      $shortcut.IconLocation = "$(Join-Path $source 'Extractor.exe'),0"
      $shortcut.Description = 'Launch the latest R&W Accountants Extractor directly from the shared network folder'
      $shortcut.Save()
      [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell)
      Write-Output "Desktop shortcut: $shortcutPath"
    }
  } catch {
    Write-Warning "Could not create the desktop shortcut: $($_.Exception.Message)"
  }
  Write-Progress -Activity 'Checking Extractor updates' -Status 'Starting the latest shared application...' -PercentComplete 100 -Completed
  $previousSharedApp = $env:FARE_EXTRACTOR_SHARED_APP
  $previousRunAsNode = $env:ELECTRON_RUN_AS_NODE
  $env:FARE_EXTRACTOR_SHARED_APP = [IO.Path]::GetFullPath($applicationDirectory)
  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  try {
    $extractorProcess = Start-Process -FilePath $runtimeExecutable -WorkingDirectory $runtimeTarget -PassThru
    Start-Sleep -Milliseconds 1500
    if ($extractorProcess.HasExited) {
      throw "The Extractor app exited during startup (exit code $($extractorProcess.ExitCode)). Try launching again. If it keeps closing, send this message to your administrator."
    }
    Write-Output "Extractor is running (process ID $($extractorProcess.Id))."
  } finally {
    if ($null -eq $previousSharedApp) { Remove-Item Env:FARE_EXTRACTOR_SHARED_APP -ErrorAction SilentlyContinue }
    else { $env:FARE_EXTRACTOR_SHARED_APP = $previousSharedApp }
    if ($null -eq $previousRunAsNode) { Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue }
    else { $env:ELECTRON_RUN_AS_NODE = $previousRunAsNode }
  }
} else {
  Write-Progress -Activity 'Checking Extractor updates' -Status 'Shared application files are ready.' -PercentComplete 100 -Completed
  Write-Output "Shared application: $applicationDirectory"
  Write-Output "Electron runtime prepared: $runtimeTarget"
  if ($commitSha) { Write-Output "GitHub source commit: $commitSha" }
}
