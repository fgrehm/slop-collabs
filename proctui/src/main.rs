use clap::{Args, Parser, Subcommand};
use crossterm::{
    event::{self, Event, KeyCode},
    execute,
    terminal::{EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode},
};
use proctui::{Sample, process_group_id, sample_group, spawn, write_csv, write_json};
use ratatui::{
    Terminal,
    backend::CrosstermBackend,
    layout::{Constraint, Direction, Layout},
    style::{Color, Style},
    widgets::{Block, Borders, Gauge, Paragraph, Row, Table},
};
use std::{
    collections::{HashMap, HashSet},
    fs, io,
    path::PathBuf,
    process::Child,
    time::{Duration, Instant},
};

#[derive(Parser, Debug)]
#[command(about = "Measure a Linux process group with a live TUI")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand, Debug)]
enum Command {
    /// Start a command in a new process group.
    Run(RunArgs),
    /// Observe an existing process group without changing it.
    Attach(AttachArgs),
    /// Browse samples exported by proctui as JSON or CSV.
    View(ViewArgs),
}

#[derive(Args, Debug)]
struct MonitorArgs {
    #[arg(
        short,
        long,
        default_value_t = 1.0,
        help = "Sampling interval in seconds"
    )]
    interval: f64,
    #[arg(short, long, help = "Stop after this many seconds")]
    duration: Option<f64>,
    #[arg(long, help = "Write aggregate samples as CSV")]
    csv: Option<PathBuf>,
    #[arg(long, help = "Write aggregate and per-process samples as JSON")]
    json: Option<PathBuf>,
    #[arg(long, help = "Do not open a TUI; useful in scripts/CI")]
    no_tui: bool,
}

#[derive(Args, Debug)]
struct RunArgs {
    #[command(flatten)]
    monitor: MonitorArgs,
    #[arg(long, help = "Pass command stdout/stderr through instead of hiding it")]
    inherit_output: bool,
    #[arg(long, help = "Write the spawned process group ID to this file")]
    pid_file: Option<PathBuf>,
    #[arg(required = true, trailing_var_arg = true)]
    command: Vec<String>,
}

#[derive(Args, Debug)]
struct ViewArgs {
    #[arg(help = "A JSON or CSV export created by proctui")]
    path: PathBuf,
}

#[derive(Args, Debug)]
struct AttachArgs {
    #[command(flatten)]
    monitor: MonitorArgs,
    #[arg(
        long,
        required_unless_present = "pgid",
        conflicts_with = "pgid",
        help = "PID whose process group to observe"
    )]
    pid: Option<i32>,
    #[arg(
        long,
        required_unless_present = "pid",
        conflicts_with = "pid",
        help = "Process group ID to observe"
    )]
    pgid: Option<i32>,
}

fn main() -> io::Result<()> {
    match Cli::parse().command {
        Command::Run(args) => run(args),
        Command::Attach(args) => attach(args),
        Command::View(args) => view(args),
    }
}

fn run(args: RunArgs) -> io::Result<()> {
    let child = spawn(&args.command, args.inherit_output)?;
    let group = child.id() as i32;
    if let Some(path) = args.pid_file.as_deref() {
        fs::write(path, format!("{group}\n"))?;
    }
    eprintln!("proctui: process group {group}");
    eprintln!("proctui: attach elsewhere with: proctui attach --pgid {group}");
    let mut monitor_args = args.monitor;
    // A child that writes to the terminal must retain it, so the monitor belongs in another terminal.
    monitor_args.no_tui |= args.inherit_output;
    monitor(group, Some(child), &monitor_args, true)
}

fn attach(args: AttachArgs) -> io::Result<()> {
    let group = match (args.pid, args.pgid) {
        (Some(pid), None) => process_group_id(pid).ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::NotFound,
                format!("process {pid} was not found"),
            )
        })?,
        (None, Some(pgid)) if pgid > 0 => pgid,
        (None, Some(_)) => {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "process group ID must be positive",
            ));
        }
        _ => unreachable!("clap requires exactly one attachment target"),
    };
    monitor(group, None, &args.monitor, false)
}

