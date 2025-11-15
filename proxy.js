const express = require('express');
const app = express();

/* ========= Helpers ========= */
function fmtNum(v){return (typeof v==='number'&&Number.isFinite(v))?v.toFixed(2):'-';}
function arrowFor(c){if(typeof c!=='number'||!Number.isFinite(c))return'';return c>0?'↑':(c<0?'↓':'');}
function clsFor(c){if(typeof c!=='number'||!Number.isFinite(c))return'';return c>0?'positive':(c<0?'negative':'');}

/* ========= Data fetch (NSE India) ========= */
async function fetchIndex(indexName){
  const url=`https://www.nseindia.com/api/equity-stockIndices?index=${encodeURIComponent(indexName)}`;
  const res=await fetch(url,{headers:{
    "User-Agent":"Mozilla/5.0","Accept":"application/json","Accept-Language":"en-US,en;q=0.9","Referer":"https://www.nseindia.com/"
  }});
  if(!res.ok) throw new Error(`NSE API error: ${res.status}`);
  const json=await res.json();
  if(!json||!Array.isArray(json.data)) throw new Error("NSE API error: invalid response");
  return json.data.map(s=>({
    symbol:s.symbol,cmp:s.lastPrice,change:s.change,changePct:s.pChange,
    open:s.open,high:s.dayHigh,low:s.dayLow,prevClose:s.previousClose,volume:s.totalTradedVolume
  }));
}

/* ========= Builders ========= */
function buildRows(rows,indexName,interval){
  const indexRow=rows.find(r=>r.symbol===indexName);
  const otherRows=rows.filter(r=>r.symbol!==indexName).sort((a,b)=>a.symbol.localeCompare(b.symbol));

  const renderBodyRow=(r)=>{
    const cls=clsFor(r.change),arr=arrowFor(r.change);
    const pct=(typeof r.changePct==='number'&&Number.isFinite(r.changePct))?`${r.changePct.toFixed(2)}%`:'-';
    const vol=(typeof r.volume==='number'&&Number.isFinite(r.volume))?r.volume.toLocaleString('en-IN'):'-';
    return `
      <tr>
        <td class="${cls}">${r.symbol} <span class="arrow">${arr}</span></td>
        <td class="${cls}">${fmtNum(r.cmp)}</td>
        <td class="${cls}">${fmtNum(r.change)}</td>
        <td class="${cls}">${pct} <span class="arrow">${arr}</span></td>
        <td>${fmtNum(r.open)}</td>
        <td>${fmtNum(r.high)}</td>
        <td>${fmtNum(r.low)}</td>
        <td>${fmtNum(r.prevClose)}</td>
        <td>${vol}</td>
      </tr>
    `;
  };

  const renderIndexHeaderRow=(r)=>{
    const cls=clsFor(r.change);
    const pct=(typeof r.changePct==='number'&&Number.isFinite(r.changePct))?`${r.changePct.toFixed(2)}%`:'-';
    const vol=(typeof r.volume==='number'&&Number.isFinite(r.volume))?r.volume.toLocaleString('en-IN'):'-';
    return `
      <tr class="index-row">
        <th class="${cls}" scope="colgroup">${r.symbol}</th>
        <th class="${cls}" scope="col">${fmtNum(r.cmp)}</th>
        <th class="${cls}" scope="col">${fmtNum(r.change)}</th>
        <th class="${cls}" scope="col">${pct}</th>
        <th scope="col">${fmtNum(r.open)}</th>
        <th scope="col">${fmtNum(r.high)}</th>
        <th scope="col">${fmtNum(r.low)}</th>
        <th scope="col">${fmtNum(r.prevClose)}</th>
        <th scope="col">${vol}</th>
      </tr>
    `;
  };

  const renderNoteRow=()=>`
    <tr class="note-row">
      <td colspan="9" class="note-row">
        Copy rights reserved with <b>Jay</b> | Powered by <i>jayfromstockmarketsinindia.blogspot.com</i>
      </td>
    </tr>
  `;

  let otherRowsHTML='';
  otherRows.forEach((r,idx)=>{
    otherRowsHTML+=renderBodyRow(r);
    if((idx+1)%interval===0){otherRowsHTML+=renderNoteRow();}
  });

  return { indexRowHTML: indexRow?renderIndexHeaderRow(indexRow):'', otherRowsHTML };
}

