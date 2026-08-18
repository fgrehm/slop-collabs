use gtk4::{gio, glib, prelude::*};
use webkit6::prelude::*;

use webkit_poc::{LINUX_CHROME_USER_AGENT, LaunchOptions, ProfilePaths};

fn main() -> glib::ExitCode {
    let options = match LaunchOptions::from_args(std::env::args().skip(1)) {
        Ok(options) => options,
        Err(error) => {
            eprintln!("{error}");
            return glib::ExitCode::FAILURE;
        }
    };

    let profile = ProfilePaths::persistent();
    for directory in [&profile.data, &profile.cache] {
        if let Err(error) = std::fs::create_dir_all(directory) {
            eprintln!(
                "failed to create WebKit profile directory {}: {error}",
                directory.display()
            );
            return glib::ExitCode::FAILURE;
        }
    }

    let application =
        gtk4::Application::new(Some("dev.fgrehm.WebkitPoc"), gio::ApplicationFlags::empty());
    let quit_action = gio::SimpleAction::new("quit", None);
    quit_action.connect_activate(glib::clone!(
        #[weak]
        application,
        move |_, _| application.quit()
    ));
    application.add_action(&quit_action);
    application.set_accels_for_action("app.quit", &["<Control>w", "<Control>q"]);

    let url = options.url;
    application.connect_activate(move |application| {
        let data_directory = profile.data.to_string_lossy();
        let cache_directory = profile.cache.to_string_lossy();
        let session = webkit6::NetworkSession::new(
            Some(data_directory.as_ref()),
            Some(cache_directory.as_ref()),
        );
        let settings = webkit6::Settings::builder()
            .user_agent(LINUX_CHROME_USER_AGENT)
            .build();
        let webview = webkit6::WebView::builder()
            .network_session(&session)
            .settings(&settings)
            .build();
        webview.load_uri(&url);

        let window = gtk4::ApplicationWindow::builder()
            .application(application)
            .title("WebKitGTK 6 PoC")
            .default_width(1280)
            .default_height(900)
            .build();
        window.set_child(Some(&webview));
        window.present();
    });

    application.run()
}
