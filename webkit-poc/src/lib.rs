//! Input and launch policy for the minimal WebKit harness.
//!
//! This module intentionally has no GTK/WebKit dependencies so it remains easy
//! to test in CI and while system libraries are not installed.

pub const DEFAULT_URL: &str = "https://web.whatsapp.com";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchOptions {
    pub url: String,
}

impl Default for LaunchOptions {
    fn default() -> Self {
        Self {
            url: DEFAULT_URL.to_owned(),
        }
    }
}

impl LaunchOptions {
    pub fn from_args<I, S>(args: I) -> Result<Self, String>
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        let mut options = Self::default();
        let mut args = args.into_iter().map(Into::into);

        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--url" => {
                    options.url = args
                        .next()
                        .ok_or_else(|| "--url requires a URL".to_owned())?;
                }
                "--help" | "-h" => {
                    return Err("usage: webkit-poc [--url URL]".to_owned());
                }
                other => return Err(format!("unknown argument: {other}")),
            }
        }

        validate_url(&options.url)?;
        Ok(options)
    }
}

fn validate_url(url: &str) -> Result<(), String> {
    let has_web_scheme = url.starts_with("http://") || url.starts_with("https://");
    if has_web_scheme && url.len() > url.find("://").unwrap() + 3 {
        Ok(())
    } else {
        Err(format!("URL must be an absolute HTTP(S) URL: {url}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_to_whatsapp_web() {
        assert_eq!(
            LaunchOptions::from_args(std::iter::empty::<&str>()).unwrap(),
            LaunchOptions::default()
        );
    }

    #[test]
    fn accepts_a_custom_http_url() {
        let options = LaunchOptions::from_args(["--url", "http://localhost:8080"]).unwrap();
        assert_eq!(options.url, "http://localhost:8080");
    }

    #[test]
    fn rejects_missing_url_value() {
        assert_eq!(
            LaunchOptions::from_args(["--url"]).unwrap_err(),
            "--url requires a URL"
        );
    }

    #[test]
    fn rejects_non_http_urls() {
        let error = LaunchOptions::from_args(["--url", "file:///tmp/page.html"]).unwrap_err();
        assert!(error.contains("absolute HTTP(S) URL"));
    }
}
