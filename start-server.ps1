$port = 8080
$url = "http://localhost:$port/"
$root = $PSScriptRoot
$dataDir = Join-Path $root "data\users"
if (-not (Test-Path $dataDir)) {
    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
}

function Get-PinHash([string]$username, [string]$pin) {
    $salted = "scadenzapp_v2::$username::$pin"
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($salted)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $hashBytes = $sha.ComputeHash($bytes)
    return ($hashBytes | ForEach-Object { $_.ToString("x2") }) -join ""
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($url)

try {
    $listener.Start()
    Write-Host "======================================================" -ForegroundColor Cyan
    Write-Host "  ScadenzApp (PWA + Multi-User API) avviata su: $url" -ForegroundColor Green
    Write-Host "  Premi CTRL+C in questa finestra per chiudere il server" -ForegroundColor Yellow
    Write-Host "======================================================" -ForegroundColor Cyan

    Start-Process $url

    $mimeTypes = @{
        ".html"        = "text/html; charset=utf-8"
        ".css"         = "text/css; charset=utf-8"
        ".js"          = "application/javascript; charset=utf-8"
        ".json"        = "application/json; charset=utf-8"
        ".webmanifest" = "application/manifest+json; charset=utf-8"
        ".svg"         = "image/svg+xml"
        ".ico"         = "image/x-icon"
    }

    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        $response.Headers.Add("Access-Control-Allow-Origin", "*")
        $response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        $response.Headers.Add("Access-Control-Allow-Headers", "Content-Type")

        $path = $request.Url.LocalPath

        if ($request.HttpMethod -eq "OPTIONS") {
            $response.StatusCode = 204
            $response.OutputStream.Close()
            continue
        }

        if ($path -eq "/api/sync/pull" -and $request.HttpMethod -eq "POST") {
            $reader = New-Object System.IO.StreamReader($request.InputStream, [System.Text.Encoding]::UTF8)
            $bodyObj = $reader.ReadToEnd() | ConvertFrom-Json
            $username = ($bodyObj.username -replace "[^a-zA-Z0-9_-]", "").ToLower()
            $pin = [string]$bodyObj.pin
            $userFile = Join-Path $dataDir "$username.json"

            if (-not (Test-Path $userFile)) {
                $respJson = @{ ok = $true; isNewUser = $true; username = $username; items = @(); history = @() } | ConvertTo-Json -Depth 10
            } else {
                $stored = Get-Content $userFile -Raw -Encoding UTF8 | ConvertFrom-Json
                $expectedHash = Get-PinHash $username $pin
                if ($stored.pinHash -ne $expectedHash) {
                    $response.StatusCode = 401
                    $respJson = @{ ok = $false; error = "PIN errato per questo profilo!" } | ConvertTo-Json
                } else {
                    $respJson = @{
                        ok = $true
                        isNewUser = $false
                        username = $username
                        lang = $stored.lang
                        mainCurrency = $stored.mainCurrency
                        items = $stored.items
                        history = $stored.history
                    } | ConvertTo-Json -Depth 10
                }
            }
            $outBytes = [System.Text.Encoding]::UTF8.GetBytes($respJson)
            $response.ContentType = "application/json; charset=utf-8"
            $response.OutputStream.Write($outBytes, 0, $outBytes.Length)
            $response.OutputStream.Close()
            continue
        }

        if ($path -eq "/api/sync/push" -and $request.HttpMethod -eq "POST") {
            $reader = New-Object System.IO.StreamReader($request.InputStream, [System.Text.Encoding]::UTF8)
            $bodyObj = $reader.ReadToEnd() | ConvertFrom-Json
            $username = ($bodyObj.username -replace "[^a-zA-Z0-9_-]", "").ToLower()
            $pin = [string]$bodyObj.pin
            $userFile = Join-Path $dataDir "$username.json"
            $incomingHash = Get-PinHash $username $pin

            $allow = $true
            if (Test-Path $userFile) {
                $existing = Get-Content $userFile -Raw -Encoding UTF8 | ConvertFrom-Json
                if ($existing.pinHash -and ($existing.pinHash -ne $incomingHash)) {
                    $allow = $false
                }
            }

            if (-not $allow) {
                $response.StatusCode = 401
                $respJson = @{ ok = $false; error = "PIN errato per questo profilo!" } | ConvertTo-Json
            } else {
                $record = @{
                    username = $username
                    pinHash = $incomingHash
                    lang = $bodyObj.lang
                    mainCurrency = $bodyObj.mainCurrency
                    items = $bodyObj.items
                    history = $bodyObj.history
                    updatedAt = (Get-Date).ToString("o")
                }
                $record | ConvertTo-Json -Depth 10 | Set-Content -Path $userFile -Encoding UTF8
                $respJson = @{ ok = $true; username = $username } | ConvertTo-Json
            }

            $outBytes = [System.Text.Encoding]::UTF8.GetBytes($respJson)
            $response.ContentType = "application/json; charset=utf-8"
            $response.OutputStream.Write($outBytes, 0, $outBytes.Length)
            $response.OutputStream.Close()
            continue
        }

        $localPath = $path.TrimStart('/')
        if ([string]::IsNullOrEmpty($localPath)) {
            $localPath = "index.html"
        }

        $filePath = Join-Path $root $localPath
        if ((Test-Path $filePath -PathType Leaf) -and (-not $localPath.StartsWith("data"))) {
            $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
            $contentType = $mimeTypes[$ext]
            if (-not $contentType) { $contentType = "application/octet-stream" }

            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            $response.ContentType = $contentType
            $response.ContentLength64 = $bytes.Length
            $response.StatusCode = 200
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $response.StatusCode = 404
        }
        $response.OutputStream.Close()
    }
} finally {
    if ($listener.IsListening) {
        $listener.Stop()
    }
}
