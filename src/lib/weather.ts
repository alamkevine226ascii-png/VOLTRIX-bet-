// ============================================================
// VOLTRIX bet — Météo via Open-Meteo (gratuit, sans clé API)
// Ville du stade -> coordonnées -> prévisions du jour
// ============================================================

import { cached } from './cache';

export interface WeatherInfo {
  description: string;
  tempC: number;
  windKmh: number;
  precipitationMm: number;
  impact: string; // note d'impact sur le jeu
  goalsFactor: number; // multiplicateur sur les buts attendus
}

interface GeoResponse {
  results?: Array<{ name: string; latitude: number; longitude: number; country?: string }>;
}

interface ForecastResponse {
  current?: {
    temperature_2m?: number;
    wind_speed_10m?: number;
    precipitation?: number;
    weather_code?: number;
  };
}

const WEATHER_CODES: Record<number, string> = {
  0: 'Ciel dégagé',
  1: 'Plutôt dégagé',
  2: 'Partiellement nuageux',
  3: 'Couvert',
  45: 'Brouillard',
  48: 'Brouillard givrant',
  51: 'Bruine légère',
  53: 'Bruine',
  55: 'Bruine dense',
  61: 'Pluie légère',
  63: 'Pluie',
  65: 'Forte pluie',
  71: 'Neige légère',
  73: 'Neige',
  75: 'Fortes chutes de neige',
  80: 'Averses légères',
  81: 'Averses',
  82: 'Fortes averses',
  95: 'Orage',
  96: 'Orage avec grêle',
  99: 'Orage violent avec grêle',
};

export async function fetchWeather(city: string | null, country: string | null): Promise<WeatherInfo | null> {
  if (!city) return null;
  const key = `wx:${city}:${country ?? ''}`;
  return cached(key, 6 * 60 * 60 * 1000, async () => {
    try {
      // 1. Géocodage
      const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=fr&format=json`;
      const geo = (await fetchJson<GeoResponse>(geoUrl)) ?? {};
      const loc = geo.results?.[0];
      if (!loc) return null;

      // 2. Prévisions actuelles
      const fcUrl = `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,wind_speed_10m,precipitation,weather_code`;
      const fc = (await fetchJson<ForecastResponse>(fcUrl)) ?? {};
      const cur = fc.current;
      if (!cur) return null;

      const tempC = cur.temperature_2m ?? 15;
      const windKmh = cur.wind_speed_10m ?? 0;
      const precipMm = cur.precipitation ?? 0;
      const code = cur.weather_code ?? 0;
      const description = WEATHER_CODES[code] ?? 'Conditions normales';

      // Impact sur le jeu : pluie forte / neige -> moins de buts, jeu plus haché
      let goalsFactor = 1;
      const notes: string[] = [];
      if (precipMm >= 2.5 || [71, 73, 75].includes(code)) {
        goalsFactor = 0.95;
        notes.push('les conditions rendent le jeu plus fermé');
      } else if (precipMm > 0.2) {
        goalsFactor = 0.98;
        notes.push('pelouse légèrement dégradée possible');
      }
      if (tempC >= 32) {
        goalsFactor *= 0.97;
        notes.push('chaleur intense, rythme de jeu en baisse');
      }
      if (windKmh >= 40) {
        goalsFactor *= 0.97;
        notes.push('vent fort, précision technique réduite');
      }

      return {
        description,
        tempC: Math.round(tempC),
        windKmh: Math.round(windKmh),
        precipitationMm: Math.round(precipMm * 10) / 10,
        impact: notes.length
          ? `Impact possible : ${notes.join(', ')}`
          : 'Aucun impact notable sur le jeu',
        goalsFactor,
      } as WeatherInfo;
    } catch {
      return null;
    }
  });
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
