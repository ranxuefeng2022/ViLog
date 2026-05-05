/**
 * Server address configuration — externalized from index.html
 *
 * Default addresses are loaded on first run and stored in localStorage.
 * Users can customize via DevTools:
 *   localStorage.setItem('serverAddresses', JSON.stringify([...]))
 */

(function() {
  var STORAGE_KEY = 'serverAddresses';

  var DEFAULTS = [
    { value: '172.16.191.214:8082', label: 'BPM生产环境服务器' },
    { value: '10.0.2.1:8082',       label: 'BPM测试环境服务器' },
    { value: '10.0.3.1:8082',       label: '充电小组个人空间' },
    { value: '10.0.3.1:8083',       label: '充电小组windows目录挂载' },
    { value: '10.0.4.1:8083',       label: '用户A-编译服务器' },
    { value: '10.0.5.1:8082',       label: '用户A-vmware-本地EF盘' },
    { value: '10.0.6.1:8082',       label: '用户B-编译服务器' },
    { value: '10.0.7.1:8082',       label: '用户C-编译服务器' }
  ];

  function loadAddresses() {
    try {
      var stored = localStorage.getItem(STORAGE_KEY);
      if (stored) return JSON.parse(stored);
    } catch (e) {}
    return DEFAULTS.slice();
  }

  function populateDropdown() {
    var menu = document.getElementById('serverAddressDropdownMenu');
    if (!menu) return;

    var addresses = loadAddresses();
    menu.innerHTML = '';

    for (var i = 0; i < addresses.length; i++) {
      var addr = addresses[i];
      var btn = document.createElement('button');
      btn.className = 'server-address-option';
      btn.type = 'button';
      btn.setAttribute('data-value', addr.value);
      btn.textContent = '(' + addr.value + ')' + addr.label;
      menu.appendChild(btn);
    }
  }

  window.App = window.App || {};
  window.App.ServerConfig = {
    loadAddresses: loadAddresses,
    populateDropdown: populateDropdown,
    saveAddresses: function(addresses) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(addresses));
    },
    getDefaults: function() { return DEFAULTS.slice(); }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', populateDropdown);
  } else {
    populateDropdown();
  }
})();
