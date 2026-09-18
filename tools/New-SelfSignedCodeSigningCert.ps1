[CmdletBinding()]
param(
    [string]$Subject = 'CN=Mercado Translation',
    [string]$PfxPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'Mercado-Translation-CodeSigning.pfx'),
    [string]$CerPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'Mercado-Translation-CodeSigning.cer'),
    [int]$ValidYears = 5
)

$ErrorActionPreference = 'Stop'

if ($ValidYears -lt 1 -or $ValidYears -gt 10) {
    throw 'ValidYears must be between 1 and 10.'
}

Write-Host 'Creating a persistent self-signed Windows code-signing certificate.'
Write-Host 'Use the same PFX for every release so the publisher identity stays stable.'
$password = Read-Host 'Enter a strong password for the PFX' -AsSecureString

$certParams = @{
    Type = 'CodeSigningCert'
    Subject = $Subject
    FriendlyName = 'Mercado Translation Code Signing'
    CertStoreLocation = 'Cert:\CurrentUser\My'
    KeyAlgorithm = 'RSA'
    KeyLength = 3072
    HashAlgorithm = 'SHA256'
    KeyExportPolicy = 'Exportable'
    NotAfter = (Get-Date).AddYears($ValidYears)
}
$cert = New-SelfSignedCertificate @certParams

if (-not $cert -or -not $cert.HasPrivateKey) {
    throw 'Failed to create an exportable code-signing certificate.'
}

Export-PfxCertificate -Cert $cert -FilePath $PfxPath -Password $password -Force | Out-Null
Export-Certificate -Cert $cert -FilePath $CerPath -Force | Out-Null

$base64Path = [IO.Path]::ChangeExtension($PfxPath, 'base64.txt')
$base64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($PfxPath))
[IO.File]::WriteAllText($base64Path, $base64, [Text.Encoding]::ASCII)

Write-Host ''
Write-Host 'Created:'
Write-Host "  PFX : $PfxPath"
Write-Host "  CER : $CerPath"
Write-Host "  Base64 secret file: $base64Path"
Write-Host ''
Write-Host 'GitHub repository secrets to create:'
Write-Host '  WINDOWS_CERT_PFX_BASE64  = contents of the .base64.txt file'
Write-Host '  WINDOWS_CERT_PASSWORD    = the PFX password you just entered'
Write-Host ''
Write-Host 'Keep the PFX and password private. The CER file is public and may be shared.'
