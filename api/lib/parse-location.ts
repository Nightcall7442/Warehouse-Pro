/**
 * Parse GPS coordinates from various location URL formats.
 * Supports: Google Maps, Yandex Maps, Telegram share links, direct coordinates.
 */
export function parseLocationFromUrl(url: string): { lat: number; lng: number } | null {
  if (!url || typeof url !== "string") return null;

  const trimmed = url.trim();

  // 1. Direct coordinates: "41.3603, 69.2853" or "41.3603,69.2853"
  const directMatch = trimmed.match(/^(-?\d+\.?\d*)\s*[,;]\s*(-?\d+\.?\d*)$/);
  if (directMatch) {
    const lat = parseFloat(directMatch[1]);
    const lng = parseFloat(directMatch[2]);
    if (isValidCoord(lat, lng)) return { lat, lng };
  }

  try {
    const parsed = new URL(trimmed);

    // 2. Google Maps: ?q=lat,lng  or  ?query=lat,lng
    for (const param of ["q", "query"]) {
      const val = parsed.searchParams.get(param);
      if (val) {
        const coords = parseLatLng(val);
        if (coords) return coords;
      }
    }

    // 3. Yandex Maps: ?pt=lng,lat (note: Yandex uses lng,lat order)
    const pt = parsed.searchParams.get("pt");
    if (pt) {
      const parts = pt.split(",").map(Number);
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        // Yandex: pt=lng,lat
        const lng = parts[0];
        const lat = parts[1];
        if (isValidCoord(lat, lng)) return { lat, lng };
      }
    }

    // 4. Telegram share: ?url=<encoded maps link>
    const innerUrl = parsed.searchParams.get("url");
    if (innerUrl) {
      const inner = parseLocationFromUrl(decodeURIComponent(innerUrl));
      if (inner) return inner;
    }

    // 5. Google Maps short links: /maps/place/.../@lat,lng,...
    const atMatch = trimmed.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
    if (atMatch) {
      const lat = parseFloat(atMatch[1]);
      const lng = parseFloat(atMatch[2]);
      if (isValidCoord(lat, lng)) return { lat, lng };
    }

    // 6. Google Maps dir links: /dir/.../lat,lng
    const dirMatch = trimmed.match(/\/dir\/.*?\/(-?\d+\.?\d*),(-?\d+\.?\d*)/);
    if (dirMatch) {
      const lat = parseFloat(dirMatch[1]);
      const lng = parseFloat(dirMatch[2]);
      if (isValidCoord(lat, lng)) return { lat, lng };
    }

  } catch {
    // Invalid URL — try regex fallback on raw string
  }

  // 7. Regex fallback: find lat,lng pattern anywhere in the string
  const fallback = trimmed.match(/(-?\d+\.\d{4,})\s*[,;]\s*(-?\d+\.\d{4,})/);
  if (fallback) {
    const lat = parseFloat(fallback[1]);
    const lng = parseFloat(fallback[2]);
    if (isValidCoord(lat, lng)) return { lat, lng };
  }

  return null;
}

function parseLatLng(val: string): { lat: number; lng: number } | null {
  const parts = val.split(",").map(s => s.trim());
  if (parts.length >= 2) {
    const lat = parseFloat(parts[0]);
    const lng = parseFloat(parts[1]);
    if (isValidCoord(lat, lng)) return { lat, lng };
  }
  return null;
}

function isValidCoord(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}
