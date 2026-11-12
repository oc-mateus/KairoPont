import { addIsoDays, getTodayInSP } from './utils.js';
import { getNearestRegisteredSchedule, inferShiftFromEntry } from './workShifts.js';

const CHANGE_EVENT = 'kairopont-punch-queue';
const PROFILE_KEY = 'kairopont-offline-punch-profile';
const syncs = new Set();
let database;
let channel;

export function punchAccountKey(profile) {
  return profile?.id && profile.auth_id ? `${profile.auth_id}:${profile.id}` : null;
}

export function readOfflinePunchProfile() {
  try {
    const profile = JSON.parse(localStorage.getItem(PROFILE_KEY));
    return profile?.ativo && punchAccountKey(profile) ? profile : null;
  } catch { return null; }
}

export function rememberOfflinePunchProfile(profile) {
  try {
    if (profile?.ativo && profile.role !== 'admin') {
      const { id, auth_id, nome, ativo, role, tipo_contrato, escala_trabalho } = profile;
      localStorage.setItem(PROFILE_KEY, JSON.stringify({ id, auth_id, nome, ativo, role, tipo_contrato, escala_trabalho }));
    } else {
      localStorage.removeItem(PROFILE_KEY);
    }
  } catch { /* Offline access is unavailable when the browser blocks storage. */ }
}

function openDatabase() {
  if (!database) {
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open('kairopont-punches', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('accounts', { keyPath: 'key' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch((error) => {
      database = null;
      throw error;
    });
  }
  return database;
}

function getChannel() {
  if (!channel && typeof window !== 'undefined' && typeof BroadcastChannel === 'function') {
    channel = new BroadcastChannel(CHANGE_EVENT);
    channel.onmessage = ({ data }) => window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: data }));
  }
  return channel;
}

export function subscribeToPunchQueue(key, callback) {
  getChannel();
  const listener = (event) => { if (event.detail === key) callback(); };
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}

async function accountState(key, update) {
  const db = await openDatabase();
  const state = await new Promise((resolve, reject) => {
    const tx = db.transaction('accounts', update ? 'readwrite' : 'readonly');
    const store = tx.objectStore('accounts');
    const read = store.get(key);
    let result;
    let error;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(error || tx.error);
    read.onsuccess = () => {
      const current = read.result || { key, records: [], events: [], revision: 0 };
      try {
        result = update ? update(current) : current;
        if (update) store.put(result);
      } catch (failure) {
        error = failure;
        tx.abort();
      }
    };
  });
  if (update) {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: key }));
    getChannel()?.postMessage(key);
  }
  return state;
}

export const readPunchState = (key) => accountState(key);

const clockFormat = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

export function projectPunchRecords(state, profile, today) {
  const firstDate = addIsoDays(today, -3);
  const records = new Map(state.records.filter((record) => record.data >= firstDate).map((record) => [record.id, record]));
  for (const event of state.events) {
    if (event.error) continue;
    const date = getTodayInSP(new Date(event.at));
    const clock = clockFormat.format(new Date(event.at));
    let record = records.get(event.recordId);
    if (!record && event.field === 'entrada' && date >= firstDate) {
      record = { id: event.recordId, data: date, entrada: clock };
      if (profile.tipo_contrato !== 'pj') {
        record.turno_trabalhado = getNearestRegisteredSchedule(profile.escala_trabalho, clock)?.item.id
          || inferShiftFromEntry(clock);
      }
    }
    if (!record) continue;
    const locationField = `${event.field}_localizacao`;
    records.set(record.id, {
      ...record,
      ...(!event.serverSaved && { [event.field]: clock }),
      ...(event.field === 'saida' && !event.serverSaved && { saida_data: date }),
      ...(event.location && { [locationField]: event.location }),
    });
  }
  return [...records.values()];
}

export function queuePunch(key, event, profile) {
  return accountState(key, (state) => {
    const today = getTodayInSP(new Date(event.at));
    const records = projectPunchRecords(state, profile, today);
    const duplicate = event.field === 'entrada'
      ? records.some((record) => record.data === today && record.entrada)
      : records.some((record) => record.id === event.recordId && record[event.field]);
    if (duplicate) throw new Error('Esta marcação já foi registrada neste aparelho.');
    const hasPendingPunch = state.events.some((item) => !item.serverSaved && !item.error);
    const events = [...state.events, { ...event, offline: event.offline || hasPendingPunch }];
    return { ...state, events };
  });
}

export function updateQueuedPunch(key, id, patch) {
  return accountState(key, (state) => ({
    ...state,
    events: state.events.map((event) => event.id === id ? { ...event, ...patch } : event),
  }));
}

export function retryQueuedPunches(key) {
  return accountState(key, (state) => ({
    ...state,
    events: state.events.map((event) => event.error ? { ...event, error: null } : event),
  }));
}

export function cachePunchRecords(key, records, revision) {
  return accountState(key, (state) => state.revision === revision ? { ...state, records } : state);
}

function confirmPunch(key, id, { registro, localizacao_finalizada }) {
  return accountState(key, (state) => {
    const event = state.events.find((item) => item.id === id);
    if (!event) return state;
    const firstDate = addIsoDays(getTodayInSP(), -3);
    const records = state.records.filter((record) => record.id !== event.recordId && record.data >= firstDate);
    if (registro?.data >= firstDate) records.push(registro);
    const events = localizacao_finalizada
      ? state.events.filter((item) => item.id !== id)
      : state.events.map((item) => item.id === id ? { ...item, serverSaved: true } : item);
    return { ...state, records, events, revision: state.revision + 1 };
  });
}

async function flushQueue(client, profile, key) {
  const state = await readPunchState(key);
  for (const original of state.events) {
    if (navigator.onLine === false) break;
    const event = (await readPunchState(key)).events.find((item) => item.id === original.id);
    if (!event || event.error) continue;
    const waitingForLocation = event.locationDeadline > Date.now() && !event.locationDone;
    if (event.serverSaved && waitingForLocation) continue;
    const location = event.locationDeadline && !waitingForLocation
      ? event.location || { status: 'not_collected' }
      : null;
    const useDeviceTime = event.offline || Date.now() - Date.parse(event.at) > 10000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let reply;
    try {
      reply = await client.rpc('sincronizar_marcacao_ponto', {
        p_funcionario_id: profile.id,
        p_marcacao_id: event.id,
        p_tipo: event.field,
        p_jornada_id: event.recordId,
        p_ocorrido_em: useDeviceTime ? event.at : null,
        p_localizacao: location,
      }).abortSignal(controller.signal);
    } catch { reply = {}; }
    finally { clearTimeout(timer); }

    if (reply.data) {
      await confirmPunch(key, event.id, reply.data);
    } else if (['P0001', '22023', '23505'].includes(reply.error?.code)) {
      await updateQueuedPunch(key, event.id, { error: reply.error.message, offline: true });
    } else {
      if (!event.offline) await updateQueuedPunch(key, event.id, { offline: true });
      break;
    }
  }
}

export async function syncPunchQueue(client, profile) {
  const key = punchAccountKey(profile);
  if (!key || !profile.ativo || navigator.onLine === false || syncs.has(key)) return;
  syncs.add(key);
  try {
    if (navigator.locks) {
      await navigator.locks.request(CHANGE_EVENT + key, { ifAvailable: true }, (lock) => lock && flushQueue(client, profile, key));
    } else {
      await flushQueue(client, profile, key);
    }
  } finally {
    syncs.delete(key);
  }
}
