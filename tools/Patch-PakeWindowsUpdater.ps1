[CmdletBinding()]
param(
    [string]$PakeRoot = '',
    [string]$UpgradeCode = '18f5c230-146b-5d19-988a-6204008097ea'
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

# 2) Add the native updater command.
$invoke = Get-Content $invokePath -Raw
if ($invoke -notmatch 'download_and_install_update') {
    $anchorMatch = [regex]::Match(
        $invoke,
        '(?m)^#\[command\]\s*\r?\npub fn send_notification'
    )
    if (-not $anchorMatch.Success) {
        throw 'Unexpected Pake invoke.rs: send_notification command anchor not found.'
    }

    $commandInsert = @'
#[derive(serde::Deserialize)]
pub struct InstallUpdateParams {
    url: String,
    filename: String,
}

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
        || !filename.ends_with("-Windows-x64-Setup.msi")
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

'@

    $invoke = $invoke.Insert($anchorMatch.Index, $commandInsert)
}

# 3) Add a narrow native HTTP bridge for client-first translation/network calls.
#    It deliberately exposes less surface area than a generic reqwest wrapper:
#    - GET/POST only; HTTP/HTTPS only
#    - bounded timeout, headers, request body, response body and redirects
#    - no Cookie/Host/hop-by-hop/proxy-auth header injection
#    - explicit HTTP(S) forward proxy support, or optional system-proxy inheritance
if ($invoke -notmatch 'native_http_request') {
    $anchorMatch = [regex]::Match(
        $invoke,
        '(?m)^#\[command\]\s*\r?\npub fn send_notification'
    )
    if (-not $anchorMatch.Success) {
        throw 'Unexpected Pake invoke.rs: send_notification command anchor not found for native HTTP bridge.'
    }

    $nativeHttpInsert = @'
const MAX_NATIVE_HTTP_REQUEST_BODY_BYTES: usize = 1024 * 1024;
const MAX_NATIVE_HTTP_RESPONSE_BODY_BYTES: usize = 4 * 1024 * 1024;
const MAX_NATIVE_HTTP_HEADERS: usize = 32;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeHttpRequestParams {
    url: String,
    method: Option<String>,
    headers: Option<std::collections::HashMap<String, String>>,
    body: Option<String>,
    timeout_ms: Option<u64>,
    proxy_url: Option<String>,
    use_system_proxy: Option<bool>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeHttpResponse {
    status: u16,
    headers: std::collections::HashMap<String, String>,
    body: String,
}

#[command]
pub async fn native_http_request(
    params: NativeHttpRequestParams,
) -> Result<NativeHttpResponse, String> {
    let url = Url::from_str(params.url.trim())
        .map_err(|e| format!("Invalid native HTTP URL: {e}"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("Native HTTP only allows http:// or https:// URLs.".into());
    }

    let method_text = params
        .method
        .as_deref()
        .unwrap_or("GET")
        .trim()
        .to_ascii_uppercase();
    let method = match method_text.as_str() {
        "GET" => Method::GET,
        "POST" => Method::POST,
        _ => return Err("Native HTTP only allows GET and POST.".into()),
    };

    let body = params.body.unwrap_or_default();
    if body.as_bytes().len() > MAX_NATIVE_HTTP_REQUEST_BODY_BYTES {
        return Err("Native HTTP request body exceeds 1 MiB.".into());
    }
    if method == Method::GET && !body.is_empty() {
        return Err("Native HTTP GET requests cannot include a body.".into());
    }

    let timeout_ms = params.timeout_ms.unwrap_or(15_000).clamp(2_500, 120_000);
    let mut client_builder = ClientBuilder::new()
        .timeout(std::time::Duration::from_millis(timeout_ms))
        .redirect(tauri_plugin_http::reqwest::redirect::Policy::limited(5));

    let proxy_url = params
        .proxy_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(proxy_url) = proxy_url {
        let parsed = Url::from_str(proxy_url)
            .map_err(|e| format!("Invalid proxy URL: {e}"))?;
        if !matches!(parsed.scheme(), "http" | "https") {
            return Err("Native HTTP explicit proxy currently supports http:// or https:// only.".into());
        }
        let proxy = tauri_plugin_http::reqwest::Proxy::all(proxy_url)
            .map_err(|e| format!("Invalid proxy configuration: {e}"))?;
        client_builder = client_builder.proxy(proxy);
    } else if params.use_system_proxy == Some(false) {
        client_builder = client_builder.no_proxy();
    }

    let client = client_builder
        .build()
        .map_err(|e| format!("Failed to build native HTTP client: {e}"))?;
    let mut request = Request::new(method, url);

    let headers = params.headers.unwrap_or_default();
    if headers.len() > MAX_NATIVE_HTTP_HEADERS {
        return Err(format!("Native HTTP allows at most {MAX_NATIVE_HTTP_HEADERS} request headers."));
    }
    for (name, value) in headers {
        if name.len() > 128 || value.len() > 8192 {
            return Err("Native HTTP request header is too large.".into());
        }
        let lower = name.trim().to_ascii_lowercase();
        if matches!(
            lower.as_str(),
            "cookie"
                | "set-cookie"
                | "host"
                | "content-length"
                | "connection"
                | "transfer-encoding"
                | "proxy-authorization"
                | "proxy-authenticate"
        ) {
            return Err(format!("Native HTTP blocks unsafe request header: {name}"));
        }
        let header_name = tauri_plugin_http::reqwest::header::HeaderName::from_bytes(name.trim().as_bytes())
            .map_err(|e| format!("Invalid request header name {name}: {e}"))?;
        let header_value = tauri_plugin_http::reqwest::header::HeaderValue::from_str(&value)
            .map_err(|e| format!("Invalid request header value for {name}: {e}"))?;
        request.headers_mut().insert(header_name, header_value);
    }

    if !body.is_empty() {
        *request.body_mut() = Some(tauri_plugin_http::reqwest::Body::from(body));
    }

    let mut response = client
        .execute(request)
        .await
        .map_err(|e| format!("Native HTTP request failed: {e}"))?;
    let status = response.status().as_u16();

    let mut response_headers = std::collections::HashMap::new();
    for name in ["content-type", "retry-after"] {
        if let Some(value) = response.headers().get(name) {
            if let Ok(value) = value.to_str() {
                response_headers.insert(name.to_string(), value.to_string());
            }
        }
    }

    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("Failed to read native HTTP response: {e}"))?
    {
        if bytes.len().saturating_add(chunk.len()) > MAX_NATIVE_HTTP_RESPONSE_BODY_BYTES {
            return Err("Native HTTP response exceeds 4 MiB.".into());
        }
        bytes.extend_from_slice(&chunk);
    }

    Ok(NativeHttpResponse {
        status,
        headers: response_headers,
        body: String::from_utf8_lossy(&bytes).into_owned(),
    })
}

'@

    $invoke = $invoke.Insert($anchorMatch.Index, $nativeHttpInsert)
}

Set-Content $invokePath -Value $invoke -Encoding utf8

# 4) Register both custom commands in the Tauri invoke handler. Keep this idempotent
#    so an already-patched local Pake tree can be patched again safely.
$lib = Get-Content $libPath -Raw
foreach ($command in @('download_and_install_update', 'native_http_request')) {
    if ($lib -notmatch "(?m)\b$([regex]::Escape($command))\b") {
        $updated = [regex]::Replace(
            $lib,
            'invoke::\{\s*',
            "invoke::{ $command, ",
            1
        )
        if ($updated -eq $lib) {
            throw "Unexpected Pake lib.rs: invoke import block not found while registering $command."
        }
        $lib = $updated

        $updated = [regex]::Replace(
            $lib,
            '\.invoke_handler\(tauri::generate_handler!\[\s*',
            ".invoke_handler(tauri::generate_handler![ $command, ",
            1
        )
        if ($updated -eq $lib) {
            throw "Unexpected Pake lib.rs: invoke handler block not found while registering $command."
        }
        $lib = $updated
    }
}
Set-Content $libPath -Value $lib -Encoding utf8

Write-Host "Locked MSI UpgradeCode: $UpgradeCode"
Write-Host 'Added native GitHub MSI updater bridge.'
Write-Host 'Added guarded native HTTP bridge for client networking.'