/* ========= Route ========= */
app.get('/api/quotes', async (req,res)=>{
  try{
    const [niftyResults,bankResults]=await Promise.all([
      fetchIndex("NIFTY 50"),
      fetchIndex("NIFTY BANK")
    ]);

    // Dynamic refresh (IST)
    const now=new Date();
    const istNow=new Date(now.toLocaleString('en-US',{timeZone:'Asia/Kolkata'}));
    const hour=istNow.getHours(), minute=istNow.getMinutes(), day=istNow.getDay(); // 0=Sun
    let refreshRate=300000;
    const isMarketDay=day>=1&&day<=5;
    const isMarketHour=(hour>9||(hour===9&&minute>=15))&&(hour<15||(hour===15&&minute<=30));
    if(isMarketDay&&isMarketHour) refreshRate=10000; else if(!isMarketDay) refreshRate=3600000;

    const nifty=buildRows(niftyResults,"NIFTY 50",10);
    const bank =buildRows(bankResults ,"NIFTY BANK",6);

    const html=`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Nifty & Bank Nifty Quotes</title>
  <script>
    setTimeout(()=>location.reload(), ${refreshRate});
    let sortState={};

    function setHeaderArrow(th,dir){
      const arrowSpan=th.querySelector('.sort-arrow'); if(!arrowSpan) return;
      arrowSpan.innerHTML=dir==='asc' ? '<span class="hdr-arrow up"></span>' : '<span class="hdr-arrow down"></span>';
    }
    function clearHeaderArrows(table){ table.tHead.querySelectorAll('.sort-arrow').forEach(s=>s.innerHTML=''); }

    function createNoteRow(noteHtml){
      const tr=document.createElement('tr'); tr.className='note-row';
      const td=document.createElement('td'); td.colSpan=9; td.className='note-row';
      td.style.textAlign='center'; td.style.fontSize='13px'; td.style.color='#000000'; td.style.background='#eef7ff';
      td.innerHTML=noteHtml; tr.appendChild(td); return tr;
    }

    function sortTable(tableId,colIndex,numeric=false,key=null,setDefault=false){
      const table=document.getElementById(tableId);
      const headers=table.tHead.rows[0].cells;
      const tbody=table.tBodies[0];

      // Per-table intervals and note text
      const noteInterval = tableId==='niftyTable' ? 10 : (tableId==='bankTable' ? 6 : 0);
      const noteText = "Copy rights reserved with <b>Jay</b> | Powered by <i>jayfromstockmarketsinindia.blogspot.com</i>";

      // Extract data rows only (skip notes)
      const dataRows = Array.from(tbody.rows).filter(r=>!r.classList.contains('note-row'));

      // Determine direction
      let dir=setDefault?'asc':(sortState[tableId+key]==='asc'?'desc':'asc'); sortState[tableId+key]=dir;

      // Sort
      dataRows.sort((a,b)=>{
        let ax=a.cells[colIndex].innerText.trim(), bx=b.cells[colIndex].innerText.trim();
        let x=ax, y=bx;
        if(numeric){
          x=parseFloat(ax.replace('%','').replace(/,/g,'')); y=parseFloat(bx.replace('%','').replace(/,/g,''));
          if(isNaN(x)) x=-Infinity; if(isNaN(y)) y=-Infinity;
        }else{ x=ax.toLowerCase(); y=bx.toLowerCase(); }
        if(x<y) return dir==='asc'?-1:1;
        if(x>y) return dir==='asc'? 1:-1;
        return 0;
      });

      // Rebuild tbody: data + notes at intervals
      tbody.innerHTML='';
      dataRows.forEach((r,idx)=>{
        tbody.appendChild(r);
        if(noteInterval && ((idx+1)%noteInterval===0)){ tbody.appendChild(createNoteRow(noteText)); }
      });

      clearHeaderArrows(table); setHeaderArrow(headers[colIndex],dir);
    }

    function showTab(tabId){
      document.querySelectorAll('.tabcontent').forEach(el=>el.style.display='none');
      document.getElementById(tabId).style.display='block';
      document.querySelectorAll('.tablinks').forEach(el=>el.classList.remove('active'));
      document.getElementById(tabId+'Btn').classList.add('active');
    }

    window.onload=()=>{
      showTab('niftyTab');
      const nHeads=document.getElementById('niftyTable').tHead.rows[0].cells;
      const bHeads=document.getElementById('bankTable').tHead.rows[0].cells;
      for(let i=0;i<nHeads.length;i++){ setHeaderArrow(nHeads[i],'asc'); setHeaderArrow(bHeads[i],'asc'); }
    };
  </script>
  <style>
    body{margin:0;font-family:Arial,sans-serif;}
    .tab{overflow:hidden;border-bottom:1px solid #ccc;background:#f7f7f7;position:sticky;top:0;z-index:5;}
    .tab button{background:inherit;float:left;border:none;outline:none;cursor:pointer;padding:10px 16px;transition:.3s;font-size:16px;}
    .tab button:hover{background:#e9e9e9;} .tab button.active{background:#ddd;}
    .tabcontent{display:none;padding:10px;}
    table{border-collapse:collapse;width:100%;font-size:14px;background:#fff;}
    th,td{border:1px solid #ddd;padding:6px 10px;text-align:right;} td:first-child,th:first-child{text-align:left;}
    thead tr.header-row th{position:sticky;top:42px;z-index:7;background:#f4f4f4;cursor:pointer;}
    thead tr.index-row th{position:sticky;top:74px;z-index:6;background:#fff9c4;font-weight:bold;}
    tbody tr:nth-child(even){background:#f9f9f9;}
    .positive{color:green;font-weight:bold;} .negative{color:red;font-weight:bold;}
    .arrow{margin-left:6px;font-weight:bold;}
    .sort-arrow{display:inline-block;margin-left:6px;vertical-align:middle;}
    .hdr-arrow{display:inline-block;width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;}
    .hdr-arrow.up{border-bottom:8px solid #333;} .hdr-arrow.down{border-top:8px solid #999;}
    .note-row{text-align:center;font-size:12px;color:#006699;background:#eef7ff;}
  </style>
</head>
<body>
  <div class="tab">
    <button id="niftyTabBtn" class="tablinks" onclick="showTab('niftyTab')">Nifty 50</button>
    <button id="bankTabBtn"  class="tablinks" onclick="showTab('bankTab')">Bank Nifty</button>
  </div>

  <!-- NIFTY 50 -->
  <div id="niftyTab" class="tabcontent">
    <table id="niftyTable">
      <thead>
        <tr class="header-row">
          <th onclick="sortTable('niftyTable',0,false,'symbol')">Symbol <span class="sort-arrow"></span></th>
          <th onclick="sortTable('niftyTable',1,true,'cmp')">CMP <span class="sort-arrow"></span></th>
          <th onclick="sortTable('niftyTable',2,true,'change')">Change <span class="sort-arrow"></span></th>
          <th onclick="sortTable('niftyTable',3,true,'changePct')">Change % <span class="sort-arrow"></span></th>
          <th onclick="sortTable('niftyTable',4,true,'open')">Open <span class="sort-arrow"></span></th>
          <th onclick="sortTable('niftyTable',5,true,'high')">High <span class="sort-arrow"></span></th>
          <th onclick="sortTable('niftyTable',6,true,'low')">Low <span class="sort-arrow"></span></th>
          <th onclick="sortTable('niftyTable',7,true,'prevClose')">Prev Close <span class="sort-arrow"></span></th>
          <th onclick="sortTable('niftyTable',8,true,'volume')">Volume <span class="sort-arrow"></span></th>
        </tr>
        ${nifty.indexRowHTML}
      </thead>
      <tbody>
        ${nifty.otherRowsHTML}
      </tbody>
    </table>
  </div>

  <!-- BANK NIFTY -->
  <div id="bankTab" class="tabcontent">
    <table id="bankTable">
      <thead>
        <tr class="header-row">
          <th onclick="sortTable('bankTable',0,false,'symbol')">Symbol <span class="sort-arrow"></span></th>
          <th onclick="sortTable('bankTable',1,true,'cmp')">CMP <span class="sort-arrow"></span></th>
          <th onclick="sortTable('bankTable',2,true,'change')">Change <span class="sort-arrow"></span></th>
          <th onclick="sortTable('bankTable',3,true,'changePct')">Change % <span class="sort-arrow"></span></th>
          <th onclick="sortTable('bankTable',4,true,'open')">Open <span class="sort-arrow"></span></th>
          <th onclick="sortTable('bankTable',5,true,'high')">High <span class="sort-arrow"></span></th>
          <th onclick="sortTable('bankTable',6,true,'low')">Low <span class="sort-arrow"></span></th>
          <th onclick="sortTable('bankTable',7,true,'prevClose')">Prev Close <span class="sort-arrow"></span></th>
          <th onclick="sortTable('bankTable',8,true,'volume')">Volume <span class="sort-arrow"></span></th>
        </tr>
        ${bank.indexRowHTML}
      </thead>
      <tbody>
        ${bank.otherRowsHTML}
      </tbody>
    </table>
  </div>
</body>
</html>
`;
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.send(html);
  }catch(err){
    res.status(500).send(err.toString());
  }
});

/* ========= Server ========= */
const PORT=process.env.PORT||10000;
app.listen(PORT,()=>console.log(`Proxy running on http://localhost:${PORT}`));
