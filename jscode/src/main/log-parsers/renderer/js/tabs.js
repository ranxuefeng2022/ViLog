// ==== Tabs: dropdown, load, switch, render, on-demand chunk loading with LRU ====

function buildTabButtons(){
  tabDdMenu.innerHTML='';
  TABS.forEach(function(t,i){
    var item=document.createElement('div');
    item.className='tab-dd-item'+(i===0?' active':'');
    item.setAttribute('data-tab',i);
    item.innerHTML=esc(t.name)+'<span class="tab-badge">'+t.count+'</span>';
    item.addEventListener('click',function(){
      switchTab(parseInt(this.getAttribute('data-tab')));
      hideDdMenu();
    });
    tabDdMenu.appendChild(item);
  });
  if(TABS.length>0) tabDdLabel.textContent=TABS[0].name;
}
var ddOpen=false;
function showDdMenu(){
  var rect=tabDdBtn.getBoundingClientRect();
  tabDdMenu.style.left=rect.left+'px';
  tabDdMenu.style.top=(rect.bottom+6)+'px';
  tabDdMenu.style.display='block';
  ddOpen=true;
}
function hideDdMenu(){
  tabDdMenu.style.display='none';
  ddOpen=false;
}
tabDdBtn.addEventListener('click',function(e){
  e.preventDefault();
  e.stopPropagation();
  if(ddOpen){hideDdMenu();return}
  showDdMenu();
});
document.addEventListener('mousedown',function(e){
  if(ddOpen&&!tabDd.contains(e.target)) hideDdMenu();
});

// Wheel on tab label to switch tabs (no wrap)
tabDdBtn.addEventListener('wheel',function(e){
  if(TABS.length<=1)return;
  e.preventDefault();
  e.stopPropagation();
  var nextIdx=e.deltaY>0?activeTab+1:activeTab-1;
  if(nextIdx<0||nextIdx>=TABS.length)return;
  switchTab(nextIdx);
},{passive:false});

// ---- On-demand chunk loading with LRU eviction ----
var MAX_LOADED_CHUNKS=20; // ~60K rows max in memory per tab

function requestChunk(tabIdx,chunkIdx){
  var loc=tabLocal[tabIdx];
  if(!loc||loc.chunks[chunkIdx])return;
  loc.chunks[chunkIdx]=true;
  var from=chunkIdx*CHUNK_SIZE;
  var count=Math.min(CHUNK_SIZE,TABS[tabIdx].count-from);
  if(count<=0){delete loc.chunks[chunkIdx];return}
  console.log('[chunk-load] tab='+tabIdx+' chunk='+chunkIdx+' rows='+from+'~'+(from+count-1));
  window.logAnalysis.getRows(tabIdx,from,count).then(function(res){
    if(!res||!res.success){delete loc.chunks[chunkIdx];return}
    var returnedRows=res.rows;
    var returnedFrom=res.from;
    for(var i=0;i<returnedRows.length;i++){
      loc.rows[returnedFrom+i]=returnedRows[i];
    }
    evictDistantChunks(tabIdx,chunkIdx);
    if(tabIdx===activeTab){
      loadingMask.style.display='none';
      if(!autoFitColumns(tabIdx)){
        updateCanvasSize();
        drawCanvas();
      }
    }
  }).catch(function(){
    delete loc.chunks[chunkIdx];
  });
}

function evictDistantChunks(tabIdx,keepChunk){
  var loc=tabLocal[tabIdx];
  if(!loc||loc._full)return;
  var loaded=Object.keys(loc.chunks).map(Number);
  if(loaded.length<=MAX_LOADED_CHUNKS)return;
  // Sort by distance from keepChunk (furthest first)
  loaded.sort(function(a,b){return Math.abs(b-keepChunk)-Math.abs(a-keepChunk)});
  while(loaded.length>MAX_LOADED_CHUNKS){
    var evict=loaded.shift();
    delete loc.chunks[evict];
    var from=evict*CHUNK_SIZE;
    var to=Math.min(from+CHUNK_SIZE,TABS[tabIdx].count);
    for(var i=from;i<to;i++) delete loc.rows[i];
  }
}

function ensureRows(tabIdx,firstRow,lastRow){
  var loc=tabLocal[tabIdx];
  if(!loc)return;
  if(loc._full)return;
  var firstChunk=Math.floor(firstRow/CHUNK_SIZE);
  var lastChunk=Math.floor(lastRow/CHUNK_SIZE);
  // Prefetch one chunk ahead
  if(lastChunk+1<=Math.floor((TABS[tabIdx].count-1)/CHUNK_SIZE)) lastChunk++;
  for(var c=firstChunk;c<=lastChunk;c++){
    if(!loc.chunks[c]) requestChunk(tabIdx,c);
  }
}

function loadTab(idx){
  var loc=tabLocal[idx];
  loc.loaded=true;
  if(idx===activeTab){
    renderTab(idx);
    ensureRows(idx,0,Math.min(CHUNK_SIZE-1,TABS[idx].count-1));
  }
}

function switchTab(idx){
  if(idx===activeTab&&tabLocal[activeTab].loaded)return;
  clearSel();
  scrollTops[activeTab]=container.scrollTop;
  scrollLefts[activeTab]=container.scrollLeft;
  // Release old tab's row data
  if(!DA.isEmbedded){
    var oldLoc=tabLocal[activeTab];
    if(oldLoc&&!oldLoc._full){oldLoc.rows=[];oldLoc.chunks={}}
    // Release chart data from previous tab
    chartConfigs=[];
    chartTimeData=null;chartFileData=null;
  }
  activeTab=idx;
  tabDdLabel.textContent=TABS[idx].name;
  var items=tabDdMenu.querySelectorAll('.tab-dd-item');
  for(var i=0;i<items.length;i++) items[i].className='tab-dd-item'+(i===idx?' active':'');
  // Always render and load — metadata is already available from getTabs()
  var loc=tabLocal[idx];
  loc.loaded=true;
  renderTab(idx);
  ensureRows(idx,0,Math.min(CHUNK_SIZE-1,TABS[idx].count-1));
}

