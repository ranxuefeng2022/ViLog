// WinRAR 拖拽无法工作的临时解决方案
// 在 original-script.js 中添加以下提示信息

// 在 showMessage 函数中增强提示
function showWinRarWorkaround() {
  const message = `
检测到从压缩工具窗口拖拽的文件。

由于 WinRAR 使用了特殊的拖拽格式，可能无法直接拖拽。

请尝试以下方法：
1. ✅ 推荐：直接拖拽整个 .zip 文件到本工具
2. ✅ 或使用 Bandizip/7-Zip 等其他压缩工具
3. ✅ 或者先解压，再拖拽解压后的文件夹
4. ✅ 使用文件树的"导入文件"按钮选择文件

注意：直接拖拽压缩包是最高效的方式！
  `;

  // 使用自定义对话框或 toast 提示
  if (typeof showMessage === 'function') {
    showMessage(message);
  }

  console.log('💡 提示:', message);
}

// 在无法识别拖拽内容时调用
if (!hasFiles && !hasItems && dt.types.length === 0) {
  console.warn('可能使用了不支持的应用（如 WinRAR）');
  showWinRarWorkaround();
}
