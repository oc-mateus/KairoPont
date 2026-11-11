import test from 'node:test';
import assert from 'node:assert/strict';
import { capturePunchLocation, hasCoordinates, locationLabel, locationMapUrl, locationExportColumns } from './punchLocation.js';

const captured = { status: 'captured', latitude: -23.55052, longitude: -46.633308, accuracy: 12.2 };

test('each punch requests standard accuracy and accepts a position up to 30 seconds old', async () => {
  let calls = 0;
  const geolocation = { getCurrentPosition(success, failure, options) {
    calls++;
    assert.deepEqual(options, { maximumAge: 30000, enableHighAccuracy: false, timeout: 12000 });
    success({ coords: { ...captured, altitude: 900 } });
  } };
  assert.deepEqual(await capturePunchLocation({ geolocation }), captured);
  assert.deepEqual(await capturePunchLocation({ geolocation }), captured);
  assert.equal(calls, 2);
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
