const EARTH_RADIUS_M = 6371000;

export function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function pointInPolygon(point, polygon) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function gridKey(lat, lon, meters = 25) {
  const latDeg = meters / 111320;
  const lonDeg = meters / (111320 * Math.cos((lat * Math.PI) / 180));
  return `${Math.floor(lat / latDeg)}:${Math.floor(lon / lonDeg)}`;
}

export function buildHeatmapGrid(bounds, cellSizeDeg = 0.0025) {
  const [minLon, minLat, maxLon, maxLat] = bounds;
  const cells = [];
  for (let lon = minLon; lon < maxLon; lon += cellSizeDeg) {
    for (let lat = minLat; lat < maxLat; lat += cellSizeDeg) {
      cells.push({ lon, lat, count: 0, totalDistance: 0 });
    }
  }
  return cells;
}
