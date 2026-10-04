const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = source.indexOf('function getWeatherIcon(');
const end = source.indexOf('const IW_BEAUFORT=', start);
assert(start > 0 && end > start);
const ctx = {};
vm.runInNewContext(source.slice(start, end) + ';this.api={getWeatherIcon,weatherSlugTexto};', ctx);
const {getWeatherIcon, weatherSlugTexto} = ctx.api;

async function weather(symbol, observation = null) {
  const {default: handler} = await import('../api/weather.js');
  const realFetch = global.fetch;
  const time = new Date().toISOString();
  const forecast = {properties:{timeseries:[{time,data:{
    instant:{details:{air_temperature:20,cloud_area_fraction:0,wind_speed:2}},
    next_1_hours:{summary:{symbol_code:symbol},details:{precipitation_amount:0}}
  }}]}};
  const rows = observation ? [{icaoId:'SABE',reportTime:time,temp:20,dewp:10,wspd:4,clouds:[],...observation}] : [];
  global.fetch = async url => ({ok:true,json:async () => String(url).includes('met.no') ? forecast : rows});
  const res = {setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;}};
  try { await handler({}, res); } finally { global.fetch = realFetch; }
  assert.equal(res.code,200);
  return res.body;
}

test('clear model skies produce a sun without clouds, also in the daily forecast', async () => {
  for (const symbol of ['clearsky_day','clearsky_night','clearsky_polartwilight']) {
    const result = await weather(symbol);
    assert.equal(result.current.weather_code,0);
    assert.equal(result.daily.weather_code[0],0);
    const isDay = symbol !== 'clearsky_night';
    const icon = getWeatherIcon(20,result.current.weather_code,7,isDay);
    assert.equal(icon.slug,isDay ? 'clear-day' : 'clear-night');
  }
  assert.equal(weatherSlugTexto('clear-day'),'Soleado');
});

test('the reported CAVOK + clearsky case shows only the sun without changing temperature', async () => {
  const result = await weather('clearsky_day',{rawOb:'METAR SABE 041400Z VRB04KT CAVOK 20/10 Q1014 NOSIG',cover:'CAVOK'});
  assert.equal(result.current.temperature_2m,20);
  assert.equal(result.current.cloud_cover,0);
  assert.equal(result.current.source,'METAR Aeroparque');
  assert.equal(result.current.weather_code,0);
  assert.equal(getWeatherIcon(20,result.current.weather_code,7,true).slug,'clear-day');
});

test('CAVOK and NSC alone do not force cloudless skies, future thunder is not present weather', async () => {
  for (const sky of ['CAVOK','NSC']) {
    for (const symbol of ['fair_day','cloudy']) {
      const result = await weather(symbol,{rawOb:`METAR SABE 041400Z 08004KT ${sky} 20/10 Q1014 TEMPO -TSRA BKN030`});
      assert.equal(result.current.weather_code,1);
      assert.equal(getWeatherIcon(20,result.current.weather_code,7,true).slug,'mostly-clear-day');
    }
  }
});

test('observed sky cover wins over a clear model, keeping actual clouds visible', async () => {
  const cases = [['FEW',1,'mostly-clear-day'],['SCT',2,'partly-cloudy-day'],['BKN',3,'overcast-day'],['OVC',3,'overcast-day']];
  for (const [cover,code,slug] of cases) {
    const result = await weather('clearsky_day',{rawOb:`METAR SABE 041400Z 08004KT 9999 ${cover}030 20/10 Q1014`,clouds:[{cover,base:3000}]});
    assert.equal(result.current.weather_code,code);
    assert.equal(getWeatherIcon(20,code,7,true).slug,slug);
  }
  for (const cover of ['CLR','SKC']) {
    const result = await weather('partlycloudy_day',{rawOb:`METAR SABE 041400Z 08004KT 9999 ${cover} 20/10 Q1014`,cover});
    assert.equal(result.current.weather_code,0);
  }
});

test('model fair, partly cloudy and overcast skies stay distinct by day and night', async () => {
  for (const [symbol,code,slug] of [['fair',1,'mostly-clear'],['partlycloudy',2,'partly-cloudy'],['cloudy',3,'overcast']]) {
    for (const day of [true,false]) {
      const dn = day ? 'day' : 'night';
      const result = await weather(`${symbol}_${dn}`);
      assert.equal(result.current.weather_code,code);
      assert.equal(getWeatherIcon(20,code,7,day).slug,`${slug}-${dn}`);
    }
  }
});

test('rain, storms and fog still override sky cover; extreme heat keeps its sunny icon', async () => {
  const cases = [['-SHRA',61,'rain'],['TSRA',95,'thunderstorms-day'],['FG',45,'fog-day']];
  for (const [phenomenon,code,slug] of cases) {
    const result = await weather('clearsky_day',{rawOb:`METAR SABE 041400Z 08004KT 3000 ${phenomenon} BKN030 20/10 Q1014`,clouds:[{cover:'BKN'}]});
    assert.equal(result.current.weather_code,code);
    assert.equal(getWeatherIcon(20,code,7,true).slug,slug);
  }
  assert.equal(getWeatherIcon(36,0,7,true).slug,'sun-hot');
});
