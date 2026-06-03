// ==== Utils: esc, fmtN, truncateText, makeDraggable ====
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}

// Binary-search text truncation (O(log n) measureText calls)
var _truncCanvas=document.createElement('canvas');
_truncCanvas.width=1;_truncCanvas.height=1;
var _truncCtx=_truncCanvas.getContext('2d');
function truncateText(text,maxW){
  _truncCtx.font=FONT;
  var lo=0,hi=text.length;
  while(lo<hi){
    var mid=(lo+hi+1)>>1;
    if(_truncCtx.measureText(text.slice(0,mid)+'…').width>maxW)hi=mid-1;
    else lo=mid;
  }
  return lo>0?text.slice(0,lo)+'…':'';
}

function fmtN(n){return Number.isInteger(n)?String(n):n.toFixed(2)}

// ==== Dialog Drag ====
function makeDraggable(overlayId,dialogSelector,titleSelector){
  var overlay=document.getElementById(overlayId);
  if(!overlay)return;
  var dialog=overlay.querySelector(dialogSelector);
  var title=dialog?dialog.querySelector(titleSelector):null;
  if(!dialog||!title)return;
  var dragging=false,ox=0,oy=0;
  title.addEventListener('mousedown',function(e){
    dragging=true;
    var rect=dialog.getBoundingClientRect();
    ox=e.clientX-rect.left;oy=e.clientY-rect.top;
    dialog.style.transform='none';
    dialog.style.left=rect.left+'px';dialog.style.top=rect.top+'px';
    e.preventDefault();
  });
  document.addEventListener('mousemove',function(e){
    if(!dragging)return;
    dialog.style.left=(e.clientX-ox)+'px';dialog.style.top=(e.clientY-oy)+'px';
  });
  document.addEventListener('mouseup',function(){dragging=false});
}
makeDraggable('gotoOverlay','.goto-dialog','.goto-title');
makeDraggable('searchOverlay','.search-dialog','.search-title');
