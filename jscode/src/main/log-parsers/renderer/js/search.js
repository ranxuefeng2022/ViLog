// ==== Search: find, navigate, UI ====

var searchOverlay=document.getElementById('searchOverlay');
var searchInput=document.getElementById('searchInput');
var searchStatusEl=document.getElementById('searchStatus');

function doSearch(term){
  srTerm=term.toLowerCase();srMatches=[];srCurrent=-1;
  var loc=tabLocal[activeTab];
  if(!loc||!loc.loaded||!srTerm){cachedMatchSet=null;drawCanvas();updateSearchStatus();return}
  DA.searchRows(activeTab,term).then(function(res){
    srMatches=res&&res.matches?res.matches:[];
    if(srMatches.length>0)srCurrent=0;
    cachedMatchSet=srMatches.length>0?new Set(srMatches):null;
    drawCanvas();updateSearchStatus();
    if(srMatches.length>0){var di=srMatches[srCurrent];container.scrollTop=Math.round(di*scrollScale)-container.clientHeight/2+ROW_H;drawCanvas()}
  }).catch(function(){
    cachedMatchSet=null;drawCanvas();updateSearchStatus();
  });
}
function updateSearchStatus(){
  if(!searchStatusEl)return;
  if(!srTerm){searchStatusEl.textContent='';return}
  searchStatusEl.textContent=srMatches.length>0?(srCurrent+1)+'/'+srMatches.length+' 个匹配':'无匹配结果';
}
function searchNav(dir){
  if(srMatches.length===0)return;
  srCurrent=(srCurrent+dir+srMatches.length)%srMatches.length;
  cachedMatchSet=srMatches.length>0?new Set(srMatches):null;
  var di=srMatches[srCurrent];
  container.scrollTop=Math.round(di*scrollScale)-container.clientHeight/2+ROW_H;
  drawCanvas();updateSearchStatus();
}
function closeSearch(){if(searchOverlay){searchOverlay.style.display='none';var d=searchOverlay.querySelector('.search-dialog');if(d){d.style.transform='';d.style.left='50%';d.style.top='50%'}}}
function openSearch(){
  if(!searchOverlay)return;
  searchOverlay.style.display='flex';
  if(searchInput){searchInput.value=srTerm;searchInput.select()}
  setTimeout(function(){if(searchInput)searchInput.focus()},50);
}
document.addEventListener('click',function(e){
  if(e.target.id==='searchNext')searchNav(1);
  else if(e.target.id==='searchPrev')searchNav(-1);
});
document.addEventListener('keydown',function(e){
  if(e.ctrlKey&&e.key==='f'){e.preventDefault();openSearch();return}
  if(!searchInput||e.target!==searchInput)return;
  if(e.key==='Enter'){e.preventDefault();doSearch(searchInput.value)}
  else if(e.key==='Escape'){closeSearch()}
});
if(searchOverlay)searchOverlay.addEventListener('click',function(e){if(e.target===searchOverlay)closeSearch()});
if(searchInput){var searchTimer=0;searchInput.addEventListener('input',function(){clearTimeout(searchTimer);searchTimer=setTimeout(function(){doSearch(searchInput.value)},300)})}