// ---- Auto-fit column widths based on content ----
function autoFitColumns(tabIdx){
  var loc=tabLocal[tabIdx];
  if(!loc||loc._autoFitted)return false;
  var rows=loc.rows;
  if(!rows)return false;
  var hasData=false;
  for(var i=0;i<Math.min(200,rows.length);i++){if(rows[i]){hasData=true;break}}
  if(!hasData)return false;
  var t=TABS[tabIdx];
  var visCols=loc.visibleCols;
  var headers=visCols?visCols.map(function(c){return t.headers[c]}):t.headers;
  var tc=document.createElement('canvas');
  var tctx=tc.getContext('2d');
  tctx.font=FONT;
  var newWidths=[];
  for(var ci=0;ci<headers.length;ci++){
    var maxW=tctx.measureText(headers[ci]).width;
    var actualCol=visCols?visCols[ci]:ci;
    var sampled=0;
    for(var ri=0;ri<rows.length&&sampled<200;ri++){
      var rd=rows[ri];
      if(!rd)continue;
      sampled++;
      var val=rd[actualCol];
      if(val!==undefined&&val!==null&&val!==''){
        var w=tctx.measureText(String(val)).width;
        if(w>maxW)maxW=w;
      }
    }
    newWidths.push(Math.max(80,Math.min(600,Math.ceil(maxW+40))));
  }
  if(visCols){for(var i=0;i<visCols.length;i++)t.colWidths[visCols[i]]=newWidths[i]}
  else{t.colWidths=newWidths}
  loc._autoFitted=true;
  if(tabIdx===activeTab){
    var colWidths2=visCols?visCols.map(function(c){return t.colWidths[c]}):t.colWidths;
    curColWidths=colWidths2.slice();
    curColLeft=[];var cx=0;
    for(var ci2=0;ci2<colWidths2.length;ci2++){curColLeft.push(cx);cx+=colWidths2[ci2]}
    dataW=cx;
    totalW=Math.max(dataW+rnW,container.parentElement.clientWidth||container.parentElement.offsetWidth);
    spacer.style.width=totalW+'px';
    headerRow.style.gridTemplateColumns=rnW+'px '+colWidths2.join('px ')+'px';
    headerRow.style.width=totalW+'px';
    updateCanvasSize();
    drawCanvas();
  }
  return true;
}

function renderTab(idx){
  var t=TABS[idx];
  var loc=tabLocal[idx];
  var visCols=loc.visibleCols;
  var headers=visCols?visCols.map(function(c){return t.headers[c]}):t.headers;
  autoFitColumns(idx);
  var colWidths=visCols?visCols.map(function(c){return t.colWidths[c]}):t.colWidths;
  var tKeys=t.keys||[];
  rnW=Math.max(50,String(t.count).length*9+32);
  if(rnCover)rnCover.style.width=rnW+'px';
  dataW=0;for(var i=0;i<colWidths.length;i++)dataW+=colWidths[i];
  totalW=Math.max(dataW+rnW,container.parentElement.clientWidth||container.parentElement.offsetWidth);
  totalH=t.count*ROW_H;
  totalCols=headers.length;
  totalRows=t.count;
  scrollScale=totalH>MAX_SCROLL_PX?MAX_SCROLL_PX/t.count:ROW_H;
  curColWidths=colWidths.slice();
  curColLeft=[];var cx=0;
  for(var ci=0;ci<colWidths.length;ci++){curColLeft.push(cx);cx+=colWidths[ci]}

  // Build header row (DOM)
  headerRow.style.display='grid';
  headerRow.style.gridTemplateColumns=rnW+'px '+colWidths.join('px ')+'px';
  headerRow.style.width=totalW+'px';
  headerRow.style.transform='translateX(0px)';
  var rnH=headerRow.children[0];
  if(rnH) rnH.style.transform='translateX(0px)';
  var hh='<div class="hcell" style="color:#C7C7CC;font-size:11px;font-weight:400;position:sticky;left:0;z-index:3;background:#FAFAFA;box-shadow:2px 0 4px rgba(0,0,0,0.06)">#</div>';
  for(var i=0;i<headers.length;i++){
    var key=visCols?tKeys[visCols[i]]:tKeys[i];
    hh+='<div class="hcell"'+(key?' title="'+esc(key)+'"':'')+'>'+esc(headers[i])+'</div>';
  }
  headerRow.innerHTML=hh;

  // Set spacer dimensions to create scrollbars
  spacer.style.width=totalW+'px';
  spacer.style.height=(scrollScale===ROW_H?totalH:Math.ceil(totalRows*scrollScale)+(container.clientHeight||800))+'px';

  // Reset
  cachedST=0;cachedVH=container.clientHeight;cachedSL=0;
  srMatches=[];srCurrent=-1;srTerm='';cachedMatchSet=null;
  if(searchStatusEl)searchStatusEl.textContent='';
  if(searchInput)searchInput.value='';
  hoverR=-1;hoverC=-1;

  loadingMask.style.display='none';
  container.scrollTop=scrollTops[idx]||0;
  container.scrollLeft=scrollLefts[idx]||0;
  updateCanvasSize();
  drawCanvas();
}
