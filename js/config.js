// What counts as a good day for a drive.
//   - no rain at all
//   - daytime high inside the comfortable band
export const RULE = {
  tempMin: 65,   // °F
  tempMax: 80,   // °F
  rainMax: 0.01, // inches; a forecast of 0.00 still shows trace amounts sometimes
};

export const FORECAST_DAYS = 7;

// Every basemap here is keyless and free to use with attribution, which is what
// lets the whole site live on GitHub Pages with no secrets and no backend.
export const BASEMAPS = {
  // Esri's Dark Gray Canvas, not CARTO's dark_all. CARTO now watermarks its
  // free raster basemaps with "API KEY REQUIRED", and an api_key query param
  // does not lift it — the CDN returns the byte-identical watermarked tile
  // with or without one. Esri serves clean tiles with attribution only.
  touge: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    options: {
      maxZoom: 19,
      maxNativeZoom: 16, // Esri's dark canvas stops here; Leaflet upscales beyond
      attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
    },
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    options: {
      maxZoom: 19,
      maxNativeZoom: 19,
      attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
    },
  },
  terrain: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    options: {
      maxZoom: 19,
      maxNativeZoom: 17, // OpenTopoMap stops here
      subdomains: 'abc',
      attribution:
        'Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | Style: <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    },
  },
};

export const CATEGORY_COLORS = {
  good: '#4ade80',
  cold: '#60a5fa',
  hot: '#fb923c',
  wet: '#a78bfa',
  unknown: '#6b7480',
};

export const CATEGORY_LABELS = {
  good: 'Good drive',
  cold: 'Too cold',
  hot: 'Too hot',
  wet: 'Rain',
  unknown: 'No forecast',
};
