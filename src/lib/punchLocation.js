export const LOCATION_STATUS_LABELS = {
  denied: 'Permissão de localização negada',
  unavailable: 'Localização indisponível',
  timeout: 'Tempo de localização esgotado',
  unsupported: 'Localização não suportada neste navegador',
  not_collected: 'Localização não coletada',
  adjusted: 'Horário corrigido pelo administrador',
};

export function hasCoordinates(location) {
  return location?.status === 'captured'
    && Number.isFinite(location.latitude) && Math.abs(location.latitude) <= 90
    && Number.isFinite(location.longitude) && Math.abs(location.longitude) <= 180
    && Number.isFinite(location.accuracy) && location.accuracy >= 0 && location.accuracy <= 100000000;
}

export function locationMapUrl(location) {
  if (!hasCoordinates(location)) return null;
  return `https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}`;
}

export function locationLabel(location, punched = true) {
  if (!punched) return 'Aguardando registro';
  if (!hasCoordinates(location)) return LOCATION_STATUS_LABELS[location?.status] || 'Localização não coletada';
  return `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)} (precisão aproximada: ${Math.ceil(location.accuracy)} m)`;
}

export const PUNCH_LOCATION_TIMEOUT_MS = 40000;

// The app saves the punch independently. Keep the best fix from this capture
// while the device has time to refine a coarse position.
export function capturePunchLocation({
  geolocation = globalThis.navigator?.geolocation,
  timeoutMs = PUNCH_LOCATION_TIMEOUT_MS,
  preferPrecise = globalThis.navigator?.onLine === false,
  onCandidate,
} = {}) {
  if (!geolocation) return Promise.resolve({ status: 'unsupported' });
  return new Promise((resolve) => {
    let settled = false;
    let preciseRequestStarted = false;
    let bestPosition;
    let watchId;
    let failureStatus = 'timeout';
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      clearTimeout(fallback);
      if (watchId != null) geolocation.clearWatch(watchId);
      resolve(value);
    };
    const deadline = setTimeout(() => finish(bestPosition || { status: failureStatus }), timeoutMs);
    const receive = ({ coords }, onInvalid) => {
      if (settled) return;
      const position = { status: 'captured', latitude: coords?.latitude, longitude: coords?.longitude, accuracy: coords?.accuracy };
      if (!hasCoordinates(position)) return onInvalid();
      if (bestPosition && bestPosition.accuracy <= position.accuracy) return;
      bestPosition = position;
      if (position.accuracy <= 100) finish(position);
      else {
        onCandidate?.(position);
        requestPrecisePosition();
      }
    };
    const requestPrecisePosition = () => {
      if (preciseRequestStarted || settled) return;
      preciseRequestStarted = true;
      clearTimeout(fallback);
      const watch = typeof geolocation.watchPosition === 'function' && typeof geolocation.clearWatch === 'function';
      const fail = (error) => {
        if (error?.code === 1) finish({ status: 'denied' });
        else {
          failureStatus = error?.code === 3 ? 'timeout' : 'unavailable';
          if (!watch) finish(bestPosition || { status: failureStatus });
        }
      };
      const options = { enableHighAccuracy: true, maximumAge: 0, timeout: timeoutMs };
      try {
        const success = (position) => {
          receive(position, fail);
          if (!watch && bestPosition) finish(bestPosition);
        };
        if (watch) {
          watchId = geolocation.watchPosition(success, fail, options);
          if (settled) geolocation.clearWatch(watchId);
        } else {
          geolocation.getCurrentPosition(success, fail, options);
        }
      } catch { finish(bestPosition || { status: 'unavailable' }); }
    };
    const fallback = setTimeout(requestPrecisePosition, 5000);
    const fail = (error) => {
      if (error?.code === 1) finish({ status: 'denied' });
      else requestPrecisePosition();
    };
    try {
      geolocation.getCurrentPosition(
        (position) => receive(position, fail),
        fail,
        { enableHighAccuracy: false, maximumAge: 30000, timeout: Math.min(5000, timeoutMs) },
      );
      if (preferPrecise) requestPrecisePosition();
    } catch { fail(); }
  });
}

export function locationExportColumns(includeLocation) {
  return includeLocation ? ['entrada', 'saida'].map((field) => ({
    key: `${field}_localizacao`,
    header: `Localização da ${field === 'entrada' ? 'entrada' : 'saída'}`,
    width: 62,
    value: (record) => locationLabel(record[`${field}_localizacao`], Boolean(record[field])),
  })) : [];
}
