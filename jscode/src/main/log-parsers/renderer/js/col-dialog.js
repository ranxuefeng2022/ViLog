// ==== Column Selection Dialog + Toolbar Dispatch ====

var _colDialogTab = -1;

function showColumnDialog(tabIdx) {
  if (tabIdx < 0 || tabIdx >= TABS.length) return;
  _colDialogTab = tabIdx;
  var t = TABS[tabIdx];
  var loc = tabLocal[tabIdx];
  var visCols = loc ? loc.visibleCols : null;
  var visSet = {};
  if (visCols) for (var vi = 0; vi < visCols.length; vi++) visSet[visCols[vi]] = true;
  colDialogTitle.textContent = t.name;

  var html = '';
  for (var i = 0; i < t.headers.length; i++) {
    var checked = (!visCols || visSet[i]) ? ' checked' : '';
    html += '<label class="col-item"><input type="checkbox" data-ci="' + i + '"' + checked + '><span>' + esc(t.headers[i]) + '</span></label>';
  }
  colDialogList.innerHTML = html;

  var cbs = colDialogList.querySelectorAll('input[type=checkbox]');
  for (var ci = 0; ci < cbs.length; ci++) {
    cbs[ci].onchange = applyColumnSelection;
  }

  // Position near the "选择列" button
  var dialog = colOverlay.querySelector('.col-dialog');
  var btn = document.getElementById('colBtn');
  if (dialog && btn) {
    var br = btn.getBoundingClientRect();
    dialog.style.position = 'fixed';
    dialog.style.left = Math.min(br.left, window.innerWidth - 390) + 'px';
    dialog.style.top = Math.min(br.bottom + 4, window.innerHeight - 400) + 'px';
    dialog.style.right = 'auto';
    dialog.style.bottom = 'auto';
  }

  colOverlay.style.display = 'flex';
}

function applyColumnSelection() {
  var sel = [];
  var cbs = colDialogList.querySelectorAll('input[type=checkbox]');
  for (var ci = 0; ci < cbs.length; ci++) {
    if (cbs[ci].checked) sel.push(parseInt(cbs[ci].getAttribute('data-ci')));
  }
  if (sel.length === 0) return;
  if (_colDialogTab < 0) return;
  var loc = tabLocal[_colDialogTab];
  var t = TABS[_colDialogTab];
  if (!loc) return;
  loc.visibleCols = sel.length === t.headers.length ? null : sel;
  if (_colDialogTab === activeTab) renderTab(_colDialogTab);
}

function hideColumnDialog() {
  colOverlay.style.display = 'none';
  _colDialogTab = -1;
}

document.addEventListener('click', function (e) {
  if (e.target.id === 'ifaceBtn') showInterfaceDialog(activeTab);
  else if (e.target.id === 'colBtn') showColumnDialog(activeTab);
  else if (e.target.id === 'chartBtn') showChart();
  else if (e.target.id === 'statsBtn') showStatsDialog();
  else if (e.target.id === 'linkBtn' && window.App && window.App.LinkPanel) window.App.LinkPanel.toggle();
  else if (e.target.id === 'detailBtn' && window.App && window.App.RowDetail) window.App.RowDetail.toggle();
  else if (e.target.id === 'exportBtn') exportCSV();
  else if (e.target.id === 'exportReportBtn' && window.logAnalysis && window.logAnalysis.saveReport) window.logAnalysis.saveReport();
  else if (e.target.id === 'importDbBtn') importDatabase();
});

colOverlay.addEventListener('click', function (e) {
  if (e.target === colOverlay) hideColumnDialog();
});

var colCloseEl = document.getElementById('colCloseBtn');
if (colCloseEl) colCloseEl.addEventListener('click', hideColumnDialog);

var colAllEl = document.getElementById('colAll');
var colNoneEl = document.getElementById('colNone');
if (colAllEl) colAllEl.addEventListener('click', function () {
  var cbs = colDialogList.querySelectorAll('input[type=checkbox]');
  for (var ci = 0; ci < cbs.length; ci++) cbs[ci].checked = true;
  applyColumnSelection();
});
if (colNoneEl) colNoneEl.addEventListener('click', function () {
  var cbs = colDialogList.querySelectorAll('input[type=checkbox]');
  for (var ci = 0; ci < cbs.length; ci++) cbs[ci].checked = false;
  applyColumnSelection();
});

ifaceClose.addEventListener('click', function () { ifaceOverlay.style.display = 'none'; });
ifaceOverlay.addEventListener('click', function (e) { if (e.target === ifaceOverlay) ifaceOverlay.style.display = 'none'; });