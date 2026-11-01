// Research only. Run with Node 24 and --experimental-transform-types.
// No server, resolver, cache, credentials file, or production policy is modified.
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

registerHooks({ resolve(specifier, context, next) {
  if (specifier.endsWith('.js') && specifier.startsWith('.')) {
    const candidate = new URL(specifier.slice(0, -3) + '.ts', context.parentURL);
    if (existsSync(fileURLToPath(candidate))) return next(candidate.href, context);
  }
  return next(specifier, context);
} });
const { normalizeRouteRequest } = await import('../../route/server/types/route.ts');
const { toKakaoMapsRequest, toKakaoMobilityRequest } = await import('../../route/server/providers/kakao/mapper.ts');
const { parseKakaoMapsResponse, parseKakaoMobilityResponse } = await import('../../route/server/providers/kakao/parser.ts');

// Original W1 coordinates stay unchanged; they are NOT verified entrance points.
export const cases = [
  ['SEOUL', 'WALKING', [37.5757,126.9735], [37.5609,126.9863]],
  ['SEOUL', 'DRIVING', [37.5547,126.9707], [37.5088,127.0631]],
  ['METRO-OUTSKIRT', 'WALKING', [37.394776627382875,127.11119669891646], [37.4199323570413,127.12629039752096]],
  ['METRO-OUTSKIRT', 'DRIVING', [37.2657,127.0001], [37.2000,127.0960]],
  ['BUSAN', 'WALKING', [35.1152,129.0422], [35.0985,129.0280]],
  ['BUSAN', 'DRIVING', [35.1152,129.0422], [35.1587,129.1604]],
  ['REGIONAL-CITY', 'WALKING', [35.8153,127.1497], [35.8242,127.1480]],
  ['REGIONAL-CITY', 'DRIVING', [35.8497,127.1617], [35.8150,127.1530]],
  ['RURAL', 'WALKING', [36.5390,128.5180], [36.5395,128.5185]],
  ['RURAL', 'DRIVING', [36.5390,128.5180], [36.5684,128.7294]],
];
const point = ([latitude,longitude]) => ({ coordinates: { latitude,longitude } });
export function requestFor(row) {
  return normalizeRouteRequest({ origin:point(row[2]), destination:point(row[3]), travelMode:row[1], countryCode:'KR' });
}
export function tmapSpec(request) {
  assert.ok(['WALKING','DRIVING'].includes(request.travelMode));
  assert.ok(request.intermediates.length <= 5);
  const o=request.origin.coordinates, d=request.destination.coordinates;
  assert.ok(o && d, 'coordinates required');
  const walking=request.travelMode==='WALKING';
  return { url:`https://apis.openapi.sk.com/tmap/routes${walking?'/pedestrian':''}?version=1`, body: {
    startX:o.longitude,startY:o.latitude,endX:d.longitude,endY:d.latitude,
    reqCoordType:'WGS84GEO',resCoordType:'WGS84GEO',
    ...(walking ? {startName:encodeURIComponent(request.origin.name || '출발'),endName:encodeURIComponent(request.destination.name || '도착')} : {trafficInfo:'Y'}),
    ...(request.intermediates.length ? {passList:request.intermediates.map(p=>`${p.coordinates.longitude},${p.coordinates.latitude}`).join('_')} : {}),
  } };
}
export function parseTmap(body) {
  assert.equal(body?.type,'FeatureCollection');
  assert.ok(Array.isArray(body.features));
  const summary=body.features.find(f=>Number.isFinite(f.properties?.totalDistance) && Number.isFinite(f.properties?.totalTime))?.properties;
  assert.ok(summary,'missing totals');
  const path=body.features.filter(f=>f.geometry?.type==='LineString').flatMap(f=>f.geometry.coordinates.map(([lng,lat])=>({lat,lng})));
  return {distanceMeters:summary.totalDistance,durationSeconds:summary.totalTime,path};
}
export function meters(a,b) {
  const rad=x=>x*Math.PI/180;
  const h=Math.sin(rad(b.lat-a.lat)/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(rad(b.lng-a.lng)/2)**2;
  return 6371000*2*Math.asin(Math.sqrt(Math.min(1,h)));
}
export function quality(route,row) {
  const path=route.path, origin={lat:row[2][0],lng:row[2][1]}, destination={lat:row[3][0],lng:row[3][1]};
  const valid=path.length>=2 && path.every(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&p.lat>=33&&p.lat<=38.7&&p.lng>=124.5&&p.lng<=131);
  if(!valid) return {geometry:'INVALID',humanReview:'PENDING'};
  const jumps=path.slice(1).map((p,i)=>meters(path[i],p));
  const length=jumps.reduce((a,b)=>a+b,0), straight=meters(origin,destination);
  const ratio=route.distanceMeters/straight, speed=route.distanceMeters/route.durationSeconds*3.6;
  const flags=[];
  if(!(route.distanceMeters>0 && route.durationSeconds>0)) flags.push('INVALID_TOTALS');
  if(meters(origin,path[0])>150 || meters(destination,path.at(-1))>150) flags.push('SNAP_DISTANCE');
  if(jumps.some(x=>x>(row[1]==='WALKING'?2000:5000))) flags.push('GEOMETRY_JUMP');
  if(Math.abs(length-route.distanceMeters)/route.distanceMeters>0.1) flags.push('LENGTH_MISMATCH');
  if(ratio<1 || ratio>(row[1]==='WALKING'?2.5:3)) flags.push('DETOUR_RATIO');
  if(speed<(row[1]==='WALKING'?2.5:8)||speed>(row[1]==='WALKING'?6:80)) flags.push('SPEED');
  return {geometry:flags.length?'SUSPECT':'PASS',flags,points:path.length,polylineMeters:Math.round(length),detourRatio:ratio,speedKmh:speed,geometryHash:createHash('sha256').update(JSON.stringify(path)).digest('hex'),humanReview:'PENDING'};
}
const credentials = {
  'kakao-maps':process.env.KAKAO_REST_API_KEY,
  'kakao-mobility':process.env.KAKAO_MOBILITY_API_KEY || process.env.KAKAO_REST_API_KEY,
  tmap:process.env.TMAP_APP_KEY,
};
const live=process.argv.includes('--live');
if(process.argv.includes('--self-test')) {
  // Synthetic data proves mapping, never live route quality.
  const row=cases[0], request=requestFor(row), spec=toKakaoMapsRequest(request);
  assert.equal(spec.query.get('start_x'),'126.9735');
  assert.equal(toKakaoMobilityRequest(requestFor(cases[1])).query.get('origin'),'126.9707,37.5547');
  const path=[[126.9735,37.5757],[126.9863,37.5609]];
  const walk=parseKakaoMapsResponse({status:'OK',route:{properties:{totalDistance:2000,totalTime:1800},legs:[{steps:[{path:{points:path}}]}]}},'WALKING').routes[0];
  const drive=parseKakaoMobilityResponse({routes:[{result_code:0,summary:{distance:2000,duration:200},sections:[{roads:[{vertexes:path.flat()}]}]}]}).routes[0];
  const tmap=parseTmap({type:'FeatureCollection',features:[{properties:{totalDistance:2000,totalTime:1800},geometry:{type:'Point',coordinates:path[0]}},{geometry:{type:'LineString',coordinates:path}}]});
  assert.deepEqual(walk.path,drive.path); assert.deepEqual(tmap.path,walk.path);
  assert.equal(tmapSpec(request).body.startName,encodeURIComponent('출발'));
  assert.throws(()=>parseTmap({type:'FeatureCollection',features:[]}));
  assert.throws(()=>parseKakaoMapsResponse({status:'ROUTE_RESULT_NOT_FOUND'},'WALKING'));
  assert.throws(()=>parseKakaoMobilityResponse({routes:[{result_code:104}]}));
  assert.equal(quality({path:[]},row).geometry,'INVALID');
  assert.equal(quality({...walk,path:[{lat:0,lng:0},{lat:1,lng:1}]},row).geometry,'INVALID');
  console.log(JSON.stringify({kind:'SYNTHETIC_SELF_TEST',status:'PASS',networkCalls:0,checks:['kakao-walk-mapping','kakao-drive-mapping','kakao-walk-parser','kakao-drive-parser','tmap-normalizer','tmap-default-names','malformed-tmap','kakao-no-route','mobility-no-route','empty-geometry','out-of-KR-geometry']}));
} else {
  // Live is a smoke run, not the W1 five-repetition benchmark. All output is
  // allowlisted; never print upstream messages, headers, URLs, or raw bodies.
  // --coordinates=<file> must contain this same 10-row format with reviewed entrances.
  const coordinateArg=process.argv.find(x=>x.startsWith('--coordinates='));
  const rows=coordinateArg ? JSON.parse(readFileSync(coordinateArg.slice(14),'utf8')) : cases;
  if(live && (!coordinateArg || !process.argv.includes('--policy-reviewed'))) throw new Error('Live requires --coordinates=<reviewed-file> and --policy-reviewed; see validation-report.md');
  assert.equal(rows.length,10);
  assert.equal(new Set(rows.map(r=>`${r[0]}:${r[1]}`)).size,10);
  for(const row of rows) {
    assert.ok(cases.some(c=>c[0]===row[0]&&c[1]===row[1]));
    for(const coords of [row[2],row[3]]) assert.ok(Array.isArray(coords)&&coords.length===2&&coords.every(Number.isFinite)&&coords[0]>=33&&coords[0]<=38.7&&coords[1]>=124.5&&coords[1]<=131);
  }
  const output={kind:live?'LIVE_SMOKE':'PREFLIGHT_ONLY',timestamp:new Date().toISOString(),credentialPresence:Object.fromEntries(Object.entries(credentials).map(([k,v])=>[k,Boolean(v)])),networkCalls:0,results:[]};
  for(const row of rows) for(const provider of [row[1]==='WALKING'?'kakao-maps':'kakao-mobility','tmap']) {
    const result={region:row[0],mode:row[1],provider,status:!credentials[provider]?'MISSING_CREDENTIAL':!live?'NOT_EXECUTED':'PENDING',etaSeconds:null,distanceMeters:null,latencyMs:null,httpStatus:null,geometry:null,error:null};
    if(live && credentials[provider]) {
      const request=requestFor(row), start=performance.now();
      try {
        let url,init;
        if(provider==='tmap') { const spec=tmapSpec(request); url=spec.url; init={method:'POST',headers:{appKey:credentials[provider],'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(spec.body)}; }
        else {const spec=provider==='kakao-maps'?toKakaoMapsRequest(request):toKakaoMobilityRequest(request); url=`${spec.url}?${spec.query}`; init={headers:{Authorization:`KakaoAK ${credentials[provider]}`}};}
        output.networkCalls++;
        const response=await fetch(url,{...init,redirect:'error',signal:AbortSignal.timeout(10000)});
        result.httpStatus=response.status;
        const body=await response.json();
        if(!response.ok) { result.status='HTTP_ERROR'; result.error=`HTTP_${response.status}`; }
        else {
          const route=provider==='tmap'?parseTmap(body):provider==='kakao-maps'?parseKakaoMapsResponse(body,'WALKING').routes[0]:parseKakaoMobilityResponse(body).routes[0];
          result.status=route.distanceMeters>0&&route.durationSeconds>0&&route.path.length>=2?'SUCCESS':'INVALID_ROUTE';
          result.etaSeconds=route.durationSeconds;result.distanceMeters=route.distanceMeters;result.geometry=quality(route,row);
        }
      } catch(error) {result.status='ERROR';result.error=error?.name==='TimeoutError'?'TIMEOUT':'NETWORK_OR_SCHEMA_ERROR';}
      result.latencyMs=Math.round(performance.now()-start);
      await delay(1000);
    }
    output.results.push(result);
  }
  console.log(JSON.stringify(output,null,2));
}
