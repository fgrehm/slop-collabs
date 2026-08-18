use serde::{Deserialize, Serialize};
use std::{fs, io, path::Path, process::Command, time::Duration};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ProcessSample {
    pub pid: i32,
    #[serde(default)]
    pub parent_pid: i32,
    pub name: String,
    pub cpu_percent: f64,
    pub rss_bytes: u64,
    pub pss_bytes: Option<u64>,
    pub uss_bytes: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Sample {
    pub elapsed_seconds: f64,
    pub cpu_percent: f64,
    pub rss_bytes: u64,
    pub pss_bytes: Option<u64>,
    pub uss_bytes: Option<u64>,
    pub process_count: usize,
    pub processes: Vec<ProcessSample>,
}

#[derive(Clone, Debug)]
struct ProcessState {
    parent_pid: i32,
    pgrp: i32,
    name: String,
    ticks: u64,
    rss_bytes: u64,
    pss_bytes: Option<u64>,
    uss_bytes: Option<u64>,
}

fn read_process(pid: i32) -> Option<ProcessState> {
    let stat = fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let (_, rest) = stat.rsplit_once(") ")?;
    let fields: Vec<&str> = rest.split_whitespace().collect();
    // `fields[0]` is state, `fields[1..2]` identify the parent/group, and `fields[11..12]` are CPU ticks.
    let parent_pid = fields.get(1)?.parse().ok()?;
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
    let (pss_bytes, uss_bytes) = read_smaps_rollup(pid);
    Some(ProcessState {
        parent_pid,
        pgrp,
        name,
        ticks,
        rss_bytes: rss_pages * page_size,
        pss_bytes,
        uss_bytes,
    })
}

fn read_smaps_rollup(pid: i32) -> (Option<u64>, Option<u64>) {
    let Ok(contents) = fs::read_to_string(format!("/proc/{pid}/smaps_rollup")) else {
        return (None, None);
    };
    let pss = smaps_value(&contents, "Pss:");
    let private_clean = smaps_value(&contents, "Private_Clean:").unwrap_or(0);
    let private_dirty = smaps_value(&contents, "Private_Dirty:").unwrap_or(0);
    let uss = (private_clean > 0 || private_dirty > 0).then_some(private_clean + private_dirty);
    (pss, uss)
}

fn smaps_value(contents: &str, field: &str) -> Option<u64> {
    contents.lines().find_map(|line| {
        line.strip_prefix(field)?
            .split_whitespace()
            .next()?
            .parse::<u64>()
            .ok()
            .map(|kilobytes| kilobytes * 1024)
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

/// Return the process group ID for `pid` as reported by `/proc`.
pub fn process_group_id(pid: i32) -> Option<i32> {
    read_process(pid).map(|state| state.pgrp)
}

pub fn sample_group(pgrp: i32, previous: &mut Vec<(i32, u64)>, elapsed: Duration) -> Sample {
    let current = process_group(pgrp);
    let seconds = elapsed.as_secs_f64().max(f64::EPSILON);
    let ticks_per_second = clock_ticks_per_second();
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
            parent_pid: state.parent_pid,
            name: state.name,
            cpu_percent: cpu,
            rss_bytes: state.rss_bytes,
            pss_bytes: state.pss_bytes,
            uss_bytes: state.uss_bytes,
        });
        next.push((pid, state.ticks));
    }
    *previous = next;
    let cpu_percent = processes.iter().map(|process| process.cpu_percent).sum();
    let rss_bytes = processes.iter().map(|process| process.rss_bytes).sum();
    let pss_bytes = sum_optional_bytes(processes.iter().map(|process| process.pss_bytes));
    let uss_bytes = sum_optional_bytes(processes.iter().map(|process| process.uss_bytes));
    Sample {
        elapsed_seconds: 0.0,
        cpu_percent,
        rss_bytes,
        pss_bytes,
        uss_bytes,
        process_count: processes.len(),
        processes,
    }
}

fn clock_ticks_per_second() -> f64 {
    let value = unsafe { libc::sysconf(libc::_SC_CLK_TCK) };
    if value > 0 { value as f64 } else { 100.0 }
}

fn sum_optional_bytes(values: impl Iterator<Item = Option<u64>>) -> Option<u64> {
    let mut found = false;
    let total = values.flatten().inspect(|_| found = true).sum();
    found.then_some(total)
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
    let mut out =
        String::from("elapsed_seconds,cpu_percent,rss_bytes,pss_bytes,uss_bytes,process_count\n");
    for sample in samples {
        out.push_str(&format!(
            "{:.3},{:.3},{},{},{},{}\n",
            sample.elapsed_seconds,
            sample.cpu_percent,
            sample.rss_bytes,
            optional_bytes(sample.pss_bytes),
            optional_bytes(sample.uss_bytes),
            sample.process_count
        ));
    }
    fs::write(path, out)
}

fn optional_bytes(value: Option<u64>) -> String {
    value.map_or_else(String::new, |value| value.to_string())
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
        let sample = Sample {
            elapsed_seconds: 1.0,
            cpu_percent: 2.0,
            rss_bytes: 3,
            pss_bytes: Some(4),
            uss_bytes: Some(5),
            process_count: 1,
            processes: vec![],
        };
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("samples.csv");
        write_csv(&path, &[sample]).unwrap();

        assert!(fs::read_to_string(path).unwrap().starts_with(
            "elapsed_seconds,cpu_percent,rss_bytes,pss_bytes,uss_bytes,process_count\n"
        ));
    }

    #[test]
    fn smaps_value_converts_kilobytes_to_bytes() {
        assert_eq!(
            smaps_value("Pss:                42 kB\n", "Pss:"),
            Some(42 * 1024)
        );
    }

    #[test]
    fn empty_command_is_rejected() {
        assert!(spawn(&[], false).is_err());
    }
}
