param(
    [string]$SourceDirectory = "native/VibeASR.cpp",
    [string]$ModelDirectory = "models/vibeasr",
    [string]$HuggingFaceEndpoint = "https://hf-mirror.com",
    [switch]$SkipModelDownload,
    [switch]$ForceModelRedownload,
    [switch]$NoInstallDependencies,
    [switch]$InstallDependenciesOnly
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $repositoryRoot $SourceDirectory
$modelPath = Join-Path $repositoryRoot $ModelDirectory
$toolRoot = Join-Path $repositoryRoot ".tools"
$winLibsRoot = Join-Path $toolRoot "winlibs"
$winLibsBin = Join-Path $winLibsRoot "mingw64\bin"

function Install-BuildDependencies {
    if ($NoInstallDependencies) {
        return
    }

    if (-not (Test-Path -LiteralPath (Join-Path $winLibsBin "gcc.exe"))) {
        Write-Host "Locating the latest portable WinLibs toolchain..." -ForegroundColor Cyan
        $release = Invoke-RestMethod -Uri "https://api.github.com/repos/brechtsanders/winlibs_mingw/releases/latest"
        $asset = $release.assets |
            Where-Object { $_.name -match '^winlibs-x86_64-posix-seh-.*\.7z$' } |
            Select-Object -First 1
        if (-not $asset) {
            throw "The latest WinLibs release does not contain an x86_64 POSIX/SEH archive."
        }

        $downloadDirectory = Join-Path $toolRoot "downloads"
        $archivePath = Join-Path $downloadDirectory $asset.name
        New-Item -ItemType Directory -Path $downloadDirectory -Force | Out-Null
        New-Item -ItemType Directory -Path $winLibsRoot -Force | Out-Null

        Write-Host "Downloading portable WinLibs (GCC, CMake and Make)..." -ForegroundColor Cyan
        curl.exe --fail --location --retry 5 --retry-all-errors --continue-at - --output $archivePath $asset.browser_download_url
        if ($LASTEXITCODE -ne 0) {
            throw "Could not download WinLibs (curl exit code $LASTEXITCODE). Rerun the script to resume."
        }

        if ($asset.digest -and $asset.digest.StartsWith("sha256:")) {
            $expectedHash = $asset.digest.Substring(7).ToUpperInvariant()
            $actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
            if ($actualHash -ne $expectedHash) {
                throw "WinLibs archive checksum mismatch. Delete $archivePath and retry."
            }
        }

        Write-Host "Extracting WinLibs into .tools/winlibs..." -ForegroundColor Cyan
        tar.exe -xf $archivePath -C $winLibsRoot
        if ($LASTEXITCODE -ne 0) {
            throw "Could not extract WinLibs (tar exit code $LASTEXITCODE)."
        }
    }

    $env:Path = "$winLibsBin;$env:Path"
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "Git is required. Install Git and retry."
}

$cmake = Get-Command cmake -ErrorAction SilentlyContinue
$gcc = Get-Command gcc -ErrorAction SilentlyContinue
$gxx = Get-Command g++ -ErrorAction SilentlyContinue
$make = Get-Command mingw32-make -ErrorAction SilentlyContinue

if (-not $cmake -or -not $gcc -or -not $gxx -or -not $make) {
    Install-BuildDependencies
    $cmake = Get-Command cmake -ErrorAction SilentlyContinue
    $gcc = Get-Command gcc -ErrorAction SilentlyContinue
    $gxx = Get-Command g++ -ErrorAction SilentlyContinue
    $make = Get-Command mingw32-make -ErrorAction SilentlyContinue
}

if (-not $cmake -or -not $gcc -or -not $gxx -or -not $make) {
    throw @"
VibeASR.cpp requires CMake and MinGW-w64 on Windows, but they could not be found after installation.
Rerun without -NoInstallDependencies to download the portable toolchain, or verify that cmake.exe,
gcc.exe, g++.exe, and mingw32-make.exe are available on PATH. MSVC is not supported upstream.
"@
}

Write-Host "CMake: $($cmake.Source)" -ForegroundColor DarkGray
Write-Host "GCC:   $($gcc.Source)" -ForegroundColor DarkGray
Write-Host "G++:   $($gxx.Source)" -ForegroundColor DarkGray
Write-Host "Make:  $($make.Source)" -ForegroundColor DarkGray

if ($InstallDependenciesOnly) {
    Write-Host "CMake and MinGW-w64 are ready." -ForegroundColor Green
    return
}

if (-not (Test-Path -LiteralPath $sourcePath)) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $sourcePath) -Force | Out-Null
    git clone --recursive https://github.com/microsoft/VibeASR.cpp.git $sourcePath
} else {
    git -C $sourcePath submodule update --init --recursive
}