fn view(args: ViewArgs) -> io::Result<()> {
    let samples = read_samples(&args.path)?;
    let mut terminal = start_terminal()?;
    let mut index = 0;
    let mut playing = false;
    let mut last_step = Instant::now();

    loop {
        terminal.draw(|frame| {
            draw(
                frame,
                &samples[index],
                "Saved sample",
                "left/right: sample, space: play/pause, q or Esc: close",
            )
        })?;
        if event::poll(Duration::from_millis(50))?
            && let Event::Key(key) = event::read()?
        {
            match key.code {
                KeyCode::Char('q') | KeyCode::Esc => break,
                KeyCode::Left | KeyCode::Char('h') => {
                    index = index.saturating_sub(1);
                    playing = false;
                }
                KeyCode::Right | KeyCode::Char('l') => {
                    index = (index + 1).min(samples.len() - 1);
                    playing = false;
                }
                KeyCode::Char(' ') => playing = !playing,
                _ => {}
            }
        }
        if playing && last_step.elapsed() >= Duration::from_millis(500) {
            if index + 1 == samples.len() {
                playing = false;
            } else {
                index += 1;
                last_step = Instant::now();
            }
        }
    }
    stop_terminal(&mut terminal)
}

fn read_samples(path: &std::path::Path) -> io::Result<Vec<Sample>> {
    let contents = fs::read_to_string(path)?;
    let samples = if contents.trim_start().starts_with('[') {
        serde_json::from_str(&contents).map_err(invalid_export)?
    } else {
        read_csv_samples(&contents)?
    };
    if samples.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "export has no samples",
        ));
    }
    Ok(samples)
}

fn invalid_export(error: serde_json::Error) -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidData,
        format!("invalid JSON export: {error}"),
    )
}

fn read_csv_samples(contents: &str) -> io::Result<Vec<Sample>> {
    let mut lines = contents.lines();
    let header = lines.next().unwrap_or_default();
    let has_memory_breakdown =
        header == "elapsed_seconds,cpu_percent,rss_bytes,pss_bytes,uss_bytes,process_count";
    if !has_memory_breakdown && header != "elapsed_seconds,cpu_percent,rss_bytes,process_count" {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "unrecognized CSV export header",
        ));
    }
    lines
        .enumerate()
        .filter(|(_, line)| !line.is_empty())
        .map(|(index, line)| {
            let fields: Vec<_> = line.split(',').collect();
            let error = || {
                io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!("invalid CSV row {}", index + 2),
                )
            };
            let expected_fields = if has_memory_breakdown { 6 } else { 4 };
            if fields.len() != expected_fields {
                return Err(error());
            }
            Ok(Sample {
                elapsed_seconds: fields[0].parse().map_err(|_| error())?,
                cpu_percent: fields[1].parse().map_err(|_| error())?,
                rss_bytes: fields[2].parse().map_err(|_| error())?,
                pss_bytes: has_memory_breakdown
                    .then(|| parse_optional_csv_bytes(fields[3], index + 2))
                    .transpose()?
                    .flatten(),
                uss_bytes: has_memory_breakdown
                    .then(|| parse_optional_csv_bytes(fields[4], index + 2))
                    .transpose()?
                    .flatten(),
                process_count: fields[if has_memory_breakdown { 5 } else { 3 }]
                    .parse()
                    .map_err(|_| error())?,
                processes: Vec::new(),
            })
        })
        .collect()
}

fn parse_optional_csv_bytes(value: &str, row: usize) -> io::Result<Option<u64>> {
    if value.is_empty() {
        Ok(None)
    } else {
        value.parse().map(Some).map_err(|_| {
            io::Error::new(io::ErrorKind::InvalidData, format!("invalid CSV row {row}"))
        })
    }
}

