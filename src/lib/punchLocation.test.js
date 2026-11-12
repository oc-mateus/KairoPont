import test from 'node:test';
import assert from 'node:assert/strict';
import { capturePunchLocation, hasCoordinates, locationLabel, locationMapUrl, locationExportColumns } from './punchLocation.js';

const captured = { status: 'captured', latitude: -23.55052, longitude: -46.633308, accuracy: 12.2 };

test('each punch requests standard accuracy and accepts a position up to 30 seconds old', async () => {
  let calls = 0;
  const geolocation = { getCurrentPosition(success, failure, options) {
    calls++;
    assert.deepEqual(options, { maximumAge: 30000, enableHighAccuracy: false, timeout: 5000 });
    success({ coords: { ...captured, altitude: 900 } });
  } };
  assert.deepEqual(await capturePunchLocation({ geolocation }), captured);
  assert.deepEqual(await capturePunchLocation({ geolocation }), captured);
  assert.equal(calls, 2);
});

test('a mobile browser can capture with high accuracy after standard accuracy fails', async () => {
  for (const code of [2, 3]) {
    const attempts = [];
    const geolocation = { getCurrentPosition(ok, fail, options) {
      attempts.push(options.enableHighAccuracy);
      if (options.enableHighAccuracy) ok({ coords: captured });
      else fail({ code });
    } };
    assert.deepEqual(await capturePunchLocation({ geolocation }), captured);
    assert.deepEqual(attempts, [false, true]);
  }
});

test('a denied permission does not trigger another location request', async () => {
  let attempts = 0;
  const geolocation = { getCurrentPosition(ok, fail) {
    attempts++;
    fail({ code: 1 });
  } };
  assert.deepEqual(await capturePunchLocation({ geolocation }), { status: 'denied' });
  assert.equal(attempts, 1);
});

test('the precise fallback also runs if the browser never answers the standard request', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const attempts = [];
  const geolocation = { getCurrentPosition(ok, fail, options) {
    attempts.push(options.enableHighAccuracy);
    if (options.enableHighAccuracy) ok({ coords: captured });
  } };
  const pending = capturePunchLocation({ geolocation });
  t.mock.timers.tick(5000);
  assert.deepEqual(await pending, captured);
  assert.deepEqual(attempts, [false, true]);
});

test('a GPS watch can improve a coarse fix and stops after an accurate result', async () => {
  const coarse = { ...captured, accuracy: 800 };
  const candidates = [];
  const cleared = [];
  let receive;
  const geolocation = {
    getCurrentPosition(ok) { ok({ coords: coarse }); },
    watchPosition(ok, fail, options) {
      assert.equal(options.enableHighAccuracy, true);
      assert.equal(options.maximumAge, 0);
      receive = ok;
      fail({ code: 2 }); // A temporary failure can be followed by a GPS fix.
      return 12;
    },
    clearWatch(id) { cleared.push(id); },
  };
  const pending = capturePunchLocation({ geolocation, preferPrecise: true, onCandidate: (position) => candidates.push(position) });
  receive({ coords: { ...coarse, accuracy: 1500 } });
  receive({ coords: captured });
  assert.deepEqual(await pending, captured);
  assert.deepEqual(candidates, [coarse]);
  assert.deepEqual(cleared, [12]);
});

test('an approximate fix survives a GPS timeout', async () => {
  const coarse = { ...captured, accuracy: 600 };
  const geolocation = {
    getCurrentPosition(ok) { ok({ coords: coarse }); },
    watchPosition() { return 1; },
    clearWatch() {},
  };
  assert.deepEqual(await capturePunchLocation({ geolocation, timeoutMs: 5 }), coarse);
});

test('a position received after the overall deadline is ignored', async () => {
  let receivePosition;
  const geolocation = { getCurrentPosition(ok) { receivePosition = ok; } };
  const result = await capturePunchLocation({ geolocation, timeoutMs: 5 });
  receivePosition({ coords: captured });
  assert.deepEqual(result, { status: 'timeout' });
});

test('capture failures and unanswered prompts resolve without blocking the punch', async () => {
  for (const [code, status] of [[1, 'denied'], [2, 'unavailable'], [3, 'timeout']]) {
    assert.deepEqual(await capturePunchLocation({ geolocation: { getCurrentPosition(ok, fail) { fail({ code }); } } }), { status });
  }
  assert.deepEqual(await capturePunchLocation({ geolocation: null }), { status: 'unsupported' });
  assert.deepEqual(await capturePunchLocation({ geolocation: { getCurrentPosition() { throw new Error('device failure'); } } }), { status: 'unavailable' });
  assert.deepEqual(await capturePunchLocation({ geolocation: { getCurrentPosition() {} }, timeoutMs: 5 }), { status: 'timeout' });
  assert.deepEqual(await capturePunchLocation({ geolocation: { getCurrentPosition(ok) { ok({ coords: { ...captured, latitude: NaN } }); } } }), { status: 'unavailable' });
});

test('only valid coordinate data produces map links and export labels', () => {
  assert.equal(locationMapUrl(captured), 'https://www.google.com/maps/search/?api=1&query=-23.55052,-46.633308');
  assert.match(locationLabel(captured), /-23.550520, -46.633308.*13 m/);
  for (const location of [null, { ...captured, latitude: 91 }, { ...captured, longitude: Infinity }, { ...captured, accuracy: -1 }, { ...captured, status: 'denied' }]) {
    assert.equal(hasCoordinates(location), false);
    assert.equal(locationMapUrl(location), null);
  }
  assert.match(locationLabel(null), /não coletada/);
  assert.equal(locationLabel(null, false), 'Aguardando registro');
  assert.equal(locationLabel({ status: 'adjusted' }), 'Horário corrigido pelo administrador');
});

test('report location columns are opt-in and include entry and exit independently', () => {
  assert.deepEqual(locationExportColumns(false), []);
  const columns = locationExportColumns(true);
  assert.equal(columns.length, 2);
  const record = { entrada: '08:00:00', saida: '17:00:00', entrada_localizacao: captured, saida_localizacao: { status: 'denied' } };
  assert.match(columns[0].value(record), /-23.550520/);
  assert.equal(columns[1].value(record), 'Permissão de localização negada');
});
