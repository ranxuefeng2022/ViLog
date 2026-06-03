// ==== Statistics Dialog ====

function showStatsDialog(){
  var loc=tabLocal[activeTab];
  if(!loc||!loc.loaded)return;
  var t=TABS[activeTab];
  var visCols=loc.visibleCols;
  var headerLabels=visCols?visCols.map(function(c){return t.headers[c]}):t.headers;

  document.getElementById('statsTitle').textContent='区间统计 — '+t.name;
  statsFrom.value=1;statsTo.value=totalRows;
  statsFrom.max=totalRows;statsTo.max=totalRows;

  statsSelectedCols.clear();
  statsCols.innerHTML='';

  DA.getStatsMeta(activeTab,visCols).then(function(res){
    if(!res||!res.success){statsCols.innerHTML='';return}
    var numCols=res.numCols;
    for(var i=0;i<numCols.length;i++){
      (function(ci){
        var tag=document.createElement('label');
        tag.className='stats-col-tag';
        tag.innerHTML='<input type="checkbox"><span>'+esc(headerLabels[ci])+'</span>';
        tag.addEventListener('click',function(e){
          e.preventDefault();
          var cb=tag.querySelector('input');
          cb.checked=!cb.checked;
          tag.classList.toggle('active',cb.checked);
          if(cb.checked) statsSelectedCols.add(ci); else statsSelectedCols.delete(ci);
        });
        statsCols.appendChild(tag);
      })(numCols[i]);
    }
    if(numCols.length===0) statsCols.innerHTML='<div style="padding:10px;color:#999">未检测到数值列</div>';
  }).catch(function(){statsCols.innerHTML=''});

  statsResult.innerHTML='<div class="stats-empty">请选择列并指定行号范围后点击计算</div>';
  statsOverlay.style.display='flex';
}

document.getElementById('statsClose').addEventListener('click',function(){statsOverlay.style.display='none'});
statsOverlay.addEventListener('click',function(e){if(e.target===statsOverlay)statsOverlay.style.display='none'});

document.getElementById('statsCalcBtn').addEventListener('click',function(){
  var loc=tabLocal[activeTab];
  if(!loc||!loc.loaded)return;
  var t=TABS[activeTab];
  var visCols=loc.visibleCols;
  var headerLabels=visCols?visCols.map(function(c){return t.headers[c]}):t.headers;

  var from=parseInt(statsFrom.value)||1;
  var to=parseInt(statsTo.value)||totalRows;
  from=Math.max(1,Math.min(totalRows,from));
  to=Math.max(from,Math.min(totalRows,to));
  statsFrom.value=from;statsTo.value=to;

  if(statsSelectedCols.size===0){statsResult.innerHTML='<div class="stats-empty">请先点击上方选择要统计的列</div>';return}

  var cols=Array.from(statsSelectedCols).sort(function(a,b){return a-b});
  statsResult.innerHTML='<div class="stats-empty">计算中...</div>';
  DA.calcStats(activeTab,visCols,cols,from-1,to-1).then(function(res){
    if(!res||!res.success){statsResult.innerHTML='<div class="stats-empty">计算失败</div>';return}
    renderStatsResult(headerLabels,cols,res.from,res.to,res.rangeLen,res.colResults);
  }).catch(function(err){
    statsResult.innerHTML='<div class="stats-empty">计算失败: '+err.message+'</div>';
  });
});


function renderStatsResult(headerLabels,cols,from,to,rangeLen,colResults){
  var html='<div style="margin-bottom:8px;font-size:13px;color:#666">行 '+from+' ~ '+to+' (共 '+rangeLen+' 行)</div>';
  html+='<table class="stats-table"><tr><th>统计项</th>';
  for(var i=0;i<cols.length;i++) html+='<th>'+esc(headerLabels[cols[i]])+'</th>';
  html+='</tr>';

  var rows=[
    {label:'样本数',key:'count'},
    {label:'最小值',key:'min'},
    {label:'最大值',key:'max'},
    {label:'平均值',key:'avg'},
    {label:'中位数',key:'median'},
    {label:'标准差',key:'stddev'},
    {label:'总变化量',key:'delta'},
    {label:'起始值',key:'startVal'},
    {label:'结束值',key:'endVal'},
    {label:'变化率/行',key:'rate'},
    {label:'最大单步变化',key:'maxStep'},
    {label:'P25',key:'p25'},
    {label:'P75',key:'p75'},
    {label:'P95',key:'p95'}
  ];

  for(var ri=0;ri<rows.length;ri++){
    var rl=rows[ri];
    html+='<tr><td class="st-label">'+rl.label+'</td>';
    for(var i=0;i<cols.length;i++){
      var r=colResults[cols[i]];
      var val=r?r[rl.key]:'-';
      var cls='stats-val-neutral';
      if((rl.label==='总变化量'||rl.label==='变化率/行')&&val!==null&&val!=='-'){
        cls=val>0?'stats-val-up':val<0?'stats-val-down':'stats-val-neutral';
      }
      html+='<td class="'+cls+'">'+(val!==null&&val!=='-'?fmtN(val):'-')+'</td>';
    }
    html+='</tr>';
  }

  // trend row
  html+='<tr><td class="st-label">趋势</td>';
  for(var i=0;i<cols.length;i++){
    var r=colResults[cols[i]];
    if(!r){html+='<td>-</td>';continue}
    var tc=r.trendUp>r.totalNum*0.6?'stats-val-up':r.trendDown>r.totalNum*0.6?'stats-val-down':'stats-val-neutral';
    html+='<td class="'+tc+'">'+r.trend+'</td>';
  }
  html+='</tr>';

  html+='</table>';
  statsResult.innerHTML=html;
}
