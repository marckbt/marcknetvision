// Shared helpers for the Open-Meteo forecast API (https://open-meteo.com),
// used by weather-scraper.js and world-weather-scraper.js.

// WMO weather codes (used by Open-Meteo) → condition text.
const WMO_CONDITIONS = {
  0: 'Sunny', 1: 'Mostly Sunny', 2: 'Partly Cloudy', 3: 'Cloudy',
  45: 'Fog', 48: 'Freezing Fog',
  51: 'Light Drizzle', 53: 'Drizzle', 55: 'Heavy Drizzle',
  56: 'Freezing Drizzle', 57: 'Freezing Drizzle',
  61: 'Light Rain', 63: 'Rain', 65: 'Heavy Rain',
  66: 'Freezing Rain', 67: 'Freezing Rain',
  71: 'Light Snow', 73: 'Snow', 75: 'Heavy Snow', 77: 'Snow Grains',
  80: 'Rain Showers', 81: 'Rain Showers', 82: 'Heavy Rain Showers',
  85: 'Snow Showers', 86: 'Heavy Snow Showers',
  95: 'Thunderstorms', 96: 'Thunderstorms with Hail', 99: 'Thunderstorms with Hail',
};

function wmoCondition(code) {
  return WMO_CONDITIONS[code] || 'Unknown';
}

module.exports = { wmoCondition };
