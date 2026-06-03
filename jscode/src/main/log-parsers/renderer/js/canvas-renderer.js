// ==== Canvas Renderer: draw, scroll, resize ====

// ---- Canvas Rendering ----
function updateCanvasSize(){
  var dpr=window.devicePixelRatio||1;
  var cw=container.clientWidth;
  var ch=container.clientHeight;
  if(cw===0||ch===0)return;
  var bw=Math.ceil(cw*dpr);
  var bh=Math.ceil(ch*dpr);
  if(canvas.width!==bw||canvas.height!==bh){
    canvas.width=bw;canvas.height=bh;
    canvas.style.width=cw+'px';canvas.style.height=ch+'px';
  }
}

function drawCanvas(){
  var loc=tabLocal[activeTab];
  if(!loc||!loc.loaded)return;
  var rows=loc.rows;
  if(!rows)return;
  var visCols=loc.visibleCols;
  var len=totalRows;
  if(len===0)return;
  var dpr=window.devicePixelRatio||1;
  var cw=container.clientWidth;
  var ch=container.clientHeight;
  if(cw===0||ch===0)return;

  // Ensure canvas backing store matches
  var bw=Math.ceil(cw*dpr);
  var bh=Math.ceil(ch*dpr);
  if(canvas.width!==bw||canvas.height!==bh){
    canvas.width=bw;canvas.height=bh;
    canvas.style.width=cw+'px';canvas.style.height=ch+'px';
  }

  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,cw,ch);

  var st=container.scrollTop;
  var sl=container.scrollLeft;
  var fv=Math.floor(st/scrollScale);
  var subOff=Math.round((st/scrollScale-fv)*ROW_H);
  var vc=Math.ceil(ch/ROW_H)+1;
  // Clamp: prevent scrolling past the last row
  if(fv+vc>len){fv=Math.max(0,len-vc+1);subOff=0}
  var firstRow=Math.max(0,fv-BUFFER);
  var lastRow=Math.min(len,fv+vc+BUFFER);
  if(firstRow>=lastRow)return;

  // Find visible column range (horizontal culling)
  var firstCol=0,lastCol=totalCols;
  if(curColLeft&&curColWidths){
    var sr=sl+cw;
    while(firstCol<curColLeft.length&&(rnW+curColLeft[firstCol]+curColWidths[firstCol])<sl)firstCol++;
    while(lastCol>0&&(rnW+curColLeft[lastCol-1])>sr)lastCol--;
    if(firstCol>0)firstCol--;
    if(lastCol<curColWidths.length)lastCol++;
  }

  var ms=cachedMatchSet;
  var topY=(firstRow-fv)*ROW_H-subOff;
  var botY=(lastRow-fv)*ROW_H-subOff;

  // Row number area background (drawn first, data area clips to right of it)
  ctx.fillStyle='#FAFAFA';
  ctx.fillRect(0,0,rnW,ch);
  // Data area background
  ctx.fillStyle='#FFFFFF';
  ctx.fillRect(rnW,0,cw-rnW,ch);

  ctx.font=FONT;
  ctx.textBaseline='middle';

  // Clip data cells to the data area (right of row number column)
  ctx.save();
  ctx.beginPath();
  ctx.rect(rnW,0,cw-rnW,ch);
  ctx.clip();

  for(var ri=firstRow;ri<lastRow&&ri<len;ri++){
    var y=(ri-fv)*ROW_H-subOff;
    var isCurrentMatch=ms&&ms.has(ri)&&ri===srMatches[srCurrent];
    var isSearchMatch=ms&&ms.has(ri)&&!isCurrentMatch;

    // Row background
    if(isCurrentMatch) ctx.fillStyle='rgba(255,204,0,0.28)';
    else if(isSearchMatch) ctx.fillStyle='rgba(255,204,0,0.12)';
    else if(ri===hoverR) ctx.fillStyle='#F5F5F7';
    else ctx.fillStyle='#FFFFFF';
    ctx.fillRect(rnW,y,cw-rnW,ROW_H);

    // Data cells
    var rd=rows[ri];
    if(!rd)continue; // row not loaded yet
    for(var ci=firstCol;ci<lastCol&&ci<totalCols;ci++){
      var actualCol=visCols?visCols[ci]:ci;
      var cx=rnW+curColLeft[ci]-sl;
      var cw_col=curColWidths[ci];
      if(cx+cw_col<=rnW||cx>=cw)continue;

      // Cell selection highlight
      if(sel.active){
        var isAnchor=selIsAnchor(ri,ci);
        if(isAnchor||selContains(ri,ci)){
          ctx.fillStyle='rgba(0,122,255,0.08)';
          ctx.fillRect(cx,y,cw_col,ROW_H);
        }
      }

      // Cell text
      var val=rd[actualCol];
      if(val===undefined||val===null||val==='')continue;
      var keys=TABS[activeTab].keys;
      var text;
      if(keys&&keys[actualCol]==='ts_raw'){
        text=(Number(val)/1000000).toFixed(6);
      }else{
        text=String(val);
      }
      var maxW=cw_col-20;
      if(maxW<=0)continue;
      ctx.fillStyle='#1D1D1F';
      ctx.textAlign='center';
      var m=ctx.measureText(text);
      if(m.width<=maxW){ctx.fillText(text,cx+cw_col/2,y+ROW_H/2)}
      else{ctx.fillText(truncateText(text,maxW),cx+cw_col/2,y+ROW_H/2)}
    }
  }

  // Grid lines (inside clip region — only drawn in data area)
  ctx.strokeStyle='rgba(0,0,0,0.08)';
  ctx.lineWidth=0.5;
  // Horizontal lines
  ctx.beginPath();
  for(var ri=firstRow;ri<=lastRow&&ri<=len;ri++){
    var ly=(ri-fv)*ROW_H-subOff+0.25;
    ctx.moveTo(rnW,ly);ctx.lineTo(cw,ly);
  }
  ctx.stroke();
  // Vertical lines
  if(curColLeft&&curColWidths){
    ctx.beginPath();
    for(var ci=firstCol;ci<lastCol&&ci<totalCols;ci++){
      var sx=rnW+curColLeft[ci]+curColWidths[ci]-sl+0.25;
      if(sx>rnW&&sx<cw){ctx.moveTo(sx,topY);ctx.lineTo(sx,botY)}
    }
    ctx.stroke();
  }

  ctx.restore(); // remove clip

  // Row number column border & text
  ctx.strokeStyle='rgba(0,0,0,0.08)';
  ctx.lineWidth=0.5;
  ctx.beginPath();
  ctx.moveTo(rnW+0.25,0);ctx.lineTo(rnW+0.25,ch);
  ctx.stroke();
  ctx.textAlign='center';
  for(var ri2=firstRow;ri2<lastRow&&ri2<len;ri2++){
    ctx.fillStyle='#C7C7CC';
    ctx.font=RN_FONT;
    ctx.fillText(String(ri2+1),rnW/2,(ri2-fv)*ROW_H-subOff+ROW_H/2);
  }
  ctx.font=FONT;
}

