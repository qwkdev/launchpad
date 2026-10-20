use midir::{MidiOutput, MidiOutputConnection};
use std::error::Error;

fn main() -> Result<(), Box<dyn Error>> {
    let midi_out = MidiOutput::new("Launchpad Rust")?;
    let mut lp_port = None;
    for port in midi_out.ports() {
        let name = midi_out.port_name(&port)?;
        if name.contains("Launchpad X") && name.contains("MIDI") {
            lp_port = Some(port.clone());
            println!("{}", midi_out.port_name(&port)?);
        }
    }
    let port = lp_port.ok_or("Launchpad X output port not found")?;
    let mut lout = midi_out.connect(&port, "launchpad-output")?;

    let message: [u8; 13] = [240, 0, 32, 41, 2, 12, 3, 3, 99, 0, 0, 124, 247];
    lout.send(&message)?;

    set_leds(&mut lout, &[vec![71, 0, 5], vec![72, 0, 42]])?;
    set_all_leds(&mut lout, [0, 0].as_slice())?;

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
