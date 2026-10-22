const DEFAULTS = {
	off: 0,
	on: 3,
	_on: '#fff'
};

// Samples object, with urls and loaded objects

const midiCodes = {
	logo: 99,
	top: Array.from({ length: 8 }, (_, i) => 91+i),
	side: Array.from({ length: 8 }, (_, i) => 89-(i*10)),
	grid: Array.from({ length: 8 }, (_, i) => Array.from({ length: 8 }, (_, j) => 81-(10*i)+j))
};

function toPad(note) {
	if (note == 99) return { type: 'logo' }
	if (91 <= note && note <= 98) return { type: 'top', pos: note - 91 }
	if ((note - 9) % 10 == 0) return { type: 'side', pos: (89-note)/10 }
	return { type: 'grid', x: (note % 10) - 1, y: 8 - Math.floor(note/10) }
}

function setLEDs(lOut, spec) {
	if (spec.length == 1 && spec[0][1] !== 3) {
		lOut.send([144, spec[0][0], spec[0][2]]);
		return;
	}
	if (spec.length > 81) throw Error('Max 81 colourspecs at a time');

	let data = [];
	spec.forEach(info => {
		data.push(
			info[1],
			info[0],
			...(info[1] === 3 ? ([info[2], info[3], info[4]].map(n => Math.floor(parseFloat(n)/2))) : [info[2]])
		);
	})
	lOut.send([240, 0, 32, 41, 2, 12, 3, ...data, 247]);
}
function setAllLEDs(lOut, spec) {
	setLEDs(lOut, Array.from({ length: 81 }, (_, i) => [
		Math.floor(i / 9) * 10 + 11 + (i % 9), ...spec
	]));
}

function sendText(lOut, text, palatte=null, rgb=null, speed=12, loop=false) {
	let textData = [];
	Array.from(text).forEach(c => {
		const ascii = c.charCodeAt();
		if (ascii < 128) textData.push(ascii);
		else throw Error('Invalid non-ascii character.');
	});

	lOut.send([
		240, 0, 32, 41, 2, 12, 7,
		loop ? 1 : 0,
		speed,
		palatte !== null ? 0 : 1,
		...(palatte !== null ? [palatte] : [rgb[0], rgb[1], rgb[2]]),
		...textData,
		247
	])
}
function stopText(lOut) {
	lOut.send([240, 0, 32, 41, 2, 12, 7, 247]);
}

let launchpadInput;
let launchpadOutput;
async function init(load=_ => {}, input=_ => {}) {
	try {
		midiAccess = await navigator.requestMIDIAccess({ sysex: true });
		for (let entry of midiAccess.inputs.values()) {
			if (entry.name.includes("Launchpad")) {
				launchpadInput = entry;
			}
		}
		for (let entry of midiAccess.outputs.values()) {
			if (entry.name.includes("Launchpad")) {
				launchpadOutput = entry;
			}
		}
		if (!launchpadInput || !launchpadOutput) {
			alert('Launchpad not found!')
			console.error('Launchpad not found!');
			return;
		}

		launchpadInput.onmidimessage = msg => {
			const [status, note, velocity] = msg.data;
			input(note, velocity);
		};

		load(launchpadInput, launchpadOutput);

	} catch (err) {
		console.error("Failed to get MIDI access:", err);
	}
}

/////

// function hueToRGB(h) {
// 	const f = n => {
// 		const k = (n + h / 30) % 12;
// 		return Math.round(127 * Math.max(0, Math.min(k, 4 - k, 1)));
// 	};
// 	return [f(0), f(8), f(4)];
// }

