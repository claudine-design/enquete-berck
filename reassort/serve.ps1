$root = 'C:\Users\claud\Downloads\reassort'
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add('http://localhost:3000/')
$listener.Start()
[Console]::Out.WriteLine('Listening on http://localhost:3000/')
[Console]::Out.Flush()
$mime = @{ '.html'='text/html'; '.json'='application/json'; '.js'='application/javascript'; '.png'='image/png'; '.css'='text/css' }
while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $path = $ctx.Request.Url.AbsolutePath
    if ($path -eq '/' -or $path -eq '') { $path = '/index.html' }
    $file = Join-Path $root $path.TrimStart('/')
    if (Test-Path $file -PathType Leaf) {
        $ext = [IO.Path]::GetExtension($file)
        $ct = if ($mime[$ext]) { $mime[$ext] } else { 'application/octet-stream' }
        $bytes = [IO.File]::ReadAllBytes($file)
        $ctx.Response.ContentType = $ct
        $ctx.Response.ContentLength64 = $bytes.Length
        $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
        $ctx.Response.StatusCode = 404
    }
    $ctx.Response.Close()
}
