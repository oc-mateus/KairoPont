import { hasCoordinates, locationLabel, locationMapUrl } from '../lib/punchLocation';

export default function PunchLocation({ location, punched, label }) {
  if (!punched) return null;
  const captured = hasCoordinates(location);
  return (
    <div className="punch-location">
      {captured ? <>
        <a href={locationMapUrl(location)} target="_blank" rel="noopener noreferrer" aria-label={`Ver localização da ${label} no mapa (abre em nova aba)`}>Ver no mapa</a>
        <span>{location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}</span>
        <span>Precisão aproximada: {Math.ceil(location.accuracy)} m</span>
      </> : <span>{locationLabel(location)}</span>}
    </div>
  );
}
