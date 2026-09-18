[CmdletBinding()]
param(
    [string]$PakeRoot = '',
    [string]$UpgradeCode = '1ffd51d4-30e3-5cb0-996c-b694974be021'
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($PakeRoot)) {
    $npmRoot = (& npm root -g).Trim()
    if (-not $npmRoot) {
        throw 'Unable to resolve global npm root.'
    }
    $PakeRoot = Join-Path $npmRoot 'pake-cli'
}

$tauriRoot = Join-Path $PakeRoot 'src-tauri'
$winConfigPath = Join-Path $tauriRoot 'tauri.windows.conf.json'
$invokePath = Join-Path $tauriRoot 'src\app\invoke.rs'
$libPath = Join-Path $tauriRoot 'src\lib.rs'

foreach ($path in @($winConfigPath, $invokePath, $libPath)) {
    if (-not (Test-Path $path)) {
        throw "Pake template file not found: $path"
    }
}

Write-Host "Patching Pake Windows template at: $PakeRoot"

# 1) Lock MSI identity so every future MSI is treated as an upgrade of the same app.
$winConfig = Get-Content $winConfigPath -Raw | ConvertFrom-Json
if (-not $winConfig.bundle.windows.wix) {
    throw 'Unexpected Pake tauri.windows.conf.json: bundle.windows.wix is missing.'
}
$winConfig.bundle.windows.wix | Add-Member -NotePropertyName upgradeCode -NotePropertyValue $UpgradeCode -Force
$winConfig | ConvertTo-Json -Depth 20 | Set-Content $winConfigPath -Encoding utf8

# 2) Add a narrow native command:
#    - only accepts this repository's GitHub Release MSI URLs
#    - only accepts our expected MSI filename pattern
#    - downloads to the Windows temp directory
#    - launches msiexec in passive upgrade mode and exits the current app
$invoke = Get-Content $invokePath -Raw
if ($invoke -notmatch 'download_and_install_update') {
    $structAnchor = @'
#[derive(serde::Deserialize)]
pub struct NotificationParams {
    title: String,
    body: String,
    icon: String,
}
'@

    $structInsert = @'
#[derive(serde::Deserialize)]
pub struct NotificationParams {
    title: String,
    body: String,
    icon: String,
}

#[derive(serde::Deserialize)]
pub struct InstallUpdateParams {
    url: String,
    filename: String,
}
'@

    if (-not $invoke.Contains($structAnchor)) {
        throw 'Unexpected Pake invoke.rs: NotificationParams anchor not found.'
    }
    $invoke = $invoke.Replace($structAnchor, $structInsert)

    $commandAnchor = @'
#[command]
pub fn send_notification(app: AppHandle, params: NotificationParams) -> Result<(), String> {
'@

    $commandInsert = @'
#[command]
pub async fn download_and_install_update(
    app: AppHandle,
    params: InstallUpdateParams,
) -> Result<(), String> {
    let url = Url::from_str(&params.url).map_err(|e| format!("Invalid update URL: {e}"))?;

    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || !url
            .path()
            .starts_with("/Fan6512/Mercado-Translation/releases/download/")
    {
        return Err("Update URL is not an allowed Mercado-Translation GitHub Release URL.".into());
    }

    let filename = params.filename.trim();
    if !filename.starts_with("Mercado-Translation-v")
        || !filename.ends_with("-Windows-x64.msi")
        || filename.contains(['/', '\\'])
    {
        return Err("Unexpected update installer filename.".into());
    }

    let output_path = std::env::temp_dir().join(filename);
    let client = ClientBuilder::new()
        .build()
        .map_err(|e| format!("Failed to build update client: {e}"))?;
    let request = Request::new(Method::GET, url);
    let mut response = client
        .execute(request)
        .await
        .map_err(|e| format!("Failed to download update: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Update download failed with HTTP status {}",
            response.status()
        ));
    }

    let mut file =
        File::create(&output_path).map_err(|e| format!("Failed to create update file: {e}"))?;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("Failed to download update chunk: {e}"))?
    {
        file.write_all(&chunk)
            .map_err(|e| format!("Failed to write update file: {e}"))?;
    }
    drop(file);

    #[cfg(target_os = "windows")]
    {
        let installer = output_path
            .to_str()
            .ok_or("Update installer path is not valid UTF-8")?;

        std::process::Command::new("msiexec.exe")
            .args(["/i", installer, "/passive", "/norestart"])
            .spawn()
            .map_err(|e| format!("Failed to launch Windows installer: {e}"))?;

        app.exit(0);
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Err("Automatic installer updates are only supported on Windows.".into())
    }
}

#[command]
pub fn send_notification(app: AppHandle, params: NotificationParams) -> Result<(), String> {
'@

    if (-not $invoke.Contains($commandAnchor)) {
        throw 'Unexpected Pake invoke.rs: send_notification anchor not found.'
    }
    $invoke = $invoke.Replace($commandAnchor, $commandInsert)
    Set-Content $invokePath -Value $invoke -Encoding utf8
}

# 3) Register the command in the Tauri invoke handler.
$lib = Get-Content $libPath -Raw
if ($lib -notmatch 'download_and_install_update') {
    $importOld = 'clear_dock_badge, download_file, increment_dock_badge, send_notification, set_dock_badge,'
    $importNew = 'clear_dock_badge, download_and_install_update, download_file, increment_dock_badge, send_notification, set_dock_badge,'
    if (-not $lib.Contains($importOld)) {
        throw 'Unexpected Pake lib.rs: invoke import anchor not found.'
    }
    $lib = $lib.Replace($importOld, $importNew)

    $handlerOld = @'
        .invoke_handler(tauri::generate_handler![
            download_file,
'@
    $handlerNew = @'
        .invoke_handler(tauri::generate_handler![
            download_and_install_update,
            download_file,
'@
    if (-not $lib.Contains($handlerOld)) {
        throw 'Unexpected Pake lib.rs: invoke handler anchor not found.'
    }
    $lib = $lib.Replace($handlerOld, $handlerNew)
    Set-Content $libPath -Value $lib -Encoding utf8
}

Write-Host "Locked MSI UpgradeCode: $UpgradeCode"
Write-Host 'Added native GitHub MSI updater bridge.'
