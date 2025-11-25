// PDF worker setup (safe guard)
if (typeof window !== 'undefined' && window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.6.82/pdf.worker.min.js';
}

const API_URL = '/.netlify/functions/analyze';

const SAMPLE_GOOD = `Client: Jane Doe
Objective: Long-term growth to age 60.
Risk: Balanced; Capacity for loss: Medium.
Charges: OCF 0.25%, Platform 0.20%, Adviser ongoing 0.50%.
Rationale: Meets objectives and risk, time horizon 15 years. Risks explained.
Ongoing service: Annual review and periodic statements.`;

const SAMPLE_BAD = `Client: J.D.
Objective: Make money.
Risk: High??
Recommendation: This fund is the best and guarantees performance.
Charges: n/a.
Rationale: Great returns seen online. No capacity for loss, no costs, no risks.
Execution-only. No knowledge/experience assessed.`;

const RULES = {
  title: 'FCA (COBS) Demo Ruleset',
  sections: [
    { id:'comms', title:'COBS 4–6: Communications & Disclosures', subsections:[
      { id:'clarity', title:'Fair, clear & not misleading', rules:[
        { id:'no-absolute-claims', title:'No absolutes / guarantees',
          requirement:'Avoid claims that could mislead (e.g., “guaranteed”, “no risk”).',
          pass_criteria:'No absolutes; risks balanced.', flag_criteria:'Promotional tone, weak balance.',
          fail_criteria:'Contains absolutes.', handbook_refs:['COBS 4.2'], severity:'critical',
          red_flags:['guaranteed','cannot lose','no risk'] },
        { id:'disclosure-costs', title:'Costs & charges disclosed',
          requirement:'Clear disclosure of adviser/platform/product costs.',
          pass_criteria:'Costs with % or £.', flag_criteria:'Costs mentioned but no figures.',
          fail_criteria:'No costs mentioned.', handbook_refs:['COBS 6','COBS 6.1ZA'], severity:'major' }
      ]}
    ]},
    { id:'suitability', title:'COBS 9: Suitability', subsections:[
      { id:'objectives', title:'Client objectives & rationale', rules:[
        { id:'obj-stated', title:'Objectives stated',
          requirement:'Documented objectives & time horizon.',
          pass_criteria:'Clear objective + horizon.', flag_criteria:'Vague objective.',
          fail_criteria:'No objective.', handbook_refs:['COBS 9A.2'], severity:'major' },
        { id:'rationale-evidence', title:'Recommendation rationale',
          requirement:'Explain why rec meets needs, risk, capacity.',
          pass_criteria:'Rationale links to risk/capacity/objectives.', flag_criteria:'Rationale thin.',
          fail_criteria:'No rationale.', handbook_refs:['COBS 9A.2.1R'], severity:'major' }
      ]},
      { id:'risk', title:'Risk & capacity for loss', rules:[
        { id:'risk-declared', title:'Risk profile declared',
          requirement:'State risk tolerance and capacity for loss.',
          pass_criteria:'Both present and consistent.', flag_criteria:'Only one or vague.',
          fail_criteria:'Neither present.', handbook_refs:['COBS 9A'], severity:'major' }
      ]},
      { id:'replacement', title:'Replacement business', rules:[
        { id:'rep-like', title:'Like-for-like comparison (if switching)',
          requirement:'Compare charges/features; best-interest rationale.',
          pass_criteria:'Quantified comparison + tailored rationale.', flag_criteria:'Mentions switch but lacks figures/features.',
          fail_criteria:'No comparison.', handbook_refs:['COBS 9A'], severity:'critical', context:{advice_type:['replacement']} }
      ]},
      { id:'retirement', title:'Retirement income (drawdown)', rules:[
        { id:'draw-sustain', title:'Withdrawal sustainability & sequencing risk',
          requirement:'Discuss sustainability and contingencies.',
          pass_criteria:'Rate + stress/sustainability + contingency.', flag_criteria:'Mentions withdrawals without detail.',
          fail_criteria:'No sustainability discussion.', handbook_refs:['COBS 9A','FG21/5'], severity:'major',
          context:{advice_type:['drawdown'], age_band:['55plus','75plus']} }
      ]}
    ]},
    { id:'appropriateness', title:'COBS 10A: Appropriateness (non-advised)', subsections:[
      { id:'knowledge', title:'Knowledge & experience', rules:[
        { id:'app-check', title:'Appropriateness test completed',
          requirement:'K&E assessed for complex products (non-advised).',
          pass_criteria:'K&E clearly assessed.', flag_criteria:'Partial/unclear.',
          fail_criteria:'No appropriateness test.', handbook_refs:['COBS 10A'], severity:'critical',
          context:{channel:['nonadvised']} }
      ]}
    ]},
    { id:'ongoing', title:'COBS 16: Ongoing requirements', subsections:[
      { id:'statements', title:'Ongoing service & reports', rules:[
        { id:'ongoing-service', title:'Ongoing service explained',
          requirement:'Explain ongoing service and reporting cadence.',
          pass_criteria:'Clear service & cadence.', flag_criteria:'Mentioned but vague.',
          fail_criteria:'No statement.', handbook_refs:['COBS 16'], severity:'minor' }
      ]}
    ]}
  ]
};