fn monitor(
    group: i32,
    mut child: Option<Child>,
    args: &MonitorArgs,
    kill_on_quit: bool,
) -> io::Result<()> {
    let interval = Duration::from_secs_f64(args.interval.max(0.05));
    let started = Instant::now();
    let mut last = Instant::now();
    let mut previous = Vec::new();
    let mut samples = Vec::new();
    let mut terminal = (!args.no_tui).then(start_terminal).transpose()?;

    loop {
        let now = Instant::now();
        if now.duration_since(last) < interval {
            std::thread::sleep(interval - now.duration_since(last));
        }
        let now = Instant::now();
        let mut sample = sample_group(group, &mut previous, now.duration_since(last));
        sample.elapsed_seconds = now.duration_since(started).as_secs_f64();
        last = now;
        let group_is_empty = sample.process_count == 0;
        samples.push(sample);

        if let Some(terminal) = terminal.as_mut() {
            terminal.draw(|frame| {
                draw(
                    frame,
                    samples.last().expect("sample was just pushed"),
                    "Process group (q or Esc to stop observing)",
                    "proctui, samples are written when monitoring ends",
                )
            })?;
            if event::poll(Duration::from_millis(1))?
                && matches!(event::read()?, Event::Key(key) if key.code == KeyCode::Char('q') || key.code == KeyCode::Esc)
            {
                if kill_on_quit {
                    kill_process_group(group);
                }
                break;
            }
        }
        if let Some(child) = child.as_mut()
            && child.try_wait()?.is_some()
        {
            break;
        }
        if group_is_empty
            || args
                .duration
                .is_some_and(|limit| started.elapsed().as_secs_f64() >= limit)
        {
            if kill_on_quit {
                kill_process_group(group);
            }
            break;
        }
    }

    if let Some(mut terminal) = terminal {
        stop_terminal(&mut terminal)?;
    }
    if let Some(path) = args.csv.as_deref() {
        write_csv(path, &samples)?;
    }
    if let Some(path) = args.json.as_deref() {
        write_json(path, &samples)?;
    }
    if let Some(child) = child.as_mut() {
        let _ = child.wait();
    }
    Ok(())
}

fn kill_process_group(group: i32) {
    // A negative PID directs kill(2) at the process group rather than only its leader.
    unsafe { libc::kill(-group, libc::SIGKILL) };
}

fn start_terminal() -> io::Result<Terminal<CrosstermBackend<io::Stdout>>> {
    enable_raw_mode()?;
    let mut out = io::stdout();
    execute!(out, EnterAlternateScreen)?;
    Terminal::new(CrosstermBackend::new(out))
}

fn stop_terminal(terminal: &mut Terminal<CrosstermBackend<io::Stdout>>) -> io::Result<()> {
    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()
}

fn draw(frame: &mut ratatui::Frame, sample: &Sample, process_title: &str, footer: &str) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(4),
            Constraint::Min(4),
            Constraint::Length(1),
        ])
        .split(frame.area());
    let cpu = (sample.cpu_percent / 100.0).min(1.0);
    let header = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
        .split(chunks[0]);
    frame.render_widget(
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
    frame.render_widget(
        Paragraph::new(format!(
            "RSS  {}\nPSS  {}\nUSS  {}\nProcesses  {}\nElapsed  {:.1}s",
            bytes(sample.rss_bytes),
            bytes_option(sample.pss_bytes),
            bytes_option(sample.uss_bytes),
            sample.process_count,
            sample.elapsed_seconds
        ))
        .block(Block::default().title("Resources").borders(Borders::ALL)),
        header[1],
    );
    let rows = process_tree(&sample.processes)
        .into_iter()
        .map(|(process, name)| {
            Row::new([
                process.pid.to_string(),
                name,
                format!("{:.1}%", process.cpu_percent),
                bytes(process.rss_bytes),
                bytes_option(process.pss_bytes),
                bytes_option(process.uss_bytes),
            ])
        });
    frame.render_widget(
        Table::new(
            rows,
            [
                Constraint::Length(8),
                Constraint::Min(16),
                Constraint::Length(9),
                Constraint::Length(11),
                Constraint::Length(11),
                Constraint::Length(11),
            ],
        )
        .header(
            Row::new(["PID", "PROCESS", "CPU", "RSS", "PSS", "USS"])
                .style(Style::default().fg(Color::Yellow)),
        )
        .block(Block::default().title(process_title).borders(Borders::ALL)),
        chunks[1],
    );
    frame.render_widget(Paragraph::new(footer), chunks[2]);
}

