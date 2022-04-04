// ==UserScript==
// @name         PlaceDE Bot
// @namespace    https://github.com/PlaceDE/Bot
// @version      20
// @description  /r/place bot
// @author       NoahvdAa, reckter, SgtChrome, nama17, Kronox
// @match        https://www.reddit.com/r/place/*
// @match        https://new.reddit.com/r/place/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=reddit.com
// @require	     https://cdn.jsdelivr.net/npm/toastify-js
// @resource     TOASTIFY_CSS https://cdn.jsdelivr.net/npm/toastify-js/src/toastify.min.css
// @updateURL    https://github.com/PlaceDE/Bot/raw/main/placedebot.user.js
// @downloadURL  https://github.com/PlaceDE/Bot/raw/main/placedebot.user.js
// @grant        GM_getResourceText
// @grant        GM_addStyle
// ==/UserScript==

// Ignore that hideous code. But if it works, it works.

const VERBOSE = false;

const VERSION = 20;

const PLACE_URL = 'https://gql-realtime-2.reddit.com/query';
const UPDATE_URL = 'https://github.com/placeDE/Bot/raw/main/placedebot.user.js';

let accessToken;
let canvas = document.createElement('canvas');

let ccConnection;

let firstSuccess = true;

let timeout;
let locked = false;

(async function () {
	GM_addStyle(GM_getResourceText('TOASTIFY_CSS'));

	canvas.width = 2000;
	canvas.height = 2000;
	canvas = document.body.appendChild(canvas);

	await new Promise(r => setTimeout(r, 200));

	await initToken();
	initServerConnection();
})();

async function initToken() {
	// Create AccessToken
	Toaster.info('Frage Zugriffstokens an...');
	accessToken = await getAccessToken();
	Toaster.success('Zugriffstoken erhalten!')
}

async function initServerConnection() {
	// Establish connection to command&control server
	Toaster.info('Verbinde mit dem Kommando-Server...')

	ccConnection = new WebSocket('wss://placede.ml');
	ccConnection.onopen = function () {
		Toaster.success('Verbindung zum Server aufgebaut!');

		// handshake
		ccConnection.send(JSON.stringify({"operation":"handshake","data":{"platform":"browser","version":VERSION,"useraccounts":1}}));
		setReady()
	}
	ccConnection.onerror = function (error) {
		Toaster.error('Verbindung zum Server fehlgeschlagen!');
		Logger.log('WebSocket Error: '+ error.code);
	};
	ccConnection.onclose = function (close) {
		Toaster.error('Verbindung zum Server unterbrochen! Verbinde neu in 10 Sekunden...')
		Logger.log('WebSocket Close: '+ close.code);
		if (firstSuccess && close.code === 1006) {
			Toaster.error('Mögliches Problem mit deinem Adblocker etc.', 30000);
		}

		setTimeout(() => initServerConnection(), 10*1000);
	};
	ccConnection.onmessage  = processOperation;
}

function processOperation(message) {
	Logger.log(`RX: WebSocket Message: ${message.data}`, true);

	if (message.data === "{}") {
		Toaster.success('Es sind alle Pixel platziert! Gute Arbeit :]', 30000);
		Toaster.info('Versuche erneut in 30s...', 2000);
		locked = false;
		tryReady(30000);
		return;
	}

	const messageData = JSON.parse(message.data);
	switch (messageData.operation) {
		case 'place-pixel':
			void processOperationPlacePixel(messageData.data);
			return;
		case 'notify-update':
			void processOperationNotifyUpdate(messageData.data);
			return;
	}
}

async function processOperationPlacePixel(data) {

	const x = data.x;
	const y = data.y;
	const color = data.color;

	const time = new Date().getTime();
	let nextAvailablePixelTimestamp = await place(x, y, color) ?? new Date(time + 1000 * 60 * 5 + 1000 * 15)

	// Sanity check timestamp
	if (nextAvailablePixelTimestamp < time || nextAvailablePixelTimestamp > time + 1000 * 60 * 5 + 1000 * 15) {
		nextAvailablePixelTimestamp = time + 1000 * 60 * 5 + 1000 * 15;
	}

	// Add a few random seconds to the next available pixel timestamp
	const waitFor = nextAvailablePixelTimestamp - time + (Math.random() * 1000 * 15);

	const minutes = Math.floor(waitFor / (1000 * 60))
	const seconds = Math.floor((waitFor / 1000) % 60)
	Toaster.warning(`Noch ${minutes}m ${seconds}s Abklingzeit bis ${new Date(nextAvailablePixelTimestamp).toLocaleTimeString()} Uhr`, waitFor);
	firstSuccess = false;
	locked = false;
	tryReady(waitFor);
}