function hueToRGB(hue) {
	let x = (1 - Math.abs((hue / 60) % 2 - 1)) * 127;
	let r = 0, g = 0, b = 0;
		 if (hue >= 0   && hue < 60)  [r, g, b] = [127, x, 0];
	else if (hue >= 60  && hue < 120) [r, g, b] = [x, 127, 0];
	else if (hue >= 120 && hue < 180) [r, g, b] = [0, 127, x];
	else if (hue >= 180 && hue < 240) [r, g, b] = [0, x, 127];
	else if (hue >= 240 && hue < 300) [r, g, b] = [x, 0, 127];
	else if (hue >= 300 && hue < 360) [r, g, b] = [127, 0, x];
	return [r, g, b].map(Math.floor);
}

let iconHue = 0;
function loopHue() {
	iconHue += 2;
	iconHue = iconHue % 360;
	setLEDs(launchpadOutput, [[99, 3, ...hueToRGB(iconHue)]]);
}

/////

const padEle = document.getElementById('controller').querySelectorAll('.pad');
// const pads = Object.fromEntries(Array.from({ length: 64 }, (_, j) => [(8 - (j>>3)) * 10 + (j & 7) + 1, null]));

const pads = Object.fromEntries(Array.from(padEle).map(e => [parseInt(e.id.slice(3)), null]));

const samples = {};
async function start() {
	document.getElementById('load').hidden = true;
	samples.amen = await loadAudio('amen.mp3');

	pads[71] = ['', 1.771, 2.019, [true, 5, '#ff6161']];
	pads[72] = ['', 4.312, 4.425, [true, 42, '#61a1dd']];
	pads[73] = ['', 6.347, 6.613, [true, 13, '#ffff61']];
	pads[81] = ['', 0.041, 0.484, [true, 49, '#a161ff']];
	pads[82] = ['', 2.250, 2.450, [true, 25, '#61ff8c']];
	pads[83] = ['', 2.450, 2.893, [true, 53, '#ff61ff']];

	updatePads();

	init(_ => {
		updatePads();
		setInterval(loopHue, 100);
	}, handleInput);
}

function updatePads() {
	let specs = [];
	for (const [p, v] of Object.entries(pads)) {
		if (v) {
			const pad = document.getElementById(`pad${p}`);
			pad.style.setProperty('--clr', v[3][2]);

			if (launchpadOutput) {
				specs.push([p, v[3][0] ? 0 : 3, ...(v[3][0] ? [v[3][1]] : v[3][1])]);
			}
		} else if (launchpadOutput) {
			specs.push([p, 0, DEFAULTS.off]);
		}
	}
	if (specs.length !== 0) {
		setLEDs(launchpadOutput, specs);
	}
}

const padColour = document.getElementById('pad-clr');
const chosenColour = document.getElementById('chosen');
function setPresetColour(e) {
	padColour.dataset.id = e.dataset.value;
	padColour.dataset.rgb = '';
	chosenColour.style.setProperty('--clr', window.getComputedStyle(e).getPropertyValue('--clr'));
}
function setRGBColour() {
	const rgb = [...'rgb'].map(i => document.getElementById(`clr-${i}`).value);

	padColour.dataset.id = '';
	padColour.dataset.rgb = `${rgb[0]},${rgb[1]},${rgb[2]}`;
	chosenColour.style.setProperty('--clr', `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`);
}
document.getElementById('presets').querySelectorAll('.colour').forEach(e => {
	e.onclick = () => setPresetColour(e);
});

