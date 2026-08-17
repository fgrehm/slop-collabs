use serde::Serialize;
use std::{fs, io, path::Path, process::Command, time::Duration};

#[derive(Clone, Debug, Serialize)]
pub struct ProcessSample {
    pub pid: i32,
    pub name: String,
    pub cpu_percent: f64,
    pub rss_bytes: u64,
}

#[derive(Clone, Debug, Serialize)]
pub struct Sample {
    pub elapsed_seconds: f64,
    pub cpu_percent: f64,
    pub rss_bytes: u64,
    pub process_count: usize,
    pub processes: Vec<ProcessSample>,
}

#[derive(Clone, Debug)]
struct ProcessState {
    pgrp: i32,
    name: String,
    ticks: u64,
    rss_bytes: u64,
}

fn read_process(pid: i32) -> Option<ProcessState> {
    let stat = fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let (_, rest) = stat.rsplit_once(") ")?;
    let fields: Vec<&str> = rest.split_whitespace().collect();
    // fields[0] is state; fields[2] is process group; fields[11..12] are CPU ticks.
    let pgrp = fields.get(2)?.parse().ok()?;
    let ticks = fields.get(11)?.parse::<u64>().ok()? + fields.get(12)?.parse::<u64>().ok()?;
    let rss_pages = fs::read_to_string(format!("/proc/{pid}/statm"))
        .ok()?
        .split_whitespace()
        .nth(1)?
        .parse::<u64>()
        .ok()?;
    let page_size = unsafe { libc::sysconf(libc::_SC_PAGESIZE) } as u64;
    let name = fs::read_to_string(format!("/proc/{pid}/comm"))
        .unwrap_or_else(|_| pid.to_string())
        .trim()
        .to_owned();
    Some(ProcessState {
        pgrp,
        name,
        ticks,
        rss_bytes: rss_pages * page_size,
    })
}

fn process_group(pgrp: i32) -> Vec<(i32, ProcessState)> {
    let Ok(entries) = fs::read_dir("/proc") else {
        return Vec::new();
    };
    entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let pid = entry.file_name().to_str()?.parse::<i32>().ok()?;
            let state = read_process(pid)?;
            (state.pgrp == pgrp).then_some((pid, state))
        })
        .collect()
}

pub fn sample_group(pgrp: i32, previous: &mut Vec<(i32, u64)>, elapsed: Duration) -> Sample {
    let current = process_group(pgrp);
    let seconds = elapsed.as_secs_f64().max(f64::EPSILON);
    let ticks_per_second = 100.0; // Linux USER_HZ on supported distributions.
    let mut processes = Vec::with_capacity(current.len());
    let mut next = Vec::with_capacity(current.len());
    for (pid, state) in current {
        let old = previous
            .iter()
            .find(|(old_pid, _)| *old_pid == pid)
            .map_or(state.ticks, |(_, ticks)| *ticks);
        let cpu = ((state.ticks.saturating_sub(old) as f64) / ticks_per_second / seconds) * 100.0;
        processes.push(ProcessSample {
            pid,
            name: state.name,
            cpu_percent: cpu,
            rss_bytes: state.rss_bytes,
        });
        next.push((pid, state.ticks));
    }
    *previous = next;
    let cpu_percent = processes.iter().map(|p| p.cpu_percent).sum();
    let rss_bytes = processes.iter().map(|p| p.rss_bytes).sum();
    Sample {
        elapsed_seconds: 0.0,
        cpu_percent,
        rss_bytes,
        process_count: processes.len(),
        processes,
    }
}

pub fn spawn(command: &[String], inherit_output: bool) -> io::Result<std::process::Child> {
    let mut cmd = Command::new(
        command
            .first()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "missing command"))?,
    );
    cmd.args(&command[1..]);
    if !inherit_output {
        cmd.stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
    }
    // The child becomes its own process group, so descendants are included even when
    // their parent changes. This is intentionally Linux-specific (the tool is Linux-only).
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        unsafe {
            cmd.pre_exec(|| {
                if libc::setpgid(0, 0) == 0 {
                    Ok(())
                } else {
                    Err(io::Error::last_os_error())
                }
            });
        }
    }
    cmd.spawn()
}

pub fn write_csv(path: &Path, samples: &[Sample]) -> io::Result<()> {
    let mut out = String::from("elapsed_seconds,cpu_percent,rss_bytes,process_count\n");
    for s in samples {
        out.push_str(&format!(
            "{:.3},{:.3},{},{}\n",
            s.elapsed_seconds, s.cpu_percent, s.rss_bytes, s.process_count
        ));
    }
    fs::write(path, out)
}

pub fn write_json(path: &Path, samples: &[Sample]) -> io::Result<()> {
    fs::write(
        path,
        serde_json::to_vec_pretty(samples).expect("sample serialization cannot fail"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn csv_has_stable_columns() {
        let s = Sample {
            elapsed_seconds: 1.0,
            cpu_percent: 2.0,
            rss_bytes: 3,
            process_count: 1,
            processes: vec![],
        };
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("samples.csv");
        write_csv(&path, &[s]).unwrap();
        assert!(
            fs::read_to_string(path)
                .unwrap()
                .starts_with("elapsed_seconds,cpu_percent,rss_bytes,process_count\n")
        );
    }
    #[test]
    fn empty_command_is_rejected() {
        assert!(spawn(&[], false).is_err());
    }
}
