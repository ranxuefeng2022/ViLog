let rawData = [];
const colors = [
  'rgb(255, 99, 132)', 'rgb(54, 162, 235)', 'rgb(255, 206, 86)',
  'rgb(75, 192, 192)', 'rgb(153, 102, 255)', 'rgb(255, 159, 64)',
  'rgb(199, 199, 199)', 'rgb(83, 102, 147)', 'rgb(255, 99, 255)',
  'rgb(99, 255, 132)', 'rgb(132, 99, 255)', 'rgb(255, 132, 99)'
];
let chart = null;
let allVisible = true;

window.electronAPI?.onVlogData?.((data) => {
  rawData = data;
  initChart();
  document.getElementById('fileInfo').textContent = '记录数: ' + rawData.length + ' 条';
});

function parseTime(str) {
  var parts = str.split(/[- :]/);
  if (parts.length >= 6) {
    return new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);
  }
  return new Date();
}

function initChart() {
  if (rawData.length === 0) return;

  var labels = rawData.map(function(d) { return parseTime(d.time); });
  var fieldNames = Object.keys(rawData[0]).filter(function(k) { return k !== 'time' && k !== 'version'; });

  var priorityFields = ['电量', '电池电压'];

  var acChargePoints = [];
  var usbChargePoints = [];
  var chargeStateData = rawData.map(function(d) { return parseInt(d['充电状态']) || 0; });

  for (var i = 1; i < chargeStateData.length; i++) {
    if (chargeStateData[i-1] === 0) {
      if (chargeStateData[i] === 1) { acChargePoints.push({ x: labels[i], y: 0 }); }
      else if (chargeStateData[i] === 2) { usbChargePoints.push({ x: labels[i], y: 0 }); }
    }
  }

  var datasets = fieldNames.map(function(name, index) {
    var data = rawData.map(function(d) {
      var value = parseFloat(d[name]) || 0;
      if (name === '电池温度' || name === '板温') { return value / 10; }
      return value;
    });
    return {
      label: name, data: data,
      borderColor: colors[index % colors.length],
      backgroundColor: colors[index % colors.length].replace('rgb', 'rgba').replace(')', ', 0.1)'),
      borderWidth: 2, fill: true, tension: 0.4, pointRadius: 0, pointHoverRadius: 6,
      yAxisID: 'y' + index, hidden: !priorityFields.includes(name)
    };
  });

  if (acChargePoints.length > 0) {
    datasets.unshift({
      label: '🔌 AC充电器', data: acChargePoints, type: 'scatter',
      backgroundColor: 'rgb(255, 0, 0)', borderColor: 'rgb(255, 0, 0)',
      pointRadius: 10, pointHoverRadius: 12, pointStyle: 'triangle', yAxisID: 'y0', order: -2
    });
  }
  if (usbChargePoints.length > 0) {
    datasets.unshift({
      label: '🔌 USB充电器', data: usbChargePoints, type: 'scatter',
      backgroundColor: 'rgb(0, 150, 255)', borderColor: 'rgb(0, 150, 255)',
      pointRadius: 10, pointHoverRadius: 12, pointStyle: 'circle', yAxisID: 'y0', order: -1
    });
  }

  var ctx = document.getElementById('mainChart').getContext('2d');
  var yAxesConfig = {};
  datasets.forEach(function(ds, index) {
    if (ds.type === 'scatter') return;
    yAxesConfig[ds.yAxisID] = {
      type: 'linear', display: false,
      position: parseInt(ds.yAxisID.substring(1)) % 2 === 0 ? 'left' : 'right',
      ticks: { color: 'transparent', font: { size: 11 }, maxTicksLimit: 10 },
      grid: { color: 'transparent', drawOnChartArea: false },
      title: { display: false, text: ds.label, color: colors[index % colors.length], font: { size: 11 } }
    };
  });

  chart = new Chart(ctx, {
    type: 'line',
    data: { labels: labels, datasets: datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true, position: 'top',
          labels: { color: '#e0e0e0', font: { size: 12 }, usePointStyle: true, padding: 15 },
          onClick: function(e, legendItem, legend) {
            var ci = legend.chart;
            var ds = ci.data.datasets[legendItem.datasetIndex];
            if (ds.type === 'scatter') return;
            ds.hidden = !ds.hidden;
            var yAxis = ci.scales[ds.yAxisID];
            if (yAxis) {
              yAxis.options.display = !ds.hidden;
              yAxis.options.title.display = !ds.hidden;
              var fi = fieldNames.indexOf(ds.label);
              yAxis.options.ticks.color = ds.hidden ? 'transparent' : colors[fi % colors.length];
              yAxis.options.grid.color = ds.hidden ? 'transparent' : 'rgba(255, 255, 255, 0.1)';
              yAxis.options.grid.drawOnChartArea = !ds.hidden;
            }
            ci.update();
          }
        },
        tooltip: {
          backgroundColor: 'rgba(0, 0, 0, 0.8)', titleColor: '#00d9ff', bodyColor: '#e0e0e0',
          borderColor: '#00d9ff', borderWidth: 1, padding: 12,
          callbacks: {
            label: function(context) {
              var label = context.dataset.label || '';
              if (label) label += ': ';
              if (context.parsed.y !== null) label += context.parsed.y.toFixed(2);
              if (['电量', '电池电压'].includes(context.dataset.label)) label += ' ★';
              return label;
            },
            afterBody: function(tooltipItems) {
              if (tooltipItems.length > 0) {
                var index = tooltipItems[0].dataIndex;
                var d = rawData[index];
                var bt = (parseFloat(d['电池温度']) || 0) / 10;
                var boardT = (parseFloat(d['板温']) || 0) / 10;
                return ['', '━━━━━━━━━━━━━━━━', '🌡️ 电池温度: ' + bt.toFixed(1) + '°C', '🔥 板温: ' + boardT.toFixed(1) + '°C'];
              }
              return [];
            }
          }
        },
        zoom: { pan: { enabled: true, mode: 'x' }, zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' } }
      },
      scales: {
        x: {
          type: 'time',
          time: { displayFormats: { minute: 'HH:mm', hour: 'HH:mm', day: 'MM-dd HH:mm' } },
          ticks: { color: '#a0a0a0', maxRotation: 45, maxTicksLimit: 10 },
          grid: { color: 'rgba(255, 255, 255, 0.1)' }
        }
      }
    }
  });

  // Merge in dynamic yAxesConfig
  Object.assign(chart.options.scales, yAxesConfig);

  chart.data.datasets.forEach(function(ds, index) {
    if (ds.type === 'scatter') return;
    if (!ds.hidden) {
      var yAxis = chart.scales[ds.yAxisID];
      if (yAxis) {
        var fi = fieldNames.indexOf(ds.label);
        yAxis.options.display = true;
        yAxis.options.title.display = true;
        yAxis.options.ticks.color = colors[fi % colors.length];
        yAxis.options.grid.color = 'rgba(255, 255, 255, 0.1)';
        yAxis.options.grid.drawOnChartArea = true;
      }
    }
  });
  chart.update('none');
}

function resetZoom() { if (chart) chart.resetZoom(); }

function exportChart() {
  if (!chart) return;
  var link = document.createElement('a');
  link.download = 'vlog-chart.png';
  link.href = chart.toBase64Image();
  link.click();
}

function toggleAll() {
  if (!chart) return;
  allVisible = !allVisible;
  var lineIdx = 0;
  chart.data.datasets.forEach(function(ds) {
    if (ds.type === 'scatter') return;
    ds.hidden = allVisible;
    var yAxis = chart.scales[ds.yAxisID];
    if (yAxis) {
      if (!allVisible) {
        yAxis.options.display = true; yAxis.options.title.display = true;
        yAxis.options.ticks.color = colors[lineIdx % colors.length];
        yAxis.options.grid.color = 'rgba(255, 255, 255, 0.1)';
        yAxis.options.grid.drawOnChartArea = lineIdx < 2;
      } else {
        yAxis.options.display = false; yAxis.options.title.display = false;
        yAxis.options.ticks.color = 'transparent';
        yAxis.options.grid.color = 'transparent';
        yAxis.options.grid.drawOnChartArea = false;
      }
    }
    lineIdx++;
  });
  chart.update();
}
