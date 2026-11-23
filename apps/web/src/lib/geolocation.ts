/** Browser geolocation wrapper with user friendly error messages (F10 AC3). */
import type { Fix } from '@lockation/core';

export class GeoError extends Error {
  constructor(
    public code: 'denied' | 'unavailable' | 'timeout' | 'unsupported' | 'blocked_in_frame',
    message: string,
    public help: string[],
  ) {
    super(message);
  }
}

const iosHelp = 'iPhone: Settings → Privacy & Security → Location Services → enable it for Safari / the Chaster app ("While Using").';
const androidHelp = 'Android: Settings → Location → turn on, and allow location for your browser / the Chaster app.';

export function mapGeoError(err: { code: number; message?: string }, embedded: boolean): GeoError {
  switch (err.code) {
    case 1: {
      const help = [iosHelp, androidHelp, 'Reload the page and choose "Allow" when asked for your location.'];
      if (embedded) help.push('If the prompt never appears inside Chaster, use "Open in new tab" below.');
      return new GeoError(embedded && /policy|permission/i.test(err.message ?? '') ? 'blocked_in_frame' : 'denied', 'Location permission was denied.', help);
    }
    case 2:
      return new GeoError('unavailable', 'Your position could not be determined.', ['Turn on GPS / location services.', 'Go outside or near a window and try again.']);
    case 3:
      return new GeoError('timeout', 'Getting your position took too long.', ['Try again – the first fix can take up to a minute outdoors.', 'Turn on "precise location" for this app.']);
    default:
      return new GeoError('unavailable', err.message || 'Unknown location error.', []);
  }
}

export function getFix(opts: { timeoutMs?: number; embedded?: boolean } = {}): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new GeoError('unsupported', 'This browser does not support location.', ['Use an up-to-date Safari, Chrome or Firefox.']));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: Math.round(pos.timestamp),
        }),
      (err) => reject(mapGeoError(err, opts.embedded ?? false)),
      { enableHighAccuracy: true, maximumAge: 0, timeout: opts.timeoutMs ?? 20_000 },
    );
  });
}
