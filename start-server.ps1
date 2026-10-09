$port = 8080
$url = "http://localhost:$port/"
$root = $PSScriptRoot

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($url)

try {
    $listener.Start()
    Write-Host "======================================================" -ForegroundColor Cyan
    Write-Host "  ScadenzApp (PWA) avviata su: $url" -ForegroundColor Green
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

        $localPath = $request.Url.LocalPath.TrimStart('/')
        if ([string]::IsNullOrEmpty($localPath)) {
            $localPath = "index.html"
        }

        $filePath = Join-Path $root $localPath
        if (Test-Path $filePath -PathType Leaf) {
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