let filters = {
  adviceType:'standard',
  channel:'advised',
  ageBand:'55plus',
  vulnerable:false
};

let outcomes = {};

function applyContextNotes(){
  const notes=[];
  if(filters.adviceType!=='standard'){ notes.push(filters.adviceType.replace('_',' ')); }
  if(filters.channel==='nonadvised'){ notes.push('non-advised'); }
  if(filters.ageBand!=='under55'){ notes.push(filters.ageBand); }
  if(filters.vulnerable){ notes.push('vulnerability flagged'); }
  const el = document.getElementById('contextNote');
  if (el) {
    el.textContent = notes.length ? 'Additional checks: '+notes.join(', ') : 'Standard checks only.';
  }
}

function pct(n){ return (Math.round(n*1000)/10).toFixed(1)+'%'; }

function isRuleActive(r){
  const c=r.context; if(!c) return true;
  if(c.advice_type && !c.advice_type.includes(filters.adviceType)) return false;
  if(c.channel && !c.channel.includes(filters.channel)) return false;
  if(c.age_band && !c.age_band.includes(filters.ageBand)) return false;
  return true;
}

function evidence(text, rex){
  const m=text.toLowerCase().match(rex);
  if(!m) return null;
  const i=m.index||0;
  return text
    .slice(Math.max(0,i-60), Math.min(text.length, i+120))
    .replace(/\n/g,' ');
}


function triggersAbsoluteClaim(text) {
  const t = text.toLowerCase();

  // Negated/realistic risk warnings -> do NOT fail
  const negations = [
    "not guaranteed",
    "are not guaranteed",
    "is not guaranteed",
    "no guarantee that",
    "cannot be guaranteed",
    "not a guarantee"
  ];
  if (negations.some(n => t.includes(n))) return false;

  // DB transfer context: expected to mention guarantees
  if (filters.adviceType === "db_transfer") {
    if (t.includes("guaranteed income")) return false;
    if (t.includes("guaranteed benefits")) return false;
  }

  // Genuine red-flag phrasing
  const bad = [
    "guaranteed returns",
    "guaranteed growth",
    "guaranteed performance",
    "guaranteed to make money",
    "cannot lose",
    "no risk"
  ];

  return bad.some(b => t.includes(b));
}


