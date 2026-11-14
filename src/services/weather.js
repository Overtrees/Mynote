/* 天气与 Google 头像刷新。 */
/* ---------- 天气 ---------- */
var WeatherCache = {
  VERSION: 6,
  KEY: 'weather_cache',
  get: function() {
    try {
      var raw = localStorage.getItem(this.KEY);
      if (!raw) return null;
      var d = JSON.parse(raw);
      if (d.v !== this.VERSION) return null;
      if (Date.now() - d.ts > 1800000) return null;
      return d;
    } catch(e) { console.warn('[此刻] weather cache read', e); return null; }
  },
  set: function(data) {
    try { localStorage.setItem(this.KEY, JSON.stringify({ temp: data.temp, city: data.city, condition: data.condition || "", lat: data.lat, lng: data.lng, ts: Date.now(), v: this.VERSION })); } catch(e) {}
  }
};
async function refreshGoogleAvatar() {
  // OAuth access tokens are intentionally memory-only; never refresh from localStorage.
  return;
}

async function fetchWeather() {
  var cached = WeatherCache.get();
  if (cached) return cached;
  var lat, lng, ipD = null;
  /* GPS 定位 */
  try {
    var pos = await Promise.race([
      new Promise(function(resolve, reject) {
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000, enableHighAccuracy: false });
      }),
      new Promise(function(_, reject) { setTimeout(function(){ reject(new Error("timeout")); }, 5000); })
    ]);
    lat = pos.coords.latitude; lng = pos.coords.longitude;
  } catch(e) {}
  /* ip-api 兜底（GPS失败时） */
  /* 获取城市名（无论 GPS 还是 ip-api 都尝试） */
  if (!Number.isFinite(lat)) {
    try {
      var ipRes = await fetch("https://ip-api.com/json/?fields=lat,lon,city,regionName", { signal: AbortSignal.timeout(4000) });
      if (ipRes.ok) {
        ipD = await ipRes.json();
        if (ipD && Number.isFinite(ipD.lat) && Number.isFinite(ipD.lon)) { lat = ipD.lat; lng = ipD.lon; }
      }
    } catch(e) { console.warn('[此刻] weather ip 兜底失败', e); }
  }
  if (lat == null) return null;
  /* 和风天气 */
  var qwKey = window.MynoteConstants && window.MynoteConstants.QWEATHER_API_KEY;
  if (!qwKey) return null;

  try {
    var qwRes = await fetch("https://jq3dna235e.re.qweatherapi.com/v7/weather/now?location=" + lng + "," + lat + "&key=" + qwKey, { signal: AbortSignal.timeout(4000) });
    if (!qwRes.ok) return null;
    var qwJ = await qwRes.json();
    if (qwJ && qwJ.code === "200" && qwJ.now) {
      var qwCond = qwJ.now.text || "";
      var qwTemp = parseInt(qwJ.now.temp);
      var r = { temp: qwTemp, city: "", condition: qwCond, lat: lat, lng: lng };
      /* 尝试获取城市名 */
      try {
        var geoRes = await fetch("https://jq3dna235e.re.qweatherapi.com/geo/v2/city/lookup?location=" + lng + "," + lat + "&key=" + qwKey, { signal: AbortSignal.timeout(4000) });
        if (geoRes.ok) {
          var geoJ = await geoRes.json();
          if (geoJ && geoJ.code === "200" && geoJ.location && geoJ.location[0]) {
            var loc = geoJ.location[0];
            r.city = loc.adm2 ? loc.adm2 + loc.name : loc.name;
          }
        }
      } catch(ge) {}
      if (!r.city && ipD && ipD.city) r.city = ipD.city + (ipD.regionName ? " " + ipD.regionName : "");
      WeatherCache.set(r); return r;
    }
  } catch(qe) {}
  return null;
}

window.MynoteWeather = {
  WeatherCache: WeatherCache,
  fetchWeather: fetchWeather,
  refreshGoogleAvatar: refreshGoogleAvatar
};
