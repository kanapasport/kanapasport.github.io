# ============================================================================
#  Malý webový server pro Pasport Kaňa – záloha, když na počítači není
#  Python ani Node.js.
#
#  Proč vlastní server a ne dvojklik na index.html: stránky načítají skripty
#  jako moduly (type="module") a prohlížeč je z adresy file:// odmítne.
#  Web proto MUSÍ jet přes http://localhost.
#
#  Proč TcpListener a ne HttpListener: HttpListener chce na Windows práva
#  správce (rezervace adresy), tohle běží pod běžným účtem.
#
#  Spouští se přes SPUSTIT-PREZENTACE.bat. Ukončí se zavřením okna.
# ============================================================================

param(
    [int]$Port = 5174,
    [string]$Slozka = $PSScriptRoot
)

$ErrorActionPreference = "Stop"

# přípony → typ obsahu; co tu není, pošle se jako binárka ke stažení
$Typy = @{
    ".html" = "text/html; charset=utf-8"
    ".htm"  = "text/html; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".js"   = "text/javascript; charset=utf-8"
    ".mjs"  = "text/javascript; charset=utf-8"
    ".json" = "application/json; charset=utf-8"
    ".svg"  = "image/svg+xml"
    ".png"  = "image/png"
    ".jpg"  = "image/jpeg"
    ".jpeg" = "image/jpeg"
    ".gif"  = "image/gif"
    ".webp" = "image/webp"
    ".ico"  = "image/x-icon"
    ".woff" = "font/woff"
    ".woff2"= "font/woff2"
    ".txt"  = "text/plain; charset=utf-8"
    ".md"   = "text/plain; charset=utf-8"
    ".pdf"  = "application/pdf"
}

try {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
    $listener.Start()
} catch {
    Write-Host ""
    Write-Host "  Port $Port uz nekdo pouziva." -ForegroundColor Red
    Write-Host "  Nejspis uz web bezi v jinem okne - zkus http://localhost:$Port/index.html"
    Write-Host ""
    Read-Host "  Stiskni Enter pro ukonceni"
    exit 1
}

Write-Host ""
Write-Host "  Pasport Kana bezi na: " -NoNewline
Write-Host "http://localhost:$Port/index.html" -ForegroundColor Green
Write-Host "  Slozka: $Slozka"
Write-Host ""
Write-Host "  Tohle okno nechej otevrene. Zavrenim se web vypne."
Write-Host ""

function Send-Odpoved {
    param($Stream, [int]$Kod, [string]$Popis, [string]$Typ, [byte[]]$Telo)

    $hlavicka = "HTTP/1.1 $Kod $Popis`r`n" +
                "Content-Type: $Typ`r`n" +
                "Content-Length: $($Telo.Length)`r`n" +
                # bez cache: po uprave souboru se musi projevit hned
                "Cache-Control: no-store`r`n" +
                "Connection: close`r`n`r`n"
    $bytes = [System.Text.Encoding]::ASCII.GetBytes($hlavicka)
    $Stream.Write($bytes, 0, $bytes.Length)
    if ($Telo.Length -gt 0) { $Stream.Write($Telo, 0, $Telo.Length) }
    $Stream.Flush()
}

while ($true) {
    $klient = $null
    try {
        $klient = $listener.AcceptTcpClient()
        $stream = $klient.GetStream()
        # prohlizec si nekdy otevre spojeni "do zasoby" a nic neposle;
        # bez timeoutu by na nem server cekal donekonecna
        $stream.ReadTimeout = 5000

        $ctecka = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII)
        $radek = $ctecka.ReadLine()
        if (-not $radek) { $klient.Close(); continue }

        $casti = $radek.Split(" ")
        $cesta = if ($casti.Length -ge 2) { $casti[1] } else { "/" }

        # pryc s ?v=84 a #kotvou, pak dekodovat %20 a spol.
        $cesta = ($cesta -split "\?")[0]
        $cesta = ($cesta -split "#")[0]
        $cesta = [System.Uri]::UnescapeDataString($cesta)
        if ($cesta -eq "/" -or $cesta -eq "") { $cesta = "/index.html" }

        $relativni = $cesta.TrimStart("/").Replace("/", "\")
        $soubor = Join-Path $Slozka $relativni

        # pojistka proti ../../ – ven ze slozky webu se nesmi
        $plna = [System.IO.Path]::GetFullPath($soubor)
        $koren = [System.IO.Path]::GetFullPath($Slozka)
        if (-not $plna.StartsWith($koren, [System.StringComparison]::OrdinalIgnoreCase)) {
            Send-Odpoved $stream 403 "Forbidden" "text/plain; charset=utf-8" ([System.Text.Encoding]::UTF8.GetBytes("Mimo slozku webu."))
            $klient.Close(); continue
        }

        if (Test-Path -LiteralPath $plna -PathType Leaf) {
            $pripona = [System.IO.Path]::GetExtension($plna).ToLower()
            $typ = if ($Typy.ContainsKey($pripona)) { $Typy[$pripona] } else { "application/octet-stream" }
            $telo = [System.IO.File]::ReadAllBytes($plna)
            Send-Odpoved $stream 200 "OK" $typ $telo
        } else {
            $telo = [System.Text.Encoding]::UTF8.GetBytes("404 - soubor $cesta tu neni.")
            Send-Odpoved $stream 404 "Not Found" "text/plain; charset=utf-8" $telo
        }
    } catch {
        # jedno rozbite spojeni nesmi shodit server
    } finally {
        if ($klient) { try { $klient.Close() } catch {} }
    }
}
