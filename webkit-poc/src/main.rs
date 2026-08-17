use gtk4::{gio, glib, prelude::*};
use webkit6::prelude::*;

use webkit_poc::LaunchOptions;

fn main() -> glib::ExitCode {
    let options = match LaunchOptions::from_args(std::env::args().skip(1)) {
        Ok(options) => options,
        Err(error) => {
            eprintln!("{error}");
            return glib::ExitCode::FAILURE;
        }
    };

    let application =
        gtk4::Application::new(Some("dev.fgrehm.WebkitPoc"), gio::ApplicationFlags::empty());
    let url = options.url;
    application.connect_activate(move |application| {
        let webview = webkit6::WebView::new();
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
