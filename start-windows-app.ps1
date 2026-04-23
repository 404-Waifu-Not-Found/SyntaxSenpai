param(
  [ValidateSet("desktop", "mobile")]
  [string]$AppType = "desktop",

  [switch]$NoInstall,
  [switch]$SkipBuild,
  [switch]$Dev,
  [switch]$Help
)

$ErrorActionPreference = "Stop"

function Show-Help {
  @"
SyntaxSenpai Windows launcher

Usage:
  .\start-windows-app.ps1 [desktop|mobile] [options]

Options:
  desktop       Launch Electron desktop app. Default.
  mobile        Launch Expo mobile app.
  -NoInstall    Skip dependency installation.
  -SkipBuild    Skip package/app build steps.
  -Dev          Launch desktop with electron-vite dev instead of built app.
  -Help         Show this help.

Examples:
  .\start-windows-app.ps1
  .\start-windows-app.ps1 desktop -Dev
  .\start-windows-app.ps1 desktop -NoInstall
  .\start-windows-app.ps1 mobile
"@
}

if ($Help) {
  Show-Help
  exit 0
}

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $RepoRoot

function Invoke-Pnpm {
  param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
  )

  & corepack pnpm @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "pnpm command failed: pnpm $($Arguments -join ' ')"
  }
}

Write-Host "SyntaxSenpai - Windows $AppType launcher"
Write-Host "Root: $RepoRoot"
Write-Host ""

try {
  $nodeVersion = & node --version
} catch {
  Write-Error "Node.js was not found. Install Node.js 20 or newer, then retry."
  exit 1
}
Write-Host "Node: $nodeVersion"

try {
  $pnpmVersion = & corepack pnpm --version
} catch {
  Write-Error "Corepack/pnpm was not available. Run 'corepack prepare pnpm@8.13.0 --activate' or install pnpm."
  exit 1
}
Write-Host "pnpm: $pnpmVersion"
Write-Host ""

if (-not $NoInstall) {
  Write-Host "Installing workspace dependencies..."
  try {
    Invoke-Pnpm install --prefer-frozen-lockfile
  } catch {
    Write-Host "Frozen install failed; retrying normal install..."
    Invoke-Pnpm install
  }
  Write-Host "Dependencies installed"
  Write-Host ""
}

if (-not $SkipBuild -and -not $Dev) {
  Write-Host "Building core packages (best effort)..."
  try {
    Invoke-Pnpm -w -r `
      --filter "@syntax-senpai/waifu-core" `
      --filter "@syntax-senpai/ai-core" `
      --filter "@syntax-senpai/storage" `
      --filter "@syntax-senpai/ui" `
      run build
  } catch {
    Write-Warning "Core package build did not complete. Continuing to app launch."
  }
  Write-Host ""
}

switch ($AppType) {
  "desktop" {
    if ($Dev) {
      Write-Host "Launching desktop app in dev mode..."
      Invoke-Pnpm --filter syntax-senpai-desktop run dev
      break
    }

    if (-not $SkipBuild) {
      Write-Host "Building desktop app..."
      try {
        Invoke-Pnpm -w --filter syntax-senpai-desktop run build
      } catch {
        Write-Warning "Desktop build did not complete. Falling back to dev mode."
        Invoke-Pnpm --filter syntax-senpai-desktop run dev
        break
      }
    }

    Write-Host "Launching Electron desktop app..."
    Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    Invoke-Pnpm --filter syntax-senpai-desktop run start
  }

  "mobile" {
    Write-Host "Launching mobile app..."
    Invoke-Pnpm -w --filter syntax-senpai-mobile run dev
  }
}
