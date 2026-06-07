<#
.SYNOPSIS
    Start the vibeFORWARD backend (FastAPI/uvicorn) and frontend (Next.js) together.

.DESCRIPTION
    - Prepends "C:\Program Files\nodejs" to PATH (Node is not on PATH on this machine).
    - Detects the Node version and warns (without aborting) if it is < 20.9.
      Next 16 requires Node >= 20.9, so the frontend will fail on Node 18 — but the
      backend is started regardless.
    - Ensures underwire/.env exists (copies from .env.example when available).
    - Generates underwire/data/transactions.csv if missing.
    - Starts backend then frontend concurrently in this console with prefixed output.
    - Ctrl+C stops BOTH processes.

.EXAMPLE
    ./scripts/dev-all.ps1
#>

$ErrorActionPreference = "Stop"

# ── Resolve repo root (this script lives in <root>/scripts) ────────────────────
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot  = Split-Path -Parent $ScriptDir
$Underwire = Join-Path $RepoRoot "underwire"

Write-Host "=== vibeFORWARD dev-all ===" -ForegroundColor Cyan
Write-Host "Repo root: $RepoRoot"

# ── Put Node on PATH (quoted; path has a space) ────────────────────────────────
$NodeDir = "C:\Program Files\nodejs"
if (Test-Path $NodeDir) {
    $env:Path = "$NodeDir;$env:Path"
}

# ── Node version check (warn-only) ─────────────────────────────────────────────
$FrontendOk = $true
try {
    $NodeVer = (& node --version) 2>$null   # e.g. "v18.14.0"
} catch {
    $NodeVer = $null
}

if (-not $NodeVer) {
    Write-Host "[warn] Node not found. Frontend will NOT start; backend will still run." -ForegroundColor Yellow
    $FrontendOk = $false
} else {
    $clean = $NodeVer.TrimStart("v")
    $parts = $clean.Split(".")
    $major = [int]$parts[0]
    $minor = [int]$parts[1]
    $tooOld = ($major -lt 20) -or ($major -eq 20 -and $minor -lt 9)
    if ($tooOld) {
        Write-Host "[warn] Node $NodeVer detected. Next 16 requires Node >= 20.9." -ForegroundColor Yellow
        Write-Host "[warn] Upgrade Node to >= 20.9 to run the frontend; backend will still start." -ForegroundColor Yellow
        Write-Host "[warn] (Or use Docker: 'docker compose up --build' — containers ship Node 20.)" -ForegroundColor Yellow
        $FrontendOk = $false
    } else {
        Write-Host "[ok] Node $NodeVer" -ForegroundColor Green
    }
}

# ── Ensure backend .env exists ─────────────────────────────────────────────────
$EnvFile     = Join-Path $Underwire ".env"
$EnvExample  = Join-Path $Underwire ".env.example"
if (-not (Test-Path $EnvFile)) {
    if (Test-Path $EnvExample) {
        Copy-Item $EnvExample $EnvFile
        Write-Host "[ok] Created underwire/.env from .env.example" -ForegroundColor Green
    } else {
        Write-Host "[warn] underwire/.env.example not found yet; backend will use defaults (no ANTHROPIC_API_KEY)." -ForegroundColor Yellow
    }
}

# ── Resolve the Python interpreter for the backend ─────────────────────────────
$VenvPython = Join-Path $Underwire ".venv\Scripts\python.exe"
if (Test-Path $VenvPython) {
    $PyExe  = $VenvPython
    $PyArgs = @()
    Write-Host "[ok] Using venv interpreter: $VenvPython" -ForegroundColor Green
} else {
    $PyExe  = "py"
    $PyArgs = @("-3.13")
    Write-Host "[warn] underwire/.venv not found; falling back to 'py -3.13'." -ForegroundColor Yellow
}

# ── Generate dataset if missing ────────────────────────────────────────────────
$DataCsv = Join-Path $Underwire "data\transactions.csv"
if (-not (Test-Path $DataCsv)) {
    Write-Host "[..] Generating dataset (data/transactions.csv)..." -ForegroundColor Cyan
    Push-Location $Underwire
    try {
        & $PyExe @PyArgs "data/generate_dataset.py"
    } finally {
        Pop-Location
    }
    if (Test-Path $DataCsv) {
        Write-Host "[ok] Dataset generated." -ForegroundColor Green
    } else {
        Write-Host "[warn] Dataset generation did not produce transactions.csv." -ForegroundColor Yellow
    }
} else {
    Write-Host "[ok] Dataset present." -ForegroundColor Green
}

# ── Launch backend + frontend as background jobs, stream prefixed output ────────
$jobs = @()

Write-Host ""
Write-Host "Starting backend (uvicorn) on http://localhost:8000 ..." -ForegroundColor Green
$backendJob = Start-Job -Name "api" -ScriptBlock {
    param($cwd, $pyExe, $pyArgs)
    Set-Location $cwd
    & $pyExe @pyArgs -m uvicorn api.app:app --reload --port 8000 2>&1
} -ArgumentList $Underwire, $PyExe, $PyArgs
$jobs += $backendJob

if ($FrontendOk) {
    Write-Host "Starting frontend (next dev) on http://localhost:3000 ..." -ForegroundColor Green
    $frontendJob = Start-Job -Name "web" -ScriptBlock {
        param($cwd, $nodeDir)
        Set-Location $cwd
        $env:Path = "$nodeDir;$env:Path"
        & npm run dev 2>&1
    } -ArgumentList $RepoRoot, $NodeDir
    $jobs += $frontendJob
} else {
    Write-Host "[skip] Frontend not started (Node < 20.9 or missing)." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "──────────────────────────────────────────────" -ForegroundColor Cyan
Write-Host " Frontend : http://localhost:3000" -ForegroundColor Cyan
Write-Host " API docs : http://localhost:8000/docs" -ForegroundColor Cyan
Write-Host " Press Ctrl+C to stop everything." -ForegroundColor Cyan
Write-Host "──────────────────────────────────────────────" -ForegroundColor Cyan
Write-Host ""

# ── Stream job output with [api]/[web] prefixes until interrupted ──────────────
try {
    while ($true) {
        $alive = $false
        foreach ($j in $jobs) {
            foreach ($line in (Receive-Job -Job $j)) {
                Write-Host "[$($j.Name)] $line"
            }
            if ($j.State -eq "Running" -or $j.State -eq "NotStarted") { $alive = $true }
        }
        if (-not $alive) {
            Write-Host "[dev-all] All processes have exited." -ForegroundColor Yellow
            break
        }
        Start-Sleep -Milliseconds 400
    }
} finally {
    Write-Host ""
    Write-Host "[dev-all] Stopping background jobs..." -ForegroundColor Yellow
    foreach ($j in $jobs) {
        Stop-Job   -Job $j -ErrorAction SilentlyContinue
        Remove-Job -Job $j -Force -ErrorAction SilentlyContinue
    }
    # Best-effort: kill stray uvicorn/node spawned by the jobs.
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match "uvicorn api.app:app" } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Write-Host "[dev-all] Done." -ForegroundColor Yellow
}