cmake -S $sourcePath -B (Join-Path $sourcePath "build") `
    -G "MinGW Makefiles" `
    -DCMAKE_BUILD_TYPE=Release `
    -DCMAKE_C_COMPILER=gcc `
    -DCMAKE_CXX_COMPILER=g++ `
    -DCMAKE_MAKE_PROGRAM=mingw32-make

cmake --build (Join-Path $sourcePath "build") --target asr_stream_server -j

$serverDirectory = Join-Path $sourcePath "build\bin"
$runtimeDlls = @(
    "libgcc_s_seh-1.dll",
    "libstdc++-6.dll",
    "libwinpthread-1.dll",
    "libgomp-1.dll",
    "libdl.dll"
)
foreach ($runtimeDll in $runtimeDlls) {
    $runtimeDllPath = Join-Path $winLibsBin $runtimeDll
    if (Test-Path -LiteralPath $runtimeDllPath) {
        Copy-Item -LiteralPath $runtimeDllPath -Destination $serverDirectory -Force
    }
}

if (-not $SkipModelDownload) {
    New-Item -ItemType Directory -Path $modelPath -Force | Out-Null

    $modelFiles = @(
        @{
            Name = "vibeasr-vae-encoder-i8_s.gguf"
            Sha256 = "4941c82608c253ec066b5cc74d3dd11a5c8fef96cccbc5b87359ef0fe4338df6"
        },
        @{
            Name = "vibeasr-lm-i2_s-embed-q6_k.gguf"
            Sha256 = "fbe273d8dc2f2433bb25f849e19d77ea65aaa2188d12c20cee987ab6f321e002"
        }
    )

    foreach ($modelFile in $modelFiles) {
        $destination = Join-Path $modelPath $modelFile.Name
        $isComplete = $false
        if ((-not $ForceModelRedownload) -and (Test-Path -LiteralPath $destination)) {
            $existingHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
            $isComplete = $existingHash -eq $modelFile.Sha256
        }

        if (-not $isComplete) {
            $endpoint = $HuggingFaceEndpoint.TrimEnd("/")
            $url = "$endpoint/microsoft/VibeVoice-ASR-BitNet/resolve/main/$($modelFile.Name)?download=true"
            $downloadMode = if ($ForceModelRedownload) { "from the beginning" } else { "with resume support" }
            Write-Host "Downloading $($modelFile.Name) $downloadMode..." -ForegroundColor Cyan
            $curlArguments = @(
                "--fail",
                "--location",
                "--retry", "10",
                "--retry-all-errors",
                "--retry-delay", "3",
                "--output", $destination,
                $url
            )
            if (-not $ForceModelRedownload) {
                $curlArguments = @("--continue-at", "-") + $curlArguments
            }
            & curl.exe @curlArguments
            if ($LASTEXITCODE -ne 0) {
                throw "Could not download $($modelFile.Name) (curl exit code $LASTEXITCODE). Rerun to resume."
            }
        }

        $actualHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actualHash -ne $modelFile.Sha256) {
            throw "Checksum mismatch for $($modelFile.Name). Rerun the script to resume or replace the partial file."
        }
    }
}

Write-Host "VibeASR.cpp is ready." -ForegroundColor Green
Write-Host "Server: $(Join-Path $sourcePath 'build/bin/asr_stream_server.exe')"
Write-Host "Models: $modelPath"
Write-Host "Open Voicebox runtime settings, verify these paths, then disable demo mode."