const editPadModal = document.getElementById('edit-pad-modal');
editPadModal.addEventListener('click', e => {
	if (e.target == editPadModal) editPadModal.close();
});
function editPad(padId) {
	const pad = pads[padId] ?? null;
	const parent = document.getElementById('waveform');
	parent.innerHTML = '';
	const regions = WaveSurfer.Regions.create();
	const ws = WaveSurfer.create({
		container: parent,
		waveColor: '#aaa',
		progressColor: '#fff',
		normalize: true,
		url: '/amen.mp3',
		plugins: [regions],
	});
	const zoomSlider = document.getElementById('zoom-slider');
	zoomSlider.value = 0;

	ws.on('decode', () => {
		const clip = pad === null ? [0, ws.getDuration()] : [pad[1], pad[2]];
		regions.addRegion({
			start: clip[0],
			end: clip[1],
			content: 'Selection',
			color: '#60f5',
		});
		zoomSlider.addEventListener('input', e => {
			ws.zoom(zoomSlider.valueAsNumber);
			zoomSlider.style.setProperty('--fill', `${zoomSlider.valueAsNumber / parseFloat(zoomSlider.max) * 100}%`)
		});

		parent.dataset.start = clip[0];
		parent.dataset.end = clip[1];
	});

	regions.on('region-clicked', (r, e) => {
		e.stopPropagation();
		ws.play(r.start, r.end);
	});
	regions.on('region-updated', r => {
		parent.dataset.start = r.start;
		parent.dataset.end = r.end;
	});

	//! zoomSlider.value = ws.
	zoomSlider.style.setProperty('--fill', `${zoomSlider.valueAsNumber / parseFloat(zoomSlider.max) * 100}%`)
	
	padColour.dataset.id = '';
	padColour.dataset.rgb = '';
	chosenColour.style.cssText = '';
	if (pad) {
		padColour.dataset.id = pad[3][0] ? pad[3][1] : pad[3][1].join(',');

		if (pad[3][0]) padColour.dataset.id = pad[3][1];
		else padColour.dataset.rgb = pad[3][1].join(',');
		chosenColour.style.setProperty('--clr', pad[3][2]);
	}

	editPadModal.querySelector('.modal').dataset.id = padId;
	editPadModal.showModal();
}
function savePad() {
	const padId = parseInt(editPadModal.querySelector('.modal').dataset.id);
	let presetColour = !Number.isNaN(parseInt(padColour.dataset.id));
	let clr;

	if (!padColour.dataset.id && !padColour.dataset.rgb) {
		presetColour = true;
		clr = 0;
	} else if (presetColour) {
		clr = parseInt(padColour.dataset.id);
	} else {
		clr = padColour.dataset.rgb.split(',').map(e => parseInt(e));
	}

	const waveform = document.getElementById('waveform');
	pads[padId] = [
		'/amen.mp3', waveform.dataset.start, waveform.dataset.end,
		[presetColour, clr, window.getComputedStyle(chosenColour).getPropertyValue('--clr')]
	];
	editPadModal.close();

	updatePads();
}

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

async function loadAudio(url) {
	const resp = await fetch(url);
	const buffer = await resp.arrayBuffer();
	return await audioCtx.decodeAudioData(buffer);
}
function playSnippet(buffer, offset = 0, duration = undefined) {
	const src = audioCtx.createBufferSource();
	src.buffer = buffer;
	src.connect(audioCtx.destination);
	src.start(0, offset, duration);
}
function playPad(padId) {
	if (!pads[padId]) return;
	playSnippet(samples.amen, pads[padId][1], pads[padId][2]-pads[padId][1]);
}

const inputStream = new Set();
function handleInput(note, vel) {
	const v = pads[note];
	if (vel === 0) {
		inputStream.delete(note);
		setLEDs(launchpadOutput, v ? [[note, v[3][0] ? 0 : 3, ...(v[3][0] ? [v[3][1]] : v[3][1])]] : [[note, 0, DEFAULTS.off]]);
		document.getElementById(`pad${note}`).style.setProperty('--clr', v ? v[3][2] : '');
	} else if (!inputStream.has(note)) {
		inputStream.add(note);
		playPad(note);
		setLEDs(launchpadOutput, v ? [[note, v[4][0] ? 0 : 3, ...(v[4][0] ? [v[4][1]] : v[4][1])]] : [[note, 0, DEFAULTS.on]]);
		document.getElementById(`pad${note}`).style.setProperty('--clr', v ? v[4][2] : DEFAULTS._on);
	}
}

padEle.forEach(e => {
	e.onclick = () => playPad(e.id.slice(3));
	e.ondblclick = () => editPad(e.id.slice(3));
});

// document.getElementById('load').hidden = true;
