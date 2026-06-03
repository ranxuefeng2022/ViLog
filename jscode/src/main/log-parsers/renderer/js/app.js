// ==== App Init: window controls, data loading ====
// Uses App.LogParser.DataAccess (global DA shorthand) for IPC/embedded data access

document.addEventListener('contextmenu',function(e){e.preventDefault()});
document.querySelector('.wc-min').addEventListener('click',function(){if(window.logAnalysis)window.logAnalysis.minimize()});
document.querySelector('.wc-max').addEventListener('click',function(){if(window.logAnalysis)window.logAnalysis.maximize()});
document.querySelector('.wc-close').addEventListener('click',function(){if(window.logAnalysis)window.logAnalysis.close()});
document.addEventListener('keydown',function(e){if(e.ctrlKey&&e.key==='w'){e.preventDefault();if(window.logAnalysis)window.logAnalysis.close()}});

function importDatabase(){
  DA.importDatabase().then(function(res){
    if(!res||!res.success){
      if(res&&res.error)alert('导入失败: '+res.error);
      return;
    }
    TABS=res.tabs;
    scrollTops=new Array(res.tabs.length).fill(0);
    scrollLefts=new Array(res.tabs.length).fill(0);
    tabLocal=res.tabs.map(function(){return{rows:[],chunks:{},visibleCols:null,loaded:false}});
    chartConfigs=[];chartTimeData=null;chartFileData=null;
    buildTabButtons();
    loadTab(0);
  }).catch(function(err){
    alert('导入失败: '+err.message);
  });
}

DA.getTabs().then(function(tabs){
  if(!tabs||tabs.length===0){loadingMask.style.display='flex';loadingMask.textContent='没有数据';return}
  TABS=tabs;
  scrollTops=new Array(tabs.length).fill(0);
  scrollLefts=new Array(tabs.length).fill(0);
  tabLocal=tabs.map(function(){return{rows:[],chunks:{},visibleCols:null,loaded:false}});

  if(DA.isEmbedded){
    // Embedded mode: all data available upfront, fill rows directly
    for(var i=0;i<tabs.length;i++){
      tabLocal[i]._full=true;
      var ed=__EMBEDDED_DATA[i];
      for(var r=0;r<ed.length;r++){
        tabLocal[i].rows[r]=ed[r];
      }
      tabLocal[i].loaded=true;
    }
    buildTabButtons();
    renderTab(0);
  }else{
    tabLocal=tabs.map(function(){return{rows:[],chunks:{},visibleCols:null,loaded:false}});
    buildTabButtons();
    loadTab(0);
  }
}).catch(function(err){loadingMask.style.display='flex';loadingMask.textContent='加载失败: '+err.message});
