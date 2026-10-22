#![allow(dead_code)]
use midir::{MidiInput, MidiOutput, MidiOutputConnection};
use std::error::Error;
use std::sync::{
    atomic::{AtomicBool, AtomicU8, Ordering},
    mpsc::{self, RecvTimeoutError, Sender},
};
use std::thread::{self, JoinHandle};
use std::time::Duration;
static MODE: AtomicU8 = AtomicU8::new(0);

// MODE.load(Ordering::Relaxed);
// MODE.store(1, Ordering::Relaxed);

struct Interval {
    stop_tx: Option<Sender<()>>,
    handle: Option<JoinHandle<()>>,
}

impl Interval {
    fn new() -> Self {
        Self {
            stop_tx: None,
            handle: None,
        }
    }

    fn start(&mut self) {
        if self.handle.is_some() {
            return;
        }
        let (tx, rx) = mpsc::channel();
        self.stop_tx = Some(tx);
        self.handle = Some(thread::spawn(move || {
            loop {
                loop_update();

                match rx.recv_timeout(Duration::from_secs(5)) {
                    Ok(()) | Err(RecvTimeoutError::Disconnected) => break,
                    Err(RecvTimeoutError::Timeout) => {}
                }
            }
        }));
    }

    fn stop(&mut self) {
        if let Some(tx) = self.stop_tx.take() {
            let _ = tx.send(());
        }
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

fn loop_update() {
    println!("Running...");
}

fn main() -> Result<(), Box<dyn Error>> {
    let midi_out = MidiOutput::new("Launchpad Rust Output")?;
    let out_port = midi_out
        .ports()
        .into_iter()
        .find(|port| {
            midi_out
                .port_name(port)
                .map(|name| name.contains("Launchpad X") && name.contains("MIDI"))
                .unwrap_or(false)
        })
        .ok_or("Launchpad X output port not found")?;
    let mut lout = midi_out.connect(&out_port, "launchpad-output")?;

    // let message: [u8; 13] = [240, 0, 32, 41, 2, 12, 3, 3, 99, 0, 0, 124, 247];
    // lout.send(&message)?;
    set_leds(&mut lout, &[vec![71, 0, 5], vec![72, 0, 42]])?;

    set_all_leds(&mut lout, [0, 0].as_slice())?;
    led_palette(&mut lout)?;

    let mut updaters: Vec<Interval> = Vec::new();
    updaters.push(Interval::new());

    let midi_in = MidiInput::new("Launchpad Rust Input")?;
    let in_port = midi_in
        .ports()
        .into_iter()
        .find(|port| {
            midi_in
                .port_name(port)
                .map(|name| name.contains("Launchpad X") && name.contains("MIDI"))
                .unwrap_or(false)
        })
        .ok_or("Launchpad X input port not found")?;

    let (tx, rx) = mpsc::channel::<[u8; 2]>();
    let _input_conn = midi_in.connect(
        &in_port,
        "launchpad-input",
        move |_timestamp, message, _| {
            if message.len() < 3 {
                return;
            }
            if message[0] & 0xF0 == 0x90 || message[0] & 0xF0 == 0xB0 {
                let _ = tx.send([message[1], message[2]]);
            }
        },
        (),
    )?;
    for note in rx {
        handle_input(&mut lout, note[0], note[1], &mut updaters);
    }

    Ok(())
}

fn set_leds(lout: &mut MidiOutputConnection, spec: &[Vec<u8>]) -> Result<(), String> {
    if spec.len() == 1 && spec[0][0] != 3 {
        return lout
            .send([144, spec[0][0], spec[0][2]].as_slice())
            .map_err(|e| e.to_string());
    }
    if spec.len() > 81 {
        return Err("Max 81 colourspecs at a time".to_string());
    }

    let mut data: Vec<u8> = Vec::new();
    for info in spec {
        if info.len() < 3 {
            return Err("Invalid colourspec".to_string());
        }
        data.extend([info[1], info[0]]);

        if info[1] == 3 {
            if info.len() < 5 {
                return Err("RGB colourspec requires 5 values".to_string());
            }
            data.extend([info[2] / 2, info[3] / 2, info[4] / 2]);
        } else {
            data.push(info[2]);
        }
    }

    let mut message = vec![240, 0, 32, 41, 2, 12, 3];
    message.extend(data);
    message.push(247);
    lout.send(&message).map_err(|e| e.to_string())
}
fn set_all_leds(lout: &mut MidiOutputConnection, spec: &[u8]) -> Result<(), String> {
    let specs: Vec<Vec<u8>> = (0..81)
        .map(|i| {
            let mut cspec = vec![((i / 9) * 10 + 11 + (i % 9)) as u8];
            cspec.extend_from_slice(spec);
            cspec
        })
        .collect();
    set_leds(lout, &specs)
}
fn led_palette(lout: &mut MidiOutputConnection) -> Result<(), String> {
    let data: Vec<Vec<u8>> = (0..64)
        .map(|i| [((8 - i / 8) * 10 + (i % 8) + 1) as u8, 0, i as u8].to_vec())
        .collect();
    set_leds(lout, &data)
}

fn send_text(
    lout: &mut MidiOutputConnection,
    text: &str,
    palette: Option<u8>,
    rgb: Option<[u8; 3]>,
    speed: u8,
    loop_text: bool,
) -> Result<(), String> {
    let mut text_data = Vec::new();
    for c in text.chars() {
        if c.is_ascii() {
            text_data.push(c as u8);
        } else {
            return Err("Invalid non-ascii character.".to_string());
        }
    }

    let mut data = vec![
        240,
        0,
        32,
        41,
        2,
        12,
        7,
        if loop_text { 1 } else { 0 },
        speed,
        if palette.is_some() { 0 } else { 1 },
    ];
    if let Some(palette) = palette {
        data.push(palette);
    } else if let Some(rgb) = rgb {
        data.extend_from_slice(&rgb);
    } else {
        return Err("No palette or RGB provided.".to_string());
    }
    data.extend(text_data);
    data.push(247);

    lout.send(&data).map_err(|e| e.to_string())?;
    Ok(())
}
fn stop_text(lout: &mut MidiOutputConnection) -> Result<(), midir::SendError> {
    lout.send([240, 0, 32, 41, 2, 12, 7, 247].as_slice())
}

fn reset(updaters: &mut Vec<Interval>) {
    for updater in updaters {
        updater.stop();
    }
}

// static LAYOUTS: [[[u8; 8]; 8]; 2] = [[[0; 8]; 8], [[1; 8]; 8]];

fn update(lout: &mut MidiOutputConnection, mode: u8, updaters: &mut [Interval]) {
    MODE.store(mode, Ordering::Relaxed);
    let _ = set_all_leds(lout, [0, 0].as_slice());
    match mode {
        0 => {}
        1 => {
            let _ = set_leds(
                lout,
                [vec![19, 0, 3], vec![18, 0, 45], vec![17, 0, 37]].as_slice(),
            );
        }
        2 => {
            if let Some(updater) = updaters.get_mut(0) {
                updater.start();
            }
        }
        _ => {}
    }
}

fn handle_input(lout: &mut MidiOutputConnection, note: u8, vel: u8, updaters: &mut Vec<Interval>) {
    // println!("{}, {}", note, vel);

    if vel > 0 {
        if note == 19 || note == 29 {
            reset(updaters);
        }

        if note == 19 {
            update(lout, 1, updaters)
        }
        if note == 29 {
            update(lout, 0, updaters)
        }

        match MODE.load(Ordering::Relaxed) {
            1 => match note {
                18 => update(lout, 2, updaters),
                17 => update(lout, 3, updaters),
                _ => {}
            },
            3 => update(lout, 4, updaters),
            _ => {}
        }
    }
}
