$ErrorActionPreference = 'Stop'

function Copy-IfPresent([string]$Name) {
  if ($env:ROOT_WORKTREE_PATH) {
    $source = Join-Path $env:ROOT_WORKTREE_PATH $Name
    if (Test-Path $source) {
      Copy-Item $source $Name
    }
  }
}

foreach ($file in @('.env', '.env.local', '.env.development.local')) {
  Copy-IfPresent $file
}

if (-not (Test-Path 'package.json')) {
  Write-Host 'No package.json yet; skipping dependency install.'
  exit 0
}

if (Get-Command corepack -ErrorAction SilentlyContinue) {
  function Invoke-Pnpm { corepack pnpm @args }
} elseif (Get-Command pnpm -ErrorAction SilentlyContinue) {
  function Invoke-Pnpm { pnpm @args }
} else {
  Write-Error 'pnpm is required. Install Node.js (it includes corepack) or pnpm, then recreate the worktree.'
  exit 1
}

if (Test-Path 'pnpm-lock.yaml') {
  Invoke-Pnpm install --frozen-lockfile
} else {
  Invoke-Pnpm install
}

Write-Host 'Worktree setup complete.'
