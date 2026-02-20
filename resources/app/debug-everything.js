/**
 * Everything 集成调试工具
 * 用于诊断 Everything 连接和搜索问题
 */

// 在浏览器控制台运行这些命令来诊断问题

console.log('=== Everything 调试工具 ===');

// 1. 测试基本连接
async function testEverythingConnection() {
  try {
    console.log('1. 测试 Everything 连接...');
    const response = await fetch('http://localhost:8888/?s=test&j=1&count=5');
    const data = await response.json();
    console.log('✅ 连接成功！返回数据:', data);
    return data;
  } catch (error) {
    console.error('❌ 连接失败:', error);
    return null;
  }
}

// 2. 测试搜索特定文件
async function testSearch() {
  try {
    // 不带扩展名通配符的搜索
    const query = '20260121_86266XXXXX27251_58321_214747.zip';
    console.log(`2. 搜索文件: ${query}`);

    const url = `http://localhost:8888/?s=${encodeURIComponent(query)}&j=1&count=10`;
    console.log(`URL: ${url}`);

    const response = await fetch(url);
    const data = await response.json();

    console.log('搜索结果:', data);
    console.log(`找到 ${data.results ? data.results.length : 0} 个结果`);

    if (data.results && data.results.length > 0) {
      console.log('第一个结果:', data.results[0]);
    }

    return data;
  } catch (error) {
    console.error('搜索失败:', error);
    return null;
  }
}

// 3. 测试通配符搜索
async function testWildcardSearch() {
  try {
    // 使用通配符
    const query = '20260121*.zip';
    console.log(`3. 通配符搜索: ${query}`);

    const url = `http://localhost:8888/?s=${encodeURIComponent(query)}&j=1&count=10`;
    const response = await fetch(url);
    const data = await response.json();

    console.log('通配符搜索结果:', data);
    console.log(`找到 ${data.results ? data.results.length : 0} 个结果`);

    return data;
  } catch (error) {
    console.error('通配符搜索失败:', error);
    return null;
  }
}

// 4. 测试获取统计信息
async function testStats() {
  try {
    console.log('4. 获取统计信息...');
    const response = await fetch('http://localhost:8888/?s=*&j=1&count=0');
    const data = await response.json();
    console.log('Everything 统计:', data);
    return data;
  } catch (error) {
    console.error('获取统计失败:', error);
    return null;
  }
}

// 运行所有测试
async function runAllTests() {
  console.log('开始运行所有测试...\n');

  await testEverythingConnection();
  console.log('\n');

  await testSearch();
  console.log('\n');

  await testWildcardSearch();
  console.log('\n');

  await testStats();
  console.log('\n');

  console.log('=== 测试完成 ===');
}

// 自动运行测试
runAllTests();

// 导出函数供手动调用
window.everythingDebug = {
  testConnection: testEverythingConnection,
  testSearch: testSearch,
  testWildcard: testWildcardSearch,
  testStats: testStats,
  runAll: runAllTests
};

console.log('调试工具已加载！可以使用以下命令：');
console.log('- everythingDebug.testConnection()');
console.log('- everythingDebug.testSearch()');
console.log('- everythingDebug.testWildcard()');
console.log('- everythingDebug.testStats()');
console.log('- everythingDebug.runAll()');
