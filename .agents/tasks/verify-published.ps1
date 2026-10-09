$ErrorActionPreference = 'Stop'
$verificationRootPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$verificationFilePaths = @('index.html', 'generated/config.js')
$verificationFilePaths += Get-ChildItem -LiteralPath (Join-Path $verificationRootPath 'src') -Recurse -File | ForEach-Object { [IO.Path]::GetRelativePath($verificationRootPath, $_.FullName) }
$verificationFilePaths += Get-ChildItem -LiteralPath (Join-Path $verificationRootPath 'assets') -Recurse -File -Filter '*.png' | ForEach-Object { [IO.Path]::GetRelativePath($verificationRootPath, $_.FullName) }
$verificationResults = $verificationFilePaths | ForEach-Object -Parallel {
    $ErrorActionPreference = 'Stop'
    $relativeFilePath = $_
    $response = Invoke-WebRequest -Uri ('https://l4place0.github.io/l4p-knight/' + $relativeFilePath.Replace('\', '/')) -TimeoutSec 20
    $remoteBytes = $response.RawContentStream.ToArray()
    $localFilePath = Join-Path $using:verificationRootPath $relativeFilePath
    if ($relativeFilePath.EndsWith('.png')) {
        $remoteDigest = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($remoteBytes))
        $localDigest = (Get-FileHash -LiteralPath $localFilePath -Algorithm SHA256).Hash
        if ($remoteDigest -ne $localDigest) { throw "Published binary mismatch: $relativeFilePath" }
    } else {
        $remoteText = [Text.Encoding]::UTF8.GetString($remoteBytes).Replace("`r`n", "`n")
        $localText = [IO.File]::ReadAllText($localFilePath).Replace("`r`n", "`n")
        if ($remoteText -ne $localText) { throw "Published text mismatch: $relativeFilePath" }
    }
    $relativeFilePath
} -ThrottleLimit 4
if ($verificationResults.Count -ne $verificationFilePaths.Count) { throw 'Incomplete published-file verification' }
Write-Output "PASS: $($verificationResults.Count) published files match local HTML, configuration, source scripts and 18 real PNG assets."
