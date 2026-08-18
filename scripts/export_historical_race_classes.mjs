#!/usr/bin/env node
/** Build 24-month women-only / mixed-race ranking material for active women racers. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const URL_ROOT=String(process.env.SUPABASE_URL||"").trim().replace(/\/+$/,"").replace(/\/rest\/v1$/i,"");
const KEY=String(process.env.SUPABASE_SERVICE_KEY||"");
const OUT=resolve(process.env.WAKE_DICTIONARY_OUT_DIR||"public/data");
const WOMEN=resolve(process.env.WAKE_WOMEN_RACERS_FILE||"data/women_racers.json");
if(!URL_ROOT||!KEY) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY are required");
const headers={apikey:KEY,Authorization:`Bearer ${KEY}`};
const KINDS=["逃げ","差し","まくり","まくり差し","抜き","恵まれ"];
const GRADES=["A1","A2","B1","B2"];

async function getJson(path){return JSON.parse(await readFile(resolve(OUT,path),"utf8"));}
const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
async function fetchWithRetry(url){
  for(let attempt=1;attempt<=5;attempt++){
    const res=await fetch(url,{headers});
    if(res.ok||(![429,502,503,504].includes(res.status))) return res;
    if(attempt===5) return res;
    const retryAfter=Number(res.headers.get("retry-after"));
    const waitMs=Number.isFinite(retryAfter)&&retryAfter>0 ? retryAfter*1000 : 1000*(2**(attempt-1));
    console.warn(`Supabase ${res.status}; retry ${attempt}/5 in ${waitMs}ms`);
    await res.arrayBuffer();
    await sleep(waitMs);
  }
}
async function fetchAll(resource,{select="*",filters=[]}={}){
  const out=[];
  for(let offset=0;;offset+=1000){
    const q=new URLSearchParams({select,limit:"1000",offset:String(offset)});
    for(const [k,v] of filters) q.append(k,v);
    const res=await fetchWithRetry(`${URL_ROOT}/rest/v1/${resource}?${q}`);
    const body=await res.text();
    if(!res.ok) throw new Error(`${resource} ${res.status}: ${body.slice(0,800)}`);
    const rows=body?JSON.parse(body):[]; out.push(...rows);
    if(rows.length<1000) break;
  }
  return out;
}
function chunks(a,n){const z=[];for(let i=0;i<a.length;i+=n)z.push(a.slice(i,i+n));return z;}
async function fetchWomenRows(resource,ids,select,extra=[]){
  const out=[];
  for(const batch of chunks(ids,40)) out.push(...await fetchAll(resource,{select,filters:[["regno",`in.(${batch.join(",")})`],...extra]}));
  return out;
}
function raceKey(r){return `${r.race_date}|${Number(r.place_no)}|${Number(r.race_no)}`;}
function emptyAcc(){return {n:0,win_n:0,ren2_n:0,ren3_n:0,valid_st_n:0,st_sum:0,f_count:0,l_count:0,st_missing_count:0,kimarite:Object.fromEntries(KINDS.map(k=>[k,0]))};}
function add(acc,r){
  acc.n++; const rank=Number(r.rank);
  if(rank===1) acc.win_n++; if(rank>=1&&rank<=2) acc.ren2_n++; if(rank>=1&&rank<=3) acc.ren3_n++;
  if(r.is_f) acc.f_count++; else if(r.is_l) acc.l_count++; else if(r.st_for_average==null) acc.st_missing_count++;
  else {acc.valid_st_n++;acc.st_sum+=Number(r.st_for_average);}
  if(rank===1&&KINDS.includes(r.winner_kimarite)) acc.kimarite[r.winner_kimarite]++;
}
function courseRow(course,a){return {course,n:a.n,win_n:a.win_n,ren2_n:a.ren2_n,ren3_n:a.ren3_n,avg_st:a.valid_st_n?a.st_sum/a.valid_st_n:null,f_count:a.f_count,l_count:a.l_count,st_missing_count:a.st_missing_count,kimarite:a.kimarite};}
function rate(x,n){return n?x*100/n:null;}
function build(scopeRows,profiles){
  const cells=new Map();
  for(const r of scopeRows){const k=`${r.regno}|${r.course}`;if(!cells.has(k))cells.set(k,emptyAcc());add(cells.get(k),r);}
  const racers=[];
  for(const [regno,p] of profiles){
    const courses=[];
    for(let c=1;c<=6;c++){const a=cells.get(`${regno}|${c}`);if(a?.n)courses.push(courseRow(c,a));}
    if(courses.length) racers.push({regno,name:p.name,grade:p.grade,branch:p.branch,gender:"F",is_female:true,courses});
  }
  const baselines={};
  for(const scope of ["ALL",...GRADES]){
    baselines[scope]={};
    for(let c=1;c<=6;c++){
      const a=emptyAcc();
      for(const racer of racers){if(scope!=="ALL"&&racer.grade!==scope)continue;const row=racer.courses.find(x=>x.course===c);if(!row)continue;
        a.n+=row.n;a.win_n+=row.win_n;a.ren2_n+=row.ren2_n;a.ren3_n+=row.ren3_n;a.f_count+=row.f_count;a.l_count+=row.l_count;a.st_missing_count+=row.st_missing_count;
        const valid=row.n-row.f_count-row.l_count-row.st_missing_count;if(valid&&row.avg_st!=null){a.valid_st_n+=valid;a.st_sum+=valid*row.avg_st;}for(const k of KINDS)a.kimarite[k]+=row.kimarite[k]||0;
      }
      baselines[scope][String(c)]={n:a.n,win_rate:rate(a.win_n,a.n),ren2_rate:rate(a.ren2_n,a.n),ren3_rate:rate(a.ren3_n,a.n),avg_st:a.valid_st_n?a.st_sum/a.valid_st_n:null,valid_st_n:a.valid_st_n,f_count:a.f_count,l_count:a.l_count,kimarite_win_rate_per_start:Object.fromEntries(KINDS.map(k=>[k,rate(a.kimarite[k],a.n)]))};
    }
  }
  return {shrinkage_k:15,baselines,racers};
}

const ranking=await getJson("index/ranking_source.json");
const women=JSON.parse(await readFile(WOMEN,"utf8"));
const ids=(women.racers||[]).map(x=>Number(x.regno)).filter(Number.isInteger);
const idSet=new Set(ids);
const profiles=new Map((ranking.racers||[]).filter(x=>idSet.has(Number(x.regno))).map(x=>[Number(x.regno),x]));
const start=ranking.data_period?.actual_start||ranking.data_period?.requested_start;
const end=ranking.data_period?.actual_end||ranking.data_period?.data_end;
if(!start||!end) throw new Error("ranking_source data period unavailable");
const dateFilters=[["race_date",`gte.${start}`],["race_date",`lte.${end}`]];
console.log(`historical_race_classes period=${start}..${end} women=${ids.length}`);
const participants=await fetchWomenRows("race_results",ids,"race_date,place_no,race_no,regno",dateFilters);
const femaleCounts=new Map();
for(const r of participants){const k=raceKey(r);if(!femaleCounts.has(k))femaleCounts.set(k,new Set());femaleCounts.get(k).add(Number(r.regno));}
const valid=await fetchWomenRows("wake_dictionary_base_24m_v1",ids,"race_date,place_no,race_no,regno,course,rank,winner_kimarite,is_f,is_l,st_for_average",[]);
const classified={WOMEN:[],MIXED:[]};
for(const r of valid) classified[(femaleCounts.get(raceKey(r))?.size===6)?"WOMEN":"MIXED"].push(r);
const payload={schema_version:1,generated_at:new Date().toISOString(),data_period:{start,end},definition:{WOMEN:"six registered women racers",MIXED:"active woman racing with at least one male racer"},classes:{}};
for(const cls of ["WOMEN","MIXED"]){
  const rows=classified[cls]; const venues={};
  for(let p=1;p<=24;p++) venues[String(p)]=build(rows.filter(r=>Number(r.place_no)===p),profiles);
  payload.classes[cls]={all:build(rows,profiles),venues,row_count:rows.length};
}
const path=resolve(OUT,"index","historical_race_classes.json");await mkdir(dirname(path),{recursive:true});await writeFile(path,JSON.stringify(payload)+"\n");
console.log(`historical_race_classes women_rows=${classified.WOMEN.length} mixed_rows=${classified.MIXED.length}`);