function evaluate(text){
  const t=text.toLowerCase(); const out={};

  // smarter absolute-claims logic
  const red = /(guaranteed|cannot lose|no risk)/;
  const hasBadAbsolute = triggersAbsoluteClaim(text);
  out['no-absolute-claims'] = {
    status: hasBadAbsolute ? 'fail' : 'pass',
    snippet: hasBadAbsolute ? evidence(text, red) : null
  };

  const kwCosts=/(ocf|ongoing|adviser|advice fee|platform|fee|fees|charge|charges|cost|costs)/;
  const numPct=/(%|£|\d+\.\d{2}|\d+)/;
  const hasCosts=kwCosts.test(t); const hasNum=numPct.test(text);
  out['disclosure-costs']={
    status:(hasCosts&&hasNum)?'pass':(hasCosts?'flag':'fail'),
    snippet:evidence(text,/(ocf|adviser|platform|fee|charge|cost).{0,40}(%|£|\d)/i)
  };

  const objPass=/(objective|goal|aim)/.test(t)&&/(retire|retirement|growth|income|time horizon|years?)/.test(t);
  const objFlag=/(objective|goal|aim)/.test(t);
  out['obj-stated']={
    status:objPass?'pass':objFlag?'flag':'fail',
    snippet:evidence(text,/(objective|goal|aim)/i)
  };

  const ratPass=/(aligns|rationale|because|therefore|suitable|meets needs)/.test(t)&&/(risk|capacity for loss|time horizon|objective)/.test(t);
  const ratFlag=/(rationale|because|suitable)/.test(t);
  out['rationale-evidence']={
    status:ratPass?'pass':ratFlag?'flag':'fail',
    snippet:evidence(text,/(rationale|because|suitable)/i)
  };

  const riskBoth=/risk[: ](low|medium|balanced|high)/.test(t)&&/capacity for loss/.test(t);
  const riskOne=(/risk[: ]/.test(t)||/capacity for loss/.test(t));
  out['risk-declared']={
    status:riskBoth?'pass':riskOne?'flag':'fail',
    snippet:evidence(text,/(risk|capacity for loss)/i)
  };

  if(filters.adviceType==='replacement'){
    const re=/(switch|replace|transfer)/;
    const comp=/(charge|fee|cost|benefit|feature|exit)/;
    out['rep-like']={
      status:re.test(t)?(comp.test(t)?'pass':'flag'):'fail',
      snippet:evidence(text,/(switch|replace|transfer)/i)
    };
  }

  if(filters.adviceType==='drawdown'&&(filters.ageBand!=='under55')){
    const draw=/(drawdown|withdrawal|income)/;
    const sust=/(sustain|stress|sequence|contingen|buffer|bucketing|rate)/;
    out['draw-sustain']={
      status:draw.test(t)?(sust.test(t)?'pass':'flag'):'fail',
      snippet:evidence(text,/(drawdown|withdrawal|income)/i)
    };
  }

  if(filters.channel==='nonadvised'){
    const app=/(appropriate|appropriateness|knowledge|experience)/;
    out['app-check']={
      status:app.test(t)?'pass':'fail',
      snippet:evidence(text,/(appropriate|appropriateness|knowledge|experience)/i)
    };
  } else {
    out['app-check']={ status:'pass', snippet:null };
  }

  const on=/ongoing advice|ongoing service|review (annually|yearly|quarterly)|periodic statement/;
  out['ongoing-service']={
    status:on.test(t)?'pass':(/ongoing/.test(t)?'flag':'fail'),
    snippet:evidence(text,/(ongoing|review|statement)/i)
  };

  return out;
}

function ruleBlock(r, st, snip){
  const klass=st==='pass'?'pass':st==='flag'?'flag':st==='fail'?'fail':'mute';
  const refs=(r.handbook_refs||[]).join(', ');
  const expl=st==='pass'?r.pass_criteria:st==='flag'?r.flag_criteria:st==='fail'?r.fail_criteria:'Not evaluated';
  return `<div class='rule'>
    <div class='rule-head'><span class='pill ${klass}'>${st}</span><strong>${r.title}</strong><span class='refs'>${refs}</span></div>
    <div class='rule-body'><div class='req'><em>Requirement:</em> ${r.requirement}</div>
      <div class='expl'><em>Why:</em> ${expl}</div>
      ${snip? `<div class='expl'><em>Evidence:</em> <code>${snip.replace(/</g,'&lt;')}</code></div>`:''}
    </div></div>`;
}

