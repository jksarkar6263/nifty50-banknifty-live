const express = require('express');
const app = express();

/* ========= Helpers ========= */
function fmtNum(v) {
  return (typeof v === 'number' && Number.isFinite(v)) ? v.toFixed(2) : '-';
}
function arrowFor(change) {
  if (typeof change !== 'number' || !Number.isFinite(change)) return '';
  return change > 0 ? '↑' : (change < 0 ? '↓' : '');
}
function clsFor(change) {
  if (typeof change !== 'number' || !Number.isFinite(change)) return '';
  return change > 0 ? 'positive' : (change < 0 ? 'negative' : '');
}

/* ========= Data fetch (NSE India) ========= */
async function fetchIndex(indexName) {
  const url = `https://www.nseindia.com/api/equity-stockIndices?index=${encodeURIComponent(indexName)}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "application/json",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": "https://www.nseindia.com/"
    }
  });
  if (!res.ok) throw new Error(`NSE API error: ${res.status}`);
  const json = await res.json();
  if (!json || !Array.isArray(json.data)) throw new Error("NSE API error: invalid response");

  return json.data.map(s => ({
    symbol: s.symbol,
    cmp: s.lastPrice,
    change: s.change,
    changePct: s.pChange,
    open: s.open,
    high: s.dayHigh,
    low: s.dayLow,
    prevClose: s.previousClose,
    volume: s.totalTradedVolume
  }));
}

/* ========= Builders ========= */
function buildRows(rows, indexName) {
  const indexRow = rows.find(r => r.symbol === indexName);
  const otherRows = rows
    .filter(r => r.symbol !== indexName)
    .sort((a, b) => a.symbol.localeCompare(b.symbol)); // default A→Z

  const renderBodyRow = (r) => {
    const cls = clsFor(r.change);
    const arr = arrowFor(r.change);
    const changePctDisplay = (typeof r.changePct === 'number' && Number.isFinite(r.changePct))
      ? `${r.changePct.toFixed(2)}%` : '-';
    const vol = (typeof r.volume === 'number' && Number.isFinite(r.volume))
      ? r.volume.toLocaleString('en-IN') : '-';
    return `
      <tr>
        <td class="${cls}">${r.symbol} <span class="arrow">${arr}</span></td>
        <td class="${cls}">${fmtNum(r.cmp)}</td>
        <td class="${cls}">${fmtNum(r.change)}</td>
        <td class="${cls}">${changePctDisplay} <span class="arrow">${arr}</span></td>
        <td>${fmtNum(r.open)}</td>
        <td>${fmtNum(r.high)}</td>
        <td>${fmtNum(r.low)}</td>
        <td>${fmtNum(r.prevClose)}</td>
        <td>${vol}</td>
      </tr>
    `;
  };

  const renderIndexHeaderRow = (r) => {
    const cls = clsFor(r.change);
    const changePctDisplay = (typeof r.changePct === 'number' && Number.isFinite(r.changePct))
      ? `${r.changePct.toFixed(2)}%` : '-';
    const vol = (typeof r.volume === 'number' && Number.isFinite(r.volume))
      ? r.volume.toLocaleString('en-IN') : '-';
    return `
      <tr class="index-row">
        <th class="${cls}" scope="colgroup">${r.symbol}</th>
        <th class="${cls}" scope="col">${fmtNum(r.cmp)}</th>
        <th class="${cls}" scope="col">${fmtNum(r.change)}</th>
        <th class="${cls}" scope="col">${changePctDisplay}</th>
        <th scope="col">${fmtNum(r.open)}</th>
        <th scope="col">${fmtNum(r.high)}</th>
        <th scope="col">${fmtNum(r.low)}</th>
        <th scope="col">${fmtNum(r.prevClose)}</th>
        <th scope="col">${vol}</th>
      </tr>
    `;
  };

  return {
    indexRowHTML: indexRow ? renderIndexHeaderRow(indexRow) : '',
    otherRowsHTML: otherRows.map(renderBodyRow).join('')
  };
}

/* ========= Route ========= */
app.get('/api/quotes', async (req, res) => {
  try {
    const [niftyResults, bankResults] = await Promise.all([
      fetchIndex("NIFTY 50"),
      fetchIndex("NIFTY BANK")
    ]);

    // Dynamic refresh (IST)
    const now = new Date();
    const istNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const hour = istNow.getHours();
    const minute = istNow.getMinutes();
    const day = istNow.getDay(); // 0=Sun, 6=Sat
    let refreshRate = 300000; // default 5 min
    const isMarketDay = day >= 1 && day <= 5;
    const isMarketHour = (hour > 9 || (hour === 9 && minute >= 15)) && (hour < 15 || (hour === 15 && minute <= 30));
    if (isMarketDay && isMarketHour) refreshRate = 10000; // 10s
    else if (!isMarketDay) refreshRate = 3600000; // 1h

    const nifty = buildRows(niftyResults, "NIFTY 50");
    const bank  = buildRows(bankResults, "NIFTY BANK");

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Nifty & Bank Nifty Quotes</title>
  <script>
    setTimeout(() => location.reload(), ${refreshRate});
    let sortState = {};

    function setHeaderArrow(th, dir) {
      const arrowSpan = th.querySelector('.sort-arrow');
      if (!arrowSpan) return;
      arrowSpan.innerHTML = dir === 'asc'
        ? '<span class="hdr-arrow up"></span>'
        : '<span class="hdr-arrow down"></span>';
    }
    function clearHeaderArrows(table) {
      table.tHead.querySelectorAll('.sort-arrow').forEach(s => s.innerHTML = '');
    }

    // Sort only tbody rows; thead (including index row) stays sticky
    function sortTable(tableId, colIndex, numeric=false, key=null, setDefault=false) {
      const table = document.getElementById(tableId);
      const headers = table.tHead.rows[0].cells; // header titles row
      const tbody = table.tBodies[0];
      const rows = Array.from(tbody.rows);

      let dir;
      if (setDefault) {
        dir = 'asc';
      } else {
        dir = sortState[tableId+key] === 'asc' ? 'desc' : 'asc';
      }
      sortState[tableId+key] = dir;

      rows.sort((a, b) => {
        let ax = a.cells[colIndex].innerText.trim();
        let bx = b.cells[colIndex].innerText.trim();
        let x = ax, y = bx;
        if (numeric) {
          x = parseFloat(ax.replace('%','').replace(/,/g,''));
          y = parseFloat(bx.replace('%','').replace(/,/g,''));
          if (isNaN(x)) x = -Infinity;
          if (isNaN(y)) y = -Infinity;
        } else {
          x = ax.toLowerCase();
          y = bx.toLowerCase();
        }
        if (x < y) return dir === 'asc' ? -1 : 1;
        if (x > y) return dir === 'asc' ? 1 : -1;
        return 0;
      });

      const frag = document.createDocumentFragment();
      rows.forEach(r => frag.appendChild(r));
      tbody.innerHTML = '';
      tbody.appendChild(frag);

      clearHeaderArrows(table);
      setHeaderArrow(headers[colIndex], dir);
    }

    function showTab(tabId) {
      document.querySelectorAll('.tabcontent').forEach(el => el.style.display = 'none');
      document.getElementById(tabId).style.display = 'block';
      document.querySelectorAll('.tablinks').forEach(el => el.classList.remove('active'));
      document.getElementById(tabId+'Btn').classList.add('active');
    }

    window.onload = () => {
      showTab('niftyTab');
      // Alphabetical default preserved via server-side build; no auto sort here.
      const niftyHeaders = document.getElementById('niftyTable').tHead.rows[0].cells;
      const bankHeaders  = document.getElementById('bankTable').tHead.rows[0].cells;
      for (let i = 0; i < niftyHeaders.length; i++) {
        setHeaderArrow(niftyHeaders[i], 'asc');
        setHeaderArrow(bankHeaders[i], 'asc');
      }
    };
  </script>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; }

    /* Tabs */
    .tab { overflow: hidden; border-bottom: 1px solid #ccc; background-color: #f7f7f7; position: sticky; top: 0; z-index: 5; }
    .tab button { background-color: inherit; float: left; border: none; outline: none; cursor: pointer; padding: 10px 16px; transition: 0.3s; font-size: 16px; }
    .tab button:hover { background-color: #e9e9e9; }
    .tab button.active { background-color: #ddd; }
    .tabcontent { display: none; padding: 10px; }

    /* Table */
    table { border-collapse: collapse; width: 100%; font-size: 14px; background: #fff; }
    th, td { border: 1px solid #ddd; padding: 6px 10px; text-align: right; }
    td:first-child, th:first-child { text-align: left; }

    /* Sticky header titles row */
    thead tr.header-row th {
      position: sticky;
      top: 42px; /* below tabs */
      z-index: 7;
      background-color: #f4f4f4;
      cursor: pointer;
    }

    /* Sticky index row just below header */
    thead tr.index-row th {
      position: sticky;
      top: 74px; /* adjust if header row height changes */
      z-index: 6;
      background-color: #fff9c4;
      font-weight: bold;
    }

    /* Alternating body rows */
    tbody tr:nth-child(even) { background-color: #f9f9f9; }

    /* Gain/loss colors */
    .positive { color: green; font-weight: bold; }
    .negative { color: red; font-weight: bold; }

    /* Body cell arrows */
    .arrow { margin-left: 6px; font-weight: bold; }

    /* Header sort arrows (triangles) */
    .sort-arrow { display: inline-block; margin-left: 6px; vertical-align: middle; }
    .hdr-arrow { display: inline-block; width: 0; height: 0; border-left: 6px solid transparent; border-right: 6px solid transparent; }
    .hdr-arrow.up { border-bottom: 8px solid #333; }  /* black */
    .hdr-arrow.down { border-top: 8px solid #999; }   /* light grey */
  </style>
</head>
<body>
  <div class="tab">
    <button id="niftyTabBtn" class="tablinks" onclick="showTab('niftyTab')">Nifty 50</button>
    <button id="bankTabBtn" class="tablinks" onclick="showTab('bankTab')">Bank Nifty</button>
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

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    res.status(500).send(err.toString());
  }
});

/* ========= Server ========= */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy running on http://localhost:${PORT}`));
