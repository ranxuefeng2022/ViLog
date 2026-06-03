// ==== Export CSV ====

function exportCSV(){
  var loc=tabLocal[activeTab];
  if(!loc||!loc.loaded){alert('无数据可导出');return}
  var visCols=loc.visibleCols;
  if(!DA.isEmbedded&&window.logAnalysis&&window.logAnalysis.exportCSV){
    window.logAnalysis.exportCSV(activeTab,visCols).then(function(res){
      if(!res||!res.success){if(!res||!res.canceled)alert('导出失败: '+(res?res.error:'未知错误'))}
    }).catch(function(err){alert('导出失败: '+err.message)});
    return;
  }
  var rows=loc.rows;
  var t=TABS[activeTab];
  var headers=visCols?visCols.map(function(c){return t.headers[c]}):t.headers;
  var lines=[];
  lines.push('"#","'+headers.map(function(h){return h.replace(/"/g,'""')}).join('","')+'"');
  for(var i=0;i<totalRows;i++){
    var rd=rows[i];if(!rd)continue;
    var cells=[String(i+1)];
    if(visCols){for(var j=0;j<visCols.length;j++){var v=rd[visCols[j]];cells.push('"'+(v===undefined||v===null?'':String(v).replace(/"/g,'""'))+'"')}}
    else{for(var j=0;j<headers.length;j++){var v=rd[j];cells.push('"'+(v===undefined||v===null?'':String(v).replace(/"/g,'""'))+'"')}}
    lines.push(cells.join(','));
  }
  var csv='﻿'+lines.join('\n');
  var blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  var a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=(t.keyword.replace(/_(mtk|qcom|default)$/,'')||'analysis')+'_'+totalRows+'rows.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}