function scoreSubsection(ss){
  const arr=[];
  for(const r of ss.rules){
    if(!isRuleActive(r)) continue;
    const o=outcomes[r.id];
    if(o) arr.push({pass:1,flag:0.5,fail:0}[o.status]);
  }
  return arr.length? (arr.reduce((a,b)=>a+b,0)/arr.length) : null;
}

function scoreSection(s){
  const arr=[];
  for(const ss of s.subsections){
    const v=scoreSubsection(ss);
    if(v!==null) arr.push(v);
  }
  return arr.length? (arr.reduce((a,b)=>a+b,0)/arr.length) : null;
}

function calcOverall(){
  const sScores=[];
  for(const s of RULES.sections){
    const sub=[];
    for(const ss of s.subsections){
      const rScores=[];
      for(const r of ss.rules){
        if(!isRuleActive(r)) continue;
        if(outcomes[r.id]) rScores.push({pass:1,flag:0.5,fail:0}[outcomes[r.id].status]);
      }
      sub.push(rScores.length? (rScores.reduce((a,b)=>a+b,0)/rScores.length) : null);
    }
    const clean=sub.filter(v=>v!==null);
    sScores.push(clean.length? (clean.reduce((a,b)=>a+b,0)/clean.length) : null);
  }
  const used=sScores.filter(v=>v!==null);
  return used.length? (used.reduce((a,b)=>a+b,0)/used.length) : null;
}

function render(){
  const acc=document.getElementById('accordion');
  if (!acc) return;
  acc.innerHTML='';

  for(const section of RULES.sections){
    const sEl=document.createElement('details');
    sEl.open=true;
    const sScore=scoreSection(section);
    sEl.innerHTML =
      `<summary class='summary'>${section.title} <small>(${sScore!==null? pct(sScore): '—'})</small></summary>`;
    const inner=document.createElement('div');
    inner.className='inner';

    for(const ss of section.subsections){
      const ssScore=scoreSubsection(ss);
      const box=document.createElement('div');
      box.className='subbox';
      box.innerHTML = `<h3>${ss.title} <small>(${ssScore!==null? pct(ssScore): '—'})</small></h3>`;
      for(const r of ss.rules){
        if(!isRuleActive(r)) continue;
        const o=outcomes[r.id];
        const st=o?o.status:'not evaluated';
        const sn=o?o.snippet:'';
        box.insertAdjacentHTML('beforeend', ruleBlock(r, st, sn));
      }
      inner.appendChild(box);
    }

    sEl.appendChild(inner);
    acc.appendChild(sEl);
  }

  const overall=calcOverall();
  const overallEl = document.getElementById('overall');
  if (overallEl) {
    overallEl.textContent = overall!==null? pct(overall): '—';
  }
}

function progressSim(done){
  const el=document.getElementById('progress');
  const bar=document.getElementById('bar');
  const lab=document.getElementById('barLabel');
  if (!el || !bar || !lab) { done(); return; }
  el.hidden=false;
  let v=0;
  const step=()=>{
    v+=Math.random()*18+6;
    if(v>=100){
      v=100;
      bar.style.width=v+'%';
      lab.textContent='Finalising…';
      setTimeout(()=>{el.hidden=true; done();}, 450);
      return;
    }
    bar.style.width=v+'%';
    lab.textContent = v<60? 'Parsing report…' : v<90? 'Checking rules…' : 'Scoring…';
    setTimeout(step, 240);
  };
  step();
}

