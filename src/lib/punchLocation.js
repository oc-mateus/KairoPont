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
    && Number.isFinite(location.accuracy) && location.accuracy >= 0;
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

// One fresh reading per punch. The independent deadline also covers a browser
// permission prompt that remains unanswered, which the API timeout may exclude.
export function capturePunchLocation({ geolocation = globalThis.navigator?.geolocation, timeoutMs = 10000 } = {}) {
  if (!geolocation) return Promise.resolve({ status: 'unsupported' });
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve(value);
    };
    const deadline = setTimeout(() => finish({ status: 'timeout' }), timeoutMs);
    try {
      geolocation.getCurrentPosition(
        ({ coords }) => {
          const value = { status: 'captured', latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy };
          finish(hasCoordinates(value) ? value : { status: 'unavailable' });
        },
        (error) => finish({ status: ({ 1: 'denied', 3: 'timeout' })[error?.code] || 'unavailable' }),
        { enableHighAccuracy: true, maximumAge: 0, timeout: timeoutMs },
      );
    } catch { finish({ status: 'unavailable' }); }
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