fn process_tree(processes: &[proctui::ProcessSample]) -> Vec<(proctui::ProcessSample, String)> {
    let process_ids: HashSet<_> = processes.iter().map(|process| process.pid).collect();
    let mut children: HashMap<i32, Vec<proctui::ProcessSample>> = HashMap::new();
    let mut roots = Vec::new();
    for process in processes {
        if process_ids.contains(&process.parent_pid) {
            children
                .entry(process.parent_pid)
                .or_default()
                .push(process.clone());
        } else {
            roots.push(process.clone());
        }
    }
    for nodes in children.values_mut() {
        nodes.sort_by_key(|process| process.pid);
    }
    roots.sort_by_key(|process| process.pid);

    let mut rows = Vec::with_capacity(processes.len());
    let mut visited = HashSet::new();
    for (index, root) in roots.iter().enumerate() {
        append_tree_row(
            root,
            "",
            index + 1 == roots.len(),
            &children,
            &mut visited,
            &mut rows,
        );
    }
    for process in processes {
        if !visited.contains(&process.pid) {
            append_tree_row(process, "", true, &children, &mut visited, &mut rows);
        }
    }
    rows
}

fn append_tree_row(
    process: &proctui::ProcessSample,
    prefix: &str,
    is_last: bool,
    children: &HashMap<i32, Vec<proctui::ProcessSample>>,
    visited: &mut HashSet<i32>,
    rows: &mut Vec<(proctui::ProcessSample, String)>,
) {
    if !visited.insert(process.pid) {
        return;
    }
    let branch = if prefix.is_empty() {
        ""
    } else if is_last {
        "└─ "
    } else {
        "├─ "
    };
    rows.push((process.clone(), format!("{prefix}{branch}{}", process.name)));
    let child_prefix = if prefix.is_empty() {
        " ".to_string()
    } else if is_last {
        format!("{prefix}   ")
    } else {
        format!("{prefix}│  ")
    };
    if let Some(nodes) = children.get(&process.pid) {
        for (index, child) in nodes.iter().enumerate() {
            append_tree_row(
                child,
                &child_prefix,
                index + 1 == nodes.len(),
                children,
                visited,
                rows,
            );
        }
    }
}

fn bytes_option(value: Option<u64>) -> String {
    value.map_or_else(|| "-".to_string(), bytes)
}

fn bytes(n: u64) -> String {
    const UNITS: &[&str] = &["B", "KiB", "MiB", "GiB"];
    let mut value = n as f64;
    let mut index = 0;
    while value >= 1024.0 && index < UNITS.len() - 1 {
        value /= 1024.0;
        index += 1;
    }
    format!("{value:.1} {}", UNITS[index])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csv_viewer_reads_aggregate_samples() {
        let samples = read_csv_samples(
            "elapsed_seconds,cpu_percent,rss_bytes,process_count\n1.000,12.500,1024,2\n",
        )
        .expect("CSV should parse");

        assert_eq!(samples[0].process_count, 2);
    }

    #[test]
    fn csv_viewer_rejects_unknown_headers() {
        let error = read_csv_samples("time,cpu\n1,2\n").expect_err("header should be rejected");

        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
    }

    #[test]
    fn process_tree_nests_group_members_under_their_parent() {
        let processes = vec![
            process(10, 1, "root"),
            process(11, 10, "child"),
            process(12, 11, "grandchild"),
        ];
        let rows = process_tree(&processes);

        assert_eq!(rows[2].1, "    └─ grandchild");
    }

    fn process(pid: i32, parent_pid: i32, name: &str) -> proctui::ProcessSample {
        proctui::ProcessSample {
            pid,
            parent_pid,
            name: name.to_string(),
            cpu_percent: 0.0,
            rss_bytes: 0,
            pss_bytes: None,
            uss_bytes: None,
        }
    }
}