async function getBackendOutcomes(text){
  const payload = {
    text,
    filters: {
      advice_type: filters.adviceType,
      channel: filters.channel,
      age_band: filters.ageBand,
      vulnerable: filters.vulnerable
    }
  };

  const res = await fetch(API_URL, {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify(payload)
  });

  const raw = await res.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch(e){ data = {}; }

  if(!res.ok){
    console.warn('Backend error', res.status, res.statusText, raw);
    return null;
  }

  if(data && data.outcomes && typeof data.outcomes === 'object'){
    console.log('Using backend outcomes');
    return data.outcomes;
  }

  console.log('Backend returned no usable outcomes; falling back to local evaluate()');
  return null;
}

document.addEventListener('DOMContentLoaded', () => {
  const srText=document.getElementById('srText');
  if (!srText) return;

  const loadGood=document.getElementById('loadGood');
  const loadBad=document.getElementById('loadBad');
  const fileInput=document.getElementById('fileInput');
  const runBtn=document.getElementById('runBtn');
  const exportBtn=document.getElementById('exportBtn');

  if (loadGood) loadGood.onclick=()=>{ srText.value=SAMPLE_GOOD; };
  if (loadBad) loadBad.onclick =()=>{ srText.value=SAMPLE_BAD; };

  if (fileInput) {
    fileInput.addEventListener('change', async (e)=>{
      const f=e.target.files[0]; if(!f) return;
      const name=f.name.toLowerCase();
      try{
        let text='';
        if(name.endsWith('.txt')){
          text = await f.text();
        } else if(name.endsWith('.docx')){
          const ab = await f.arrayBuffer();
          const res = await window.mammoth.extractRawText({arrayBuffer:ab});
          text = res.value || '';
        } else if(name.endsWith('.pdf')){
          const ab = await f.arrayBuffer();
          const pdf = await window.pdfjsLib.getDocument({data:ab}).promise;
          let t='';
          for(let p=1;p<=pdf.numPages;p++){
            const pg=await pdf.getPage(p);
            const c=await pg.getTextContent();
            t += '\n\n' + c.items.map(i=>i.str).join(' ');
          }
          text = t;
        } else {
          alert('Unsupported file type. Please upload .txt, .docx or .pdf');
          return;
        }
        srText.value = text;
      }catch(err){
        console.error(err);
        alert('Could not read that file. If it is a scanned PDF, text extraction may not work.');
      }
    });
  }

  if (runBtn) {
    runBtn.onclick = () => {
      const txt=srText.value.trim();
      if(!txt){
        alert('Paste some SR text or load a file first.');
        return;
      }

      const adviceTypeEl = document.getElementById('adviceType');
      const channelEl = document.getElementById('channel');
      const ageBandEl = document.getElementById('ageBand');
      const vulnerableEl = document.getElementById('vulnerable');

      if (adviceTypeEl) filters.adviceType = adviceTypeEl.value;
      if (channelEl) filters.channel = channelEl.value;
      if (ageBandEl) filters.ageBand = ageBandEl.value;
      if (vulnerableEl) filters.vulnerable = vulnerableEl.checked;

      applyContextNotes();

      progressSim(async () => {
        let backendOut = null;
        try {
          backendOut = await getBackendOutcomes(txt);
        } catch (e) {
          console.error('Backend call failed', e);
        }

        if (backendOut && Object.keys(backendOut).length) {
          outcomes = backendOut;
        } else {
          outcomes = evaluate(txt);
        }

        render();
        window.scrollTo({top:0,behavior:'smooth'});
      });
    };
  }

  if (exportBtn) {
    exportBtn.onclick=()=>{
      if(!outcomes || !Object.keys(outcomes).length){
        alert('Run a check first.');
        return;
      }
      const payload={ generated_at:new Date().toISOString(), filters, outcomes };
      const blob=new Blob([JSON.stringify(payload,null,2)], {type:'application/json'});
      const a=document.createElement('a');
      a.href=URL.createObjectURL(blob);
      a.download='assure_results.json';
      a.click();
    };
  }

  applyContextNotes();
  render();
});
