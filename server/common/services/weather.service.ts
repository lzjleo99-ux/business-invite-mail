import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

export interface WeatherInfo {
  temperature: number;
  apparentTemperature: number;
  relativeHumidity: number;
  weatherCode: number;
  windSpeed: number;
  description: string;
  category: 'clear' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'showers' | 'thunderstorm' | 'unknown';
  city: string | null;
}

const WEATHER_CODE_MAP: Record<number, { description: string; category: WeatherInfo['category'] }> = {
  0: { description: '晴', category: 'clear' },
  1: { description: '大部晴朗', category: 'clear' },
  2: { description: '多云', category: 'cloudy' },
  3: { description: '阴', category: 'cloudy' },
  45: { description: '雾', category: 'fog' },
  48: { description: '冻雾', category: 'fog' },
  51: { description: '小毛毛雨', category: 'drizzle' },
  53: { description: '毛毛雨', category: 'drizzle' },
  55: { description: '大毛毛雨', category: 'drizzle' },
  56: { description: '冻毛毛雨', category: 'drizzle' },
  57: { description: '强冻毛毛雨', category: 'drizzle' },
  61: { description: '小雨', category: 'rain' },
  63: { description: '中雨', category: 'rain' },
  65: { description: '大雨', category: 'rain' },
  66: { description: '冻雨', category: 'rain' },
  67: { description: '强冻雨', category: 'rain' },
  71: { description: '小雪', category: 'snow' },
  73: { description: '中雪', category: 'snow' },
  75: { description: '大雪', category: 'snow' },
  77: { description: '雪粒', category: 'snow' },
  80: { description: '阵雨', category: 'showers' },
  81: { description: '强阵雨', category: 'showers' },
  82: { description: '暴雨', category: 'showers' },
  85: { description: '阵雪', category: 'snow' },
  86: { description: '强阵雪', category: 'snow' },
  95: { description: '雷暴', category: 'thunderstorm' },
  96: { description: '雷暴伴小冰雹', category: 'thunderstorm' },
  99: { description: '雷暴伴大冰雹', category: 'thunderstorm' },
};

@Injectable()
export class WeatherService {
  private readonly logger = new Logger(WeatherService.name);
  private readonly timeout = 8000;

  async getWeather(
    lat: number,
    lon: number,
    cityHint?: string,
  ): Promise<WeatherInfo | null> {
    try {
      const url = 'https://api.open-meteo.com/v1/forecast';
      const response = await axios.get(url, {
        params: {
          latitude: lat,
          longitude: lon,
          current:
            'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m',
          timezone: 'auto',
        },
        timeout: this.timeout,
      });

      const current = response.data?.current;
      if (!current) {
        this.logger.warn('Open-Meteo returned empty current data');
        return null;
      }

      const weatherCode: number = current.weather_code ?? 0;
      const mapped = WEATHER_CODE_MAP[weatherCode] ?? {
        description: '未知天气',
        category: 'unknown' as const,
      };

      let city: string | null = cityHint ?? null;
      if (!city) {
        city = await this.reverseGeocode(lat, lon);
      }

      return {
        temperature: Number(current.temperature_2m ?? 0),
        apparentTemperature: Number(current.apparent_temperature ?? 0),
        relativeHumidity: Number(current.relative_humidity_2m ?? 0),
        weatherCode,
        windSpeed: Number(current.wind_speed_10m ?? 0),
        description: mapped.description,
        category: mapped.category,
        city,
      };
    } catch (err: unknown) {
      if (err instanceof Error) {
        this.logger.warn(`Weather API request failed: ${err.message}`);
      } else {
        this.logger.warn('Weather API request failed with unknown error');
      }
      return null;
    }
  }

  async reverseGeocode(lat: number, lon: number): Promise<string | null> {
    try {
      const response = await axios.get(
        'https://api.bigdatacloud.net/data/reverse-geocode-client',
        {
          params: {
            latitude: lat,
            longitude: lon,
            localityLanguage: 'en',
          },
          timeout: this.timeout,
        },
      );
      const data = response.data;
      const city =
        data.city ||
        data.locality ||
        data.administeredLocality ||
        data.principalSubdivision ||
        data.countryName ||
        null;
      return city;
    } catch (err: unknown) {
      this.logger.warn(
        `Reverse geocoding failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  extractCityFromAddress(address: string): string | null {
    if (!address) return null;
    const parts = address.split(',').map((p: string) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return parts[parts.length - 2];
    }
    if (parts.length === 1) {
      return parts[0];
    }
    return null;
  }
}
