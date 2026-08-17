use clap::Parser;
use crossterm::{
    event::{self, Event, KeyCode},
    execute,
    terminal::{EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode},
};
use proctui::{Sample, sample_group, spawn, write_csv, write_json};
use ratatui::{
    Terminal,
    backend::CrosstermBackend,
    layout::{Constraint, Direction, Layout},
    style::{Color, Style},
    widgets::{Block, Borders, Gauge, Paragraph, Row, Table},
};
use std::{
    io,
    time::{Duration, Instant},
};

#[derive(Parser, Debug)]
#[command(about = "Measure a command and its Linux process group with a live TUI")]
struct Args {
    #[arg(
        short,
        long,
        default_value_t = 1.0,
        help = "Sampling interval in seconds"
    )]
    interval: f64,
    #[arg(
        short,
        long,
        help = "Stop after this many seconds (otherwise until command exits)"
    )]
    duration: Option<f64>,
    #[arg(long, help = "Write aggregate samples as CSV")]
    csv: Option<std::path::PathBuf>,
    #[arg(long, help = "Write aggregate and per-process samples as JSON")]
    json: Option<std::path::PathBuf>,
    #[arg(long, help = "Do not open a TUI; useful in scripts/CI")]
    no_tui: bool,
    #[arg(long, help = "Pass command stdout/stderr through instead of hiding it")]
    inherit_output: bool,
    #[arg(required = true, trailing_var_arg = true)]
    command: Vec<String>,
}

fn main() -> io::Result<()> {
    let args = Args::parse();
    let mut child = spawn(&args.command, args.inherit_output)?;
    let group = child.id() as i32;
    let interval = Duration::from_secs_f64(args.interval.max(0.05));
    let started = Instant::now();
    let mut last = Instant::now();
    let mut previous = Vec::new();
    let mut samples = Vec::new();
    let mut terminal = if args.no_tui {
        None
    } else {
        Some(start_terminal()?)
    };
    loop {
        let now = Instant::now();
        if now.duration_since(last) < interval {
            std::thread::sleep(interval - now.duration_since(last));
        }
        let now = Instant::now();
        let mut sample = sample_group(group, &mut previous, now.duration_since(last));
        sample.elapsed_seconds = now.duration_since(started).as_secs_f64();
        last = now;
        samples.push(sample);
        if let Some(t) = terminal.as_mut() {
            t.draw(|f| draw(f, samples.last().unwrap()))?;
            if event::poll(Duration::from_millis(1))?
                && matches!(event::read()?, Event::Key(k) if k.code == KeyCode::Char('q') || k.code == KeyCode::Esc)
            {
                let _ = child.kill();
                break;
            }
        }
        if child.try_wait()?.is_some() {
            break;
        }
        if args
            .duration
            .is_some_and(|limit| started.elapsed().as_secs_f64() >= limit)
        {
            let _ = child.kill();
            break;
        }
    }
    if let Some(mut t) = terminal {
        stop_terminal(&mut t)?;
    }
    if let Some(path) = args.csv {
        write_csv(&path, &samples)?;
    }
    if let Some(path) = args.json {
        write_json(&path, &samples)?;
    }
    let _ = child.wait();
    Ok(())
}

fn start_terminal() -> io::Result<Terminal<CrosstermBackend<io::Stdout>>> {
    enable_raw_mode()?;
    let mut out = io::stdout();
    execute!(out, EnterAlternateScreen)?;
    Terminal::new(CrosstermBackend::new(out))
}
fn stop_terminal(t: &mut Terminal<CrosstermBackend<io::Stdout>>) -> io::Result<()> {
    disable_raw_mode()?;
    execute!(t.backend_mut(), LeaveAlternateScreen)?;
    t.show_cursor()
}

fn draw(f: &mut ratatui::Frame, sample: &Sample) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(4),
            Constraint::Min(4),
            Constraint::Length(1),
        ])
        .split(f.area());
    let cpu = (sample.cpu_percent / 100.0).min(1.0);
    let header = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
        .split(chunks[0]);
    f.render_widget(
        Gauge::default()
            .block(
                Block::default()
                    .title("CPU (100% = one core)")
                    .borders(Borders::ALL),
            )
            .gauge_style(Style::default().fg(Color::Cyan))
            .ratio(cpu)
            .label(format!("{:.1}%", sample.cpu_percent)),
        header[0],
    );
    f.render_widget(
        Paragraph::new(format!(
            "RSS  {}\nProcesses  {}\nElapsed  {:.1}s",
            bytes(sample.rss_bytes),
            sample.process_count,
            sample.elapsed_seconds
        ))
        .block(Block::default().title("Resources").borders(Borders::ALL)),
        header[1],
    );
    let rows = sample
        .processes
        .iter()
        .cloned()
        .map(|p| {
            Row::new([
                p.pid.to_string(),
                p.name,
                format!("{:.1}%", p.cpu_percent),
                bytes(p.rss_bytes),
            ])
        })
        .collect::<Vec<_>>();
    f.render_widget(
        Table::new(
            rows,
            [
                Constraint::Length(8),
                Constraint::Min(20),
                Constraint::Length(10),
                Constraint::Length(12),
            ],
        )
        .header(
            Row::new(["PID", "PROCESS", "CPU", "RSS"]).style(Style::default().fg(Color::Yellow)),
        )
        .block(
            Block::default()
                .title("Process group (q or Esc to stop)")
                .borders(Borders::ALL),
        ),
        chunks[1],
    );
    f.render_widget(
        Paragraph::new("proctui — samples are also written when the command exits"),
        chunks[2],
    );
}
fn bytes(n: u64) -> String {
    const UNITS: &[&str] = &["B", "KiB", "MiB", "GiB"];
    let mut value = n as f64;
    let mut i = 0;
    while value >= 1024.0 && i < UNITS.len() - 1 {
        value /= 1024.0;
        i += 1;
    }
    format!("{value:.1} {}", UNITS[i])
}