// ---- Scroll Handling ----
var _scrollLoadTimer=null;
container.addEventListener('scroll',function(){
  cachedST=container.scrollTop;cachedVH=container.clientHeight;
  if(drawRafId)return;
  drawRafId=requestAnimationFrame(function(){
    drawRafId=0;
    var sl=container.scrollLeft;
    if(sl!==cachedSL){
      cachedSL=sl;
      headerRow.style.transform='translateX('+(-sl)+'px)';
      var rnH=headerRow.children[0];
      if(rnH)rnH.style.transform='translateX('+sl+'px)';
    }
    updateCanvasSize();
    drawCanvas();
    // Debounced chunk loading — skip intermediate chunks during fast scroll
    if(typeof ensureRows==='function'){
      if(_scrollLoadTimer)clearTimeout(_scrollLoadTimer);
      _scrollLoadTimer=setTimeout(function(){
        _scrollLoadTimer=null;
        var st2=container.scrollTop;
        var ch2=container.clientHeight;
        var fv2=Math.floor(st2/scrollScale);
        var vc2=Math.ceil(ch2/ROW_H);
        ensureRows(activeTab,Math.max(0,fv2-BUFFER),Math.min(totalRows,fv2+vc2+BUFFER));
      },100);
    }
  });
},{passive:true});

// ---- Alt+Wheel Horizontal Scroll ----
container.addEventListener('wheel',function(e){
  if(!e.altKey)return;
  e.preventDefault();
  var a=Math.abs(e.deltaY);
  var px=a<=4?20:a<=20?40:a<=60?80:a<=120?130:200;
  altTarget+=(e.deltaY>0?px:-px);
  var maxScroll=container.scrollWidth-container.clientWidth;
  altTarget=Math.max(0,Math.min(maxScroll,altTarget));
  if(!altRaf) altRaf=requestAnimationFrame(function step(){
    var diff=altTarget-altCurrent;
    if(Math.abs(diff)<0.5){altCurrent=altTarget;container.scrollLeft=altCurrent;altRaf=0;return}
    altCurrent+=diff*0.3;
    container.scrollLeft=altCurrent;
    altRaf=requestAnimationFrame(step);
  });
},{passive:false});

// ---- Resize Handling ----
if(window.ResizeObserver){
  new ResizeObserver(function(){
    updateCanvasSize();drawCanvas();
  }).observe(container);
}

// ---- Proximity scrollbar: show only when mouse is near the edge ----
var PROXIMITY = 30;
container.addEventListener('mousemove', function(e){
  var rect = container.getBoundingClientRect();
  var nearRight = (rect.right - e.clientX) < PROXIMITY;
  var nearBottom = (rect.bottom - e.clientY) < PROXIMITY;
  if (nearRight) container.classList.add('near-scrollbar-v');
  else container.classList.remove('near-scrollbar-v');
  if (nearBottom) container.classList.add('near-scrollbar-h');
  else container.classList.remove('near-scrollbar-h');
});
container.addEventListener('mouseleave', function(){
  container.classList.remove('near-scrollbar-v', 'near-scrollbar-h');
});
