// ==== Selection: hitTest, mouse events, copy ====

// ---- Hit Testing ----
function hitTest(cx,cy){
  var st=container.scrollTop;
  var sl=container.scrollLeft;
  var fv=Math.floor(st/scrollScale);
  var subOff=(st/scrollScale-fv)*ROW_H;
  var row=fv+Math.floor((cy+subOff)/ROW_H);
  if(row<0||row>=totalRows)return null;
  if(cx<rnW)return{r:row,c:-1};
  if(!curColLeft)return null;
  for(var ci=0;ci<curColLeft.length;ci++){
    var x=rnW+curColLeft[ci]-sl;
    if(cx>=x&&cx<x+curColWidths[ci])return{r:row,c:ci};
  }
  return null;
}

function getNumCols(){return totalCols}

// ---- Canvas Mouse Events ----
canvas.addEventListener('mousedown',function(e){
  if(e.button!==0)return;
  var rect=canvas.getBoundingClientRect();
  var mx=e.clientX-rect.left;
  var my=e.clientY-rect.top;
  var info=hitTest(mx,my);
  if(!info)return;
  e.preventDefault();
  if(e.shiftKey&&sel.active){
    sel.endR=info.r;sel.endC=info.c;sel.active=true;
  }else if(info.c===-1){
    sel.anchorR=info.r;sel.anchorC=0;sel.endR=info.r;sel.endC=totalCols-1;sel.active=true;sel.dragging=true;
  }else{
    sel.anchorR=info.r;sel.anchorC=info.c;sel.endR=info.r;sel.endC=info.c;sel.active=true;sel.dragging=true;
  }
  drawCanvas();
});

canvas.addEventListener('mousemove',function(e){
  var rect=canvas.getBoundingClientRect();
  var mx=e.clientX-rect.left;
  var my=e.clientY-rect.top;
  var info=hitTest(mx,my);
  if(sel.dragging){
    if(info){
      sel.endR=info.r;sel.endC=Math.max(0,info.c);
      drawCanvas();
    }
    // Edge auto-scroll
    if(my<20)container.scrollTop=Math.max(0,container.scrollTop-Math.round(2*scrollScale));
    else if(my>rect.height-20)container.scrollTop+=Math.round(2*scrollScale);
  }
  // Hover tracking
  var newR=info?info.r:-1,newC=info?info.c:-1;
  if(newR!==hoverR||newC!==hoverC){
    hoverR=newR;hoverC=newC;
    canvas.style.cursor=info?'cell':'default';
    drawCanvas();
  }
  if(newR>=0&&window.App&&window.App.LinkPanel&&window.App.LinkPanel.isOpen()) window.App.LinkPanel.onHoverRow(newR);
  if(window.App&&window.App.RowDetail&&window.App.RowDetail.isOpen()) window.App.RowDetail.onHoverRow(newR);
});

canvas.addEventListener('mouseleave',function(){
  hoverR=-1;hoverC=-1;
  drawCanvas();
});
container.addEventListener('mouseenter',function(){
  if(window.App&&window.App.LinkPanel&&window.App.LinkPanel.isOpen()){
    if(hoverR>=0) window.App.LinkPanel.onHoverRow(hoverR);
  }
  if(window.App&&window.App.RowDetail&&window.App.RowDetail.isOpen()){
    if(hoverR>=0) window.App.RowDetail.onHoverRow(hoverR);
  }
});
document.addEventListener('mouseup',function(){if(sel.dragging){sel.dragging=false;drawCanvas()}});
var _lastMouseY=-1;
canvas.addEventListener('mousemove',function(e){var r=canvas.getBoundingClientRect();_lastMouseY=e.clientY-r.top});
canvas.addEventListener('mouseleave',function(){_lastMouseY=-1});
container.addEventListener('scroll',function(){
  if(typeof canvas!=='undefined'&&_lastMouseY>=0){
    var rect=canvas.getBoundingClientRect();
    var cy=_lastMouseY;
    var st=container.scrollTop;
    var fv=Math.floor(st/scrollScale);
    var subOff=(st/scrollScale-fv)*ROW_H;
    var row=fv+Math.floor((cy+subOff)/ROW_H);
    if(row>=0&&row<totalRows){
      if(row!==hoverR){
        hoverR=row;hoverC=-1;
        drawCanvas();
      }
      if(window.App&&window.App.LinkPanel&&window.App.LinkPanel.isOpen()) window.App.LinkPanel.onHoverRow(row);
      if(window.App&&window.App.RowDetail&&window.App.RowDetail.isOpen()) window.App.RowDetail.onHoverRow(row);
    }
  }
});

// ---- Cell Selection Helpers ----
function selNormalize(){
  return{r0:Math.min(sel.anchorR,sel.endR),r1:Math.max(sel.anchorR,sel.endR),c0:Math.min(sel.anchorC,sel.endC),c1:Math.max(sel.anchorC,sel.endC)};
}
function selContains(r,c){
  if(!sel.active)return false;
  var n=selNormalize();
  return r>=n.r0&&r<=n.r1&&c>=n.c0&&c<=n.c1;
}
function selIsAnchor(r,c){return sel.active&&r===sel.anchorR&&c===sel.anchorC}
function clearSel(){sel.anchorR=-1;sel.anchorC=-1;sel.endR=-1;sel.endC=-1;sel.active=false;sel.dragging=false;drawCanvas()}

function copySelection(){
  if(!sel.active)return;
  var loc=tabLocal[activeTab];
  if(!loc||!loc.loaded||!loc.rows)return;
  var rows=loc.rows;
  var visCols=loc.visibleCols;
  var n=selNormalize();
  var lines=[];
  for(var r=n.r0;r<=n.r1;r++){
    var rd=rows[r];
    var cells=[];
    for(var c=n.c0;c<=n.c1;c++){
      var v=visCols?rd[visCols[c]]:rd[c];
      cells.push(v===undefined||v===null?'':String(v));
    }
    lines.push(cells.join('\\t'));
  }
  var text=lines.join('\\n');
  var textarea=document.createElement('textarea');
  textarea.value=text;
  textarea.style.cssText='position:fixed;left:-9999px;top:-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

document.addEventListener('keydown',function(e){
  if(e.ctrlKey&&e.key==='c'&&sel.active){
    e.preventDefault();copySelection();
  }else if(e.ctrlKey&&e.key==='a'){
    e.preventDefault();
    var loc=tabLocal[activeTab];
    if(!loc||!loc.loaded||!loc.rows)return;
    sel.anchorR=0;sel.anchorC=0;sel.endR=loc.rows.length-1;sel.endC=totalCols-1;sel.active=true;
    drawCanvas();
  }else if(e.key==='Escape'){
    clearSel();
  }else if(e.ctrlKey&&e.key==='l'){
    e.preventDefault();
    if(window.App&&window.App.LinkPanel) window.App.LinkPanel.toggle();
  }
});
