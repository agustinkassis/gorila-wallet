#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs,
    net::{TcpListener, TcpStream},
    path::Path,
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread::sleep,
    time::{Duration, Instant},
};
use tauri::{webview::NewWindowResponse, Manager, RunEvent, Url, WebviewUrl, WebviewWindowBuilder};

/// Preferred port: a stable origin keeps the webview's localStorage (login, selected wallet, theme) across launches.
const PORT: u16 = 47_291;

struct Server(Mutex<Option<Child>>);

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let data = app.path().app_data_dir()?;
            fs::create_dir_all(&data)?;
            let secret = device_key(&data)?;

            let port = TcpListener::bind(("127.0.0.1", PORT))
                .or_else(|_| TcpListener::bind(("127.0.0.1", 0)))?
                .local_addr()?
                .port();
            let child = start_server(&app.path().resource_dir()?.join("server"), &data, port)?;
            app.manage(Server(Mutex::new(Some(child))));
            wait_for_server(app, port)?;
            // localhost, not 127.0.0.1: Next.js sees request URLs as localhost, and NIP-98 tokens sign the page's URL
            let url: Url = format!("http://localhost:{port}").parse()?;

            let origin = url.origin().ascii_serialization();
            let local = origin.clone();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("Gorilla Wallet")
                .inner_size(1280.0, 840.0)
                .min_inner_size(380.0, 600.0)
                // Built-in NIP-07 signer (components/nostr-provider.tsx), only ever exposed to our own origin.
                .initialization_script(format!(
                    "if (location.origin === {origin:?}) window.__NOSTR_SECRET__ = {secret:?}"
                ))
                // External links (explorers) open in the system browser.
                .on_navigation(move |u| {
                    let ours = u.origin().ascii_serialization() == local;
                    if !ours {
                        open_external(u);
                    }
                    ours
                })
                .on_new_window(|u, _| {
                    open_external(&u);
                    NewWindowResponse::Deny
                })
                // Let <a download> save to the Downloads folder (ignored by default on macOS / Linux).
                .on_download(|_, _| true)
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to start Gorilla Wallet")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(mut child) = app.try_state::<Server>().and_then(|s| s.0.lock().unwrap().take()) {
                    let _ = child.kill();
                }
            }
        });
}

/// The desktop app's Nostr identity: a random key kept next to the database (the first login claims the wallet).
fn device_key(data: &Path) -> Result<String, Box<dyn std::error::Error>> {
    let path = data.join("nostr.key");
    if let Ok(key) = fs::read_to_string(&path) {
        return Ok(key.trim().to_owned());
    }
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes)?;
    let key: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    fs::write(&path, &key)?;
    Ok(key)
}

/// Runs the bundled Next.js standalone server on the bundled Node (`gorilla-node`, next to our executable).
fn start_server(server: &Path, data: &Path, port: u16) -> std::io::Result<Child> {
    let node = std::env::current_exe()?.with_file_name(format!("gorilla-node{}", std::env::consts::EXE_SUFFIX));
    let log = fs::File::create(data.join("server.log"))?;
    let mut cmd = Command::new(node);
    cmd.arg(server.join("start.mjs"))
        .current_dir(server)
        .env("PORT", port.to_string())
        .env("HOSTNAME", "127.0.0.1")
        .env("NODE_ENV", "production")
        .env("DATABASE_URL", format!("file:{}", data.join("wallet.db").display()))
        .stdin(Stdio::piped()) // start.mjs exits when this pipe closes, so a crashed app never leaves the server behind
        .stdout(log.try_clone()?)
        .stderr(log);
    #[cfg(windows)]
    std::os::windows::process::CommandExt::creation_flags(&mut cmd, 0x0800_0000); // CREATE_NO_WINDOW
    cmd.spawn()
}

fn wait_for_server(app: &tauri::App, port: u16) -> Result<(), Box<dyn std::error::Error>> {
    let started = Instant::now();
    while TcpStream::connect(("127.0.0.1", port)).is_err() {
        let state = app.state::<Server>();
        if let Some(status) = state.0.lock().unwrap().as_mut().and_then(|c| c.try_wait().ok().flatten()) {
            return Err(format!("server exited ({status}), see server.log in the app data folder").into());
        }
        if started.elapsed() > Duration::from_secs(60) {
            return Err("server did not start within 60 s, see server.log in the app data folder".into());
        }
        sleep(Duration::from_millis(50));
    }
    Ok(())
}

fn open_external(url: &Url) {
    if matches!(url.scheme(), "http" | "https" | "mailto") {
        let _ = open::that_detached(url.as_str());
    }
}
