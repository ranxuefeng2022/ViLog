// ==== Print Format Dialog ====

// ===================== Print Format =====================
function showInterfaceDialog(tabIdx){
  var t=TABS[tabIdx];
  if(!t||!t.printInterface){alert('该标签页无打印格式信息');return}
  var kw=t.keyword.replace(/_(mtk|qcom|default)$/,'');
  var pf=t.keyword.match(/_(mtk|qcom|default)$/);
  ifaceTitle.textContent='打印格式';
  var kl=t.keyLabels||{};
  var html='';
  html+='<div class="iface-meta">';
  html+='<span>关键词：<b>'+esc(kw)+'</b></span>';
  if(pf)html+='<span>平台：<b>'+esc(pf[1])+'</b></span>';
  html+='<span>数据行：<b>'+t.count+'</b></span>';
  html+='</div>';
  html+='<div class="iface-section"><div class="iface-section-title">打印格式</div><div class="iface-code">'+esc(t.printInterface)+'</div></div>';
  html+='<div class="iface-section"><div class="iface-section-title">字段映射 ('+((t.fieldMapping||[]).length)+')</div>';
  html+='<div class="iface-field-list">';
  var mapping=t.fieldMapping||[];
  var unmatchedKeys=new Set((t.unmatchedFields||[]).map(function(f){return f.key}));
  for(var i=0;i<mapping.length;i++){
    var m=mapping[i];
    var isEmpty=unmatchedKeys.size>0&&m.keys.every(function(k){return unmatchedKeys.has(k)});
    html+='<div class="iface-field-item'+(isEmpty?' iface-field-empty':'')+'">';
    html+='<span class="iface-field-raw">'+esc(m.raw)+'</span>';
    html+='<span class="iface-field-arrow">→</span>';
    html+='<span class="iface-field-label">'+m.keys.map(function(k){return esc(kl[k]||k)}).join(' / ')+'</span>';
    if(isEmpty)html+='<span class="iface-unmatched">未匹配</span>';
    html+='</div>';
  }
  html+='</div></div>';
  ifaceBody.innerHTML=html;
  ifaceOverlay.style.display='flex';
}