async function processOperationNotifyUpdate(data) {
	Toaster.error(`Neue Script-Version verfügbar! Aktulaisiere unter ${UPDATE_URL}`);
}

function tryReady(delay) {
	if (locked) return;
	clearTimeout(timeout);
	timeout = setTimeout(setReady, delay);
}

function setReady() {
	locked = true;
	ccConnection.send(JSON.stringify({"operation":"request-pixel","user":"browser-script"}));
	//setTimeout(checkBusy, 20000);
}

// Keep Alive
function checkBusy() {
	if (!locked) return;
	void setReady();
}

function getCanvasId(x,y) {
	return (x > 1000) + (y > 1000) * 2;
}
/**
 * Places a pixel on the canvas, returns the "nextAvailablePixelTimestamp", if succesfull
 * @param x
 * @param y
 * @param color
 * @returns {Promise<number>}
 */
async function place(x, y, color) {
	const response = await fetch(PLACE_URL, {
		method: 'POST',
		body: JSON.stringify({
			'operationName': 'setPixel',
			'variables': {
				'input': {
					'actionName': 'r/replace:set_pixel',
					'PixelMessageData': {
						'coordinate': {
							'x': x % 1000,
							'y': y % 1000
						},
						'colorIndex': color,
						'canvasIndex': getCanvasId(x,y)
					}
				}
			},
			'query': `mutation setPixel($input: ActInput!) {
				act(input: $input) {
					data {
						... on BasicMessage {
							id
							data {
								... on GetUserCooldownResponseMessageData {
									nextAvailablePixelTimestamp
									__typename
								}
								... on SetPixelResponseMessageData {
									timestamp
									__typename
								}
								__typename
							}
							__typename
						}
						__typename
					}
					__typename
				}
			}
			`
		}),
		headers: {
			'origin': 'https://hot-potato.reddit.com',
			'referer': 'https://hot-potato.reddit.com/',
			'apollographql-client-name': 'mona-lisa',
			'Authorization': `Bearer ${accessToken}`,
			'Content-Type': 'application/json'
		}
	});
	const data = await response.json()
	if (data.errors !== undefined) {
		Toaster.error('Pixel konnte nicht plaziert werden, da du noch Abklingzeit hast...', 4000)
		return data.errors[0].extensions?.nextAvailablePixelTs
	}
	Toaster.success(`Pixel gesetzt auf x:${x} y:${y}`)
	return data?.data?.act?.data?.[0]?.data?.nextAvailablePixelTimestamp
}

async function getAccessToken() {
	const usingOldReddit = window.location.href.includes('new.reddit.com');
	const url = usingOldReddit ? 'https://new.reddit.com/r/place/' : 'https://www.reddit.com/r/place/';
	const response = await fetch(url);
	const responseText = await response.text();

	return responseText.match(/"accessToken"\s*:\s*"([\w-]+)"/)[1];
}

class Toaster {

	static success(msg, duration = 10000) {
		Toastify({
			text: msg,
			duration: duration,
			gravity: "bottom",
			style: {
				background: '#92E234',
			},
		}).showToast();
		Logger.log(msg, true);
	}

	static warning(msg, duration = 10000) {
		Toastify({
			text: msg,
			duration: duration,
			gravity: "bottom",
			style: {
				background: '#FF5700',
			},
		}).showToast();
		Logger.log(msg, true);
	}

	static error(msg, duration = 10000) {
		Toastify({
			text: msg,
			duration: duration,
			gravity: "bottom",
			style: {
				background: '#ED001C',
			},
		}).showToast();
		Logger.log(msg);
	}

	static info(msg, duration = 10000) {
		Toastify({
			text: msg,
			duration: duration,
			gravity: "bottom",
			style: {
				background: '#C6C6C6',
				color: '#111'
			},
		}).showToast();
		Logger.log(msg, true);
	}
}

class Logger {

	static log(msg, verbose = false) {
		if (verbose && !VERBOSE) return;
		console.log(msg);
	}
}
