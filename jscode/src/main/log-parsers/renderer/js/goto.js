// ==== Goto Line + Shortcut Keys Dialog ====

// ===================== Shortcut Keys Dialog =====================
var keysOverlay=document.getElementById('keysOverlay');
document.getElementById('keysBtn').addEventListener('click',function(){
  if(!keysOverlay)return;
  keysOverlay.style.display='flex';
});
document.getElementById('keysClose').addEventListener('click',function(){if(keysOverlay)keysOverlay.style.display='none'});
if(keysOverlay)keysOverlay.addEventListener('click',function(e){if(e.target===keysOverlay)keysOverlay.style.display='none'});

// ===================== Goto Line =====================
var gotoOverlay=document.getElementById('gotoOverlay');
var gotoInput=document.getElementById('gotoInput');
document.addEventListener('keydown',function(e){
  if(e.ctrlKey&&e.key==='g'){
    e.preventDefault();
    if(!gotoOverlay)return;
    if(gotoOverlay.style.display==='flex'){
      gotoOverlay.style.display='none';return;
    }
    var loc=tabLocal[activeTab];
    if(!loc||!loc.loaded||!loc.rows)return;
    gotoInput.max=loc.rows.length;
    gotoInput.value='';
    gotoOverlay.style.display='flex';
    setTimeout(function(){gotoInput.focus()},50);
  }
});
function closeGoto(){if(gotoOverlay){gotoOverlay.style.display='none';var d=gotoOverlay.querySelector('.goto-dialog');if(d){d.style.transform='';d.style.left='50%';d.style.top='50%'}}}
function doGotoLine(){
  var loc=tabLocal[activeTab];
  if(!loc||!loc.loaded||!loc.rows)return;
  var num=parseInt(gotoInput.value,10);
  if(isNaN(num)||num<1){closeGoto();return}
  var len=loc.rows.length;
  if(num>len)num=len;
  container.scrollTop=Math.round((num-1)*scrollScale);
  drawCanvas();
  closeGoto();
}
if(gotoOverlay)gotoOverlay.addEventListener('click',function(e){if(e.target===gotoOverlay)closeGoto()});
var gotoBtn=document.getElementById('gotoBtn');
if(gotoBtn)gotoBtn.addEventListener('click',doGotoLine);
if(gotoInput)gotoInput.addEventListener('keydown',function(e){
  if(e.key==='Enter'){e.preventDefault();doGotoLine()}
  else if(e.key==='Escape')closeGoto();
});
