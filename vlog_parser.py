#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Vlog日志解析工具 - 独立版本
可以打包成exe直接运行
双击即可自动解析当前目录下所有zip文件中的1501日志
"""

import os
import sys
import zipfile
import io
import glob
from concurrent.futures import ThreadPoolExecutor, as_completed

# Windows控制台编码处理
if sys.platform == 'win32':
    try:
        import ctypes
        kernel32 = ctypes.windll.kernel32
        kernel32.SetConsoleMode(kernel32.GetStdHandle(-11), 7)
        # 尝试设置UTF-8编码
        os.system('chcp 65001 >nul 2>&1')
    except:
        pass

def echo(message):
    """安全的输出函数"""
    try:
        sys.stdout.write(message + '\n')
        sys.stdout.flush()
    except:
        pass

def parse_single_log_file(lines):
    """解析单个日志文件的内容"""
    field_names = [
        '电量', '电池状态', '充电状态', '屏幕状态', '充电量', '耗电量',
        '显示电量', '亮度', '电池电压', '电流', '电池温度', '板温',
        '充电电压', '充电类型', 'Otg状态', '库伦量', 'Ibus', '线阻抗',
        'Esr', 'Rslow', '', ''
    ]

    column_widths = {
        '电量': 12, '电池状态': 12, '充电状态': 12, '屏幕状态': 12,
        '充电量': 12, '耗电量': 12, '显示电量': 12, '亮度': 8, '电池电压': 12, '电流': 8,
        '电池温度': 12, '板温': 8, '充电电压': 12, '充电类型': 12, 'Otg状态': 8, '库伦量': 12,
        'Ibus': 12, '线阻抗': 12, 'Esr': 8, 'Rslow': 8
    }

    result = []

    # 解析数据（每3行一组）
    for i in range(0, len(lines), 3):
        if i + 2 >= len(lines):
            continue

        timestamp = lines[i]
        software_version = lines[i+1]
        data_line = lines[i+2]

        if not data_line.startswith('v1t0:'):
            continue

        data_values = data_line[len('v1t0:'):].split(',')

        line_content = f"{timestamp:<18}  {software_version:<18}"

        for idx, field in enumerate(field_names):
            if field == '':
                continue
            value = data_values[idx] if idx < len(data_values) else ''
            line_content += f"  {field}: {value:<{column_widths.get(field, 12)}}"

        result.append(line_content + '\n')

    return result

def parse_zip_file(zip_path, output_file):
    """解析zip压缩包中的所有1501_1_日志文件"""
    try:
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            # 查找所有包含1501_1_的txt文件
            log_files = [f for f in zip_ref.namelist() if '1501_1_' in f and f.endswith('.txt')]

            if not log_files:
                return 0, f"未找到1501_1_日志文件"

            result = []

            # 对每个日志文件进行排序并处理
            for log_file in sorted(log_files):
                try:
                    # 从zip中读取文件内容
                    with zip_ref.open(log_file) as file:
                        # 使用io.TextIOWrapper处理文本编码
                        text_file = io.TextIOWrapper(file, encoding='utf-8', errors='ignore')
                        lines = [line.strip() for line in text_file if line.strip()]

                    # 解析数据
                    parsed_data = parse_single_log_file(lines)
                    result.extend(parsed_data)

                except Exception as e:
                    continue

            # 写入输出文件
            if result:
                try:
                    with open(output_file, 'w', encoding='utf-8') as f:
                        f.writelines(result)
                    return len(result), None
                except Exception as e:
                    return 0, f"写入文件失败: {str(e)}"
            else:
                return 0, "没有有效数据"

    except Exception as e:
        return 0, f"处理zip文件出错: {str(e)}"

def process_zip(zip_file):
    """处理单个zip文件"""
    # 根据zip文件名生成输出文件名，添加vlog_前缀
    output_file = "vlog_" + zip_file.replace('.zip', '.txt')

    echo(f"正在处理: {zip_file} -> {output_file}")

    record_count, error = parse_zip_file(zip_file, output_file)

    if error is None:
        return (zip_file, output_file, record_count, True, None)
    else:
        return (zip_file, output_file, 0, False, error)

def generate_csv(txt_file, zip_file):
    """生成CSV文件"""
    try:
        # 读取txt数据
        with open(txt_file, 'r', encoding='utf-8') as f:
            lines = [line.strip() for line in f if line.strip()]

        if not lines:
            return 0, "没有数据"

        # 解析数据行
        data_rows = []
        for line in lines:
            if not line:
                continue
            # 解析时间戳
            parts = line.split()
            if len(parts) < 2:
                continue

            timestamp = parts[0] + ' ' + parts[1]
            version = parts[2] if len(parts) > 2 else ''

            # 解析各个字段
            data = {'时间': timestamp, '版本': version}
            i = 3
            while i < len(parts):
                if i + 1 < len(parts) and parts[i].endswith(':'):
                    key = parts[i][:-1]  # 移除冒号
                    value = parts[i + 1]
                    data[key] = value
                    i += 2
                else:
                    i += 1

            data_rows.append(data)

        if not data_rows:
            return 0, "解析失败"

        # 生成CSV文件名
        csv_file = txt_file.replace('.txt', '.csv')

        # 获取所有字段名（保持顺序）
        if data_rows:
            field_names = list(data_rows[0].keys())
        else:
            return 0, "没有数据"

        # 写入CSV文件（使用UTF-8 BOM编码，Excel可以正确识别）
        import csv
        with open(csv_file, 'w', encoding='utf-8-sig', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=field_names)
            writer.writeheader()
            writer.writerows(data_rows)

        return len(data_rows), None

    except Exception as e:
        return 0, f"生成CSV失败: {str(e)}"

def generate_html(txt_file, zip_file):
    """生成HTML可视化文件"""
    try:
        # 读取txt数据
        with open(txt_file, 'r', encoding='utf-8') as f:
            lines = [line.strip() for line in f if line.strip()]

        if not lines:
            return 0, "没有数据"

        # 解析数据行
        data_rows = []
        for line in lines:
            if not line:
                continue
            # 解析时间戳
            parts = line.split()
            if len(parts) < 2:
                continue

            timestamp = parts[0] + ' ' + parts[1]
            version = parts[2] if len(parts) > 2 else ''

            # 解析各个字段
            data = {'time': timestamp, 'version': version}
            i = 3
            while i < len(parts):
                if i + 1 < len(parts) and parts[i].endswith(':'):
                    key = parts[i][:-1]  # 移除冒号
                    value = parts[i + 1]
                    data[key] = value
                    i += 2
                else:
                    i += 1

            data_rows.append(data)

        if not data_rows:
            return 0, "解析失败"

        # 获取所有字段名（排除time和version）
        field_names = []
        if data_rows:
            first_row = data_rows[0]
            field_names = [k for k in first_row.keys() if k not in ['time', 'version']]

        # 生成HTML文件名
        html_file = txt_file.replace('.txt', '.html')

        # 生成颜色配置
        colors = [
            'rgb(255, 99, 132)', 'rgb(54, 162, 235)', 'rgb(255, 206, 86)',
            'rgb(75, 192, 192)', 'rgb(153, 102, 255)', 'rgb(255, 159, 64)',
            'rgb(199, 199, 199)', 'rgb(83, 102, 147)', 'rgb(255, 99, 255)',
            'rgb(99, 255, 132)', 'rgb(132, 99, 255)', 'rgb(255, 132, 99)'
        ]

        # 生成HTML内容
        html_content = f'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Vlog电池数据可视化 - {os.path.basename(html_file)}</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3.0.0/dist/chartjs-adapter-date-fns.bundle.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-zoom@2.0.1/dist/chartjs-plugin-zoom.min.js"></script>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            min-height: 100vh;
            color: #e0e0e0;
            padding: 20px;
        }}
        .container {{ max-width: 100%; margin: 0 auto; }}
        header {{
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 30px;
            padding: 20px 30px;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 15px;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.1);
        }}
        h1 {{
            font-size: 1.8em;
            background: linear-gradient(90deg, #00d9ff, #00ff88);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }}
        .file-info {{ color: #00d9ff; font-size: 0.95em; }}
        .chart-card {{
            background: rgba(255, 255, 255, 0.08);
            padding: 25px;
            border-radius: 15px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            margin-bottom: 30px;
        }}
        .chart-card h2 {{
            color: #00d9ff;
            margin-bottom: 20px;
            font-size: 1.5em;
            display: flex;
            align-items: center;
            gap: 10px;
        }}
        .chart-card h2::before {{
            content: '';
            width: 4px;
            height: 28px;
            background: linear-gradient(135deg, #00d9ff, #00ff88);
            border-radius: 2px;
        }}
        .chart-container {{ position: relative; height: 500px; }}
        .controls {{
            display: flex;
            gap: 15px;
            flex-wrap: wrap;
            margin-top: 20px;
        }}
        .btn {{
            padding: 10px 25px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-weight: bold;
            transition: all 0.3s ease;
            font-size: 0.95em;
        }}
        .btn-primary {{
            background: linear-gradient(135deg, #00d9ff 0%, #00ff88 100%);
            color: #1a1a2e;
        }}
        .btn-primary:hover {{ transform: translateY(-2px); box-shadow: 0 4px 15px rgba(0, 217, 255, 0.4); }}
        .btn-secondary {{
            background: rgba(255, 255, 255, 0.1);
            color: #e0e0e0;
            border: 1px solid rgba(255, 255, 255, 0.2);
        }}
        .btn-secondary:hover {{ background: rgba(255, 255, 255, 0.2); }}
        .btn-warning {{
            background: rgba(255, 193, 7, 0.2);
            color: #ffc107;
            border: 1px solid rgba(255, 193, 7, 0.3);
        }}
        .btn-warning:hover {{ background: rgba(255, 193, 7, 0.3); }}
    </style>
</head>
<body>
    <div class="container">
        <header>
            <div>
                <h1>📊 Vlog电池数据可视化</h1>
                <div class="file-info">文件: {os.path.basename(html_file)} | 记录数: {len(data_rows)} 条</div>
            </div>
        </header>

        <div class="chart-card">
            <h2>📈 综合数据对比（多坐标轴）</h2>
            <div class="chart-container">
                <canvas id="mainChart"></canvas>
            </div>
            <div class="controls">
                <button class="btn btn-warning" onclick="resetZoom()">🔍 重置缩放</button>
                <button class="btn btn-primary" onclick="exportChart()">📷 导出图表</button>
                <button class="btn btn-secondary" onclick="toggleAll()">👁️ 显示/隐藏所有</button>
            </div>
        </div>
    </div>

    <script>
        // 嵌入数据
        const rawData = {str(data_rows)};

        // 颜色配置
        const colors = {str(colors)};

        // 解析时间
        function parseTime(str) {{
            const parts = str.split(/[- :]/);
            if (parts.length >= 6) {{
                return new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);
            }}
            return new Date();
        }}

        // 提取数据
        const labels = rawData.map(d => parseTime(d.time));
        const fieldNames = Object.keys(rawData[0]).filter(k => k !== 'time' && k !== 'version');

        // 定义优先显示的重要字段（默认只显示这两条）
        const priorityFields = ['电量', '电池电压'];

        // 检测充电状态变化：0→1表示AC充电器，0→2表示USB充电器
        const acChargePoints = [];  // AC充电器标记点
        const usbChargePoints = []; // USB充电器标记点
        const chargeStateData = rawData.map(d => parseInt(d['充电状态']) || 0);

        for (let i = 1; i < chargeStateData.length; i++) {{
            if (chargeStateData[i-1] === 0) {{
                if (chargeStateData[i] === 1) {{
                    // AC充电器插入
                    acChargePoints.push({{
                        x: labels[i],
                        y: 0
                    }});
                }} else if (chargeStateData[i] === 2) {{
                    // USB充电器插入
                    usbChargePoints.push({{
                        x: labels[i],
                        y: 0
                    }});
                }}
            }}
        }}

        // 构建数据集
        const datasets = fieldNames.map((name, index) => {{
            // 电池温度和板温需要除以10转换为摄氏度
            const data = rawData.map(d => {{
                const value = parseFloat(d[name]) || 0;
                if (name === '电池温度' || name === '板温') {{
                    return value / 10;
                }}
                return value;
            }});

            return {{
                label: name,
                data: data,
                borderColor: colors[index % colors.length],
                backgroundColor: colors[index % colors.length].replace('rgb', 'rgba').replace(')', ', 0.1)'),
                borderWidth: 2,
                fill: true,
                tension: 0.4,
                pointRadius: 0,
                pointHoverRadius: 6,
                yAxisID: 'y' + index,
                // 只显示优先字段，其他默认隐藏
                hidden: !priorityFields.includes(name)
            }};
        }});

        // 添加充电标记点（使用scatter类型）
        // AC充电器：红色三角形
        if (acChargePoints.length > 0) {{
            datasets.unshift({{
                label: '🔌 AC充电器',
                data: acChargePoints,
                type: 'scatter',
                backgroundColor: 'rgb(255, 0, 0)',
                borderColor: 'rgb(255, 0, 0)',
                pointRadius: 10,
                pointHoverRadius: 12,
                pointStyle: 'triangle',
                yAxisID: 'y0',
                order: -2  // 确保显示在最上层
            }});
        }}

        // USB充电器：蓝色圆形
        if (usbChargePoints.length > 0) {{
            datasets.unshift({{
                label: '🔌 USB充电器',
                data: usbChargePoints,
                type: 'scatter',
                backgroundColor: 'rgb(0, 150, 255)',
                borderColor: 'rgb(0, 150, 255)',
                pointRadius: 10,
                pointHoverRadius: 12,
                pointStyle: 'circle',
                yAxisID: 'y0',
                order: -1  // 确保显示在次上层
            }});
        }}

        // 创建图表
        const ctx = document.getElementById('mainChart').getContext('2d');

        // 构建Y轴配置（根据实际的yAxisID而不是数组索引）
        const yAxesConfig = {{}};
        datasets.forEach((ds, index) => {{
            // 跳过scatter数据集，使用其关联的Y轴配置
            if (ds.type === 'scatter') {{
                // scatter使用y0轴，但y0轴的配置应该由使用y0轴的line dataset提供
                // 如果scatter使用y0轴，需要确保有一个line dataset也使用y0轴
                return;
            }}

            yAxesConfig[ds.yAxisID] = {{
                type: 'linear',
                display: false,  // 默认隐藏所有Y轴
                position: parseInt(ds.yAxisID.substring(1)) % 2 === 0 ? 'left' : 'right',
                ticks: {{
                    color: 'transparent',
                    font: {{ size: 11 }},
                    maxTicksLimit: 10
                }},
                grid: {{
                    color: 'transparent',
                    drawOnChartArea: false
                }},
                title: {{
                    display: false,
                    text: ds.label,
                    color: colors[index % colors.length],
                    font: {{ size: 11 }}
                }}
            }};
        }});

        const chart = new Chart(ctx, {{
            type: 'line',
            data: {{ labels, datasets }},
            options: {{
                responsive: true,
                maintainAspectRatio: false,
                interaction: {{
                    mode: 'index',
                    intersect: false
                }},
                plugins: {{
                    legend: {{
                        display: true,
                        position: 'top',
                        labels: {{
                            color: '#e0e0e0',
                            font: {{ size: 12 }},
                            usePointStyle: true,
                            padding: 15
                        }},
                        // 自定义图例点击事件
                        onClick: (e, legendItem, legend) => {{
                            const index = legendItem.datasetIndex;
                            const ci = legend.chart;
                            const ds = ci.data.datasets[index];

                            // 跳过scatter数据集
                            if (ds.type === 'scatter') {{
                                return;
                            }}

                            // 切换数据集显示/隐藏
                            ds.hidden = !ds.hidden;
                            const isHidden = ds.hidden;

                            // 同步更新Y轴显示状态
                            const yAxisId = ds.yAxisID;
                            const yAxis = ci.scales[yAxisId];

                            if (yAxis) {{
                                yAxis.options.display = !isHidden;
                                yAxis.options.title.display = !isHidden;
                                // 根据字段名找到对应的颜色索引
                                const fieldIndex = fieldNames.indexOf(ds.label);
                                yAxis.options.ticks.color = isHidden ? 'transparent' : colors[fieldIndex % colors.length];
                                yAxis.options.grid.color = isHidden ? 'transparent' : 'rgba(255, 255, 255, 0.1)';
                                yAxis.options.grid.drawOnChartArea = !isHidden;
                            }}

                            ci.update();
                        }}
                    }},
                    tooltip: {{
                        backgroundColor: 'rgba(0, 0, 0, 0.8)',
                        titleColor: '#00d9ff',
                        bodyColor: '#e0e0e0',
                        borderColor: '#00d9ff',
                        borderWidth: 1,
                        padding: 12,
                        callbacks: {{
                            label: function(context) {{
                                let label = context.dataset.label || '';
                                if (label) {{
                                    label += ': ';
                                }}
                                if (context.parsed.y !== null) {{
                                    label += context.parsed.y.toFixed(2);
                                }}
                                // 为重要字段添加特殊标记
                                if (['电量', '电池电压'].includes(context.dataset.label)) {{
                                    label += ' ★';
                                }}
                                return label;
                            }},
                            afterBody: function(tooltipItems) {{
                                // 在tooltip最后添加电池温度和板温信息
                                if (tooltipItems.length > 0) {{
                                    const index = tooltipItems[0].dataIndex;
                                    const data = rawData[index];
                                    const batteryTemp = (parseFloat(data['电池温度']) || 0) / 10;
                                    const boardTemp = (parseFloat(data['板温']) || 0) / 10;

                                    return [
                                        '',
                                        '━━━━━━━━━━━━━━━━',
                                        '🌡️ 电池温度: ' + batteryTemp.toFixed(1) + '°C',
                                        '🔥 板温: ' + boardTemp.toFixed(1) + '°C'
                                    ];
                                }}
                                return [];
                            }}
                        }}
                    }},
                    zoom: {{
                        pan: {{ enabled: true, mode: 'x' }},
                        zoom: {{
                            wheel: {{ enabled: true }},
                            pinch: {{ enabled: true }},
                            mode: 'x'
                        }}
                    }}
                }},
                scales: {{
                    x: {{
                        type: 'time',
                        time: {{
                            displayFormats: {{
                                minute: 'HH:mm',
                                hour: 'HH:mm',
                                day: 'MM-dd HH:mm'
                            }}
                        }},
                        ticks: {{
                            color: '#a0a0a0',
                            maxRotation: 45,
                            maxTicksLimit: 10
                        }},
                        grid: {{
                            color: 'rgba(255, 255, 255, 0.1)'
                        }}
                    }},
                    ...yAxesConfig
                }}
            }}
        }});

        // 初始化Y轴显示状态：显示可见数据集的Y轴
        chart.data.datasets.forEach((ds, index) => {{
            // 跳过scatter数据集
            if (ds.type === 'scatter') {{
                return;
            }}

            if (!ds.hidden) {{
                const yAxis = chart.scales[ds.yAxisID];
                if (yAxis) {{
                    // 根据字段名找到对应的颜色索引
                    const fieldIndex = fieldNames.indexOf(ds.label);
                    yAxis.options.display = true;
                    yAxis.options.title.display = true;
                    yAxis.options.ticks.color = colors[fieldIndex % colors.length];
                    yAxis.options.grid.color = 'rgba(255, 255, 255, 0.1)';
                    yAxis.options.grid.drawOnChartArea = true;
                }}
            }}
        }});
        chart.update('none');

        function resetZoom() {{
            chart.resetZoom();
        }}

        function exportChart() {{
            const link = document.createElement('a');
            link.download = '{os.path.basename(html_file)}.png';
            link.href = chart.toBase64Image();
            link.click();
        }}

        let allVisible = true;
        function toggleAll() {{
            allVisible = !allVisible;
            let lineDatasetIndex = 0;  // 用于跟踪line dataset的数量

            chart.data.datasets.forEach((ds, index) => {{
                // 跳过scatter数据集，始终保持可见
                if (ds.type === 'scatter') {{
                    return;
                }}

                ds.hidden = allVisible;

                // 同步更新Y轴显示状态
                const yAxis = chart.scales[ds.yAxisID];
                if (yAxis) {{
                    if (!allVisible) {{  // 如果要显示所有
                        yAxis.options.display = true;
                        yAxis.options.title.display = true;
                        yAxis.options.ticks.color = colors[lineDatasetIndex % colors.length];
                        yAxis.options.grid.color = 'rgba(255, 255, 255, 0.1)';
                        yAxis.options.grid.drawOnChartArea = lineDatasetIndex < 2;  // 只显示前2个line dataset的网格
                    }} else {{  // 如果要隐藏所有
                        yAxis.options.display = false;
                        yAxis.options.title.display = false;
                        yAxis.options.ticks.color = 'transparent';
                        yAxis.options.grid.color = 'transparent';
                        yAxis.options.grid.drawOnChartArea = false;
                    }}
                }}
                lineDatasetIndex++;
            }});
            chart.update();
        }}
    </script>
</body>
</html>'''

        # 写入HTML文件
        with open(html_file, 'w', encoding='utf-8') as f:
            f.write(html_content)

        return len(data_rows), None

    except Exception as e:
        return 0, f"生成HTML失败: {str(e)}"

def process_zip(zip_file):
    """处理单个zip文件"""
    # 根据zip文件名生成输出文件名，添加vlog_前缀
    # 例如: 20260108_xxx.zip -> vlog_20260108_xxx.txt
    output_file = "vlog_" + zip_file.replace('.zip', '.txt')

    echo(f"正在处理: {zip_file} -> {output_file}")

    record_count, error = parse_zip_file(zip_file, output_file)

    if error is None:
        # 生成CSV文件
        csv_count, csv_error = generate_csv(output_file, zip_file)
        if csv_error:
            echo(f"  [警告] CSV生成失败: {csv_error}")
        else:
            echo(f"  [完成] 已生成CSV: {output_file.replace('.txt', '.csv')}")

        # 生成HTML可视化文件
        html_count, html_error = generate_html(output_file, zip_file)
        if html_error:
            echo(f"  [警告] HTML生成失败: {html_error}")
        else:
            echo(f"  [完成] 已生成HTML: {output_file.replace('.txt', '.html')}")
        return (zip_file, output_file, record_count, True, None)
    else:
        return (zip_file, output_file, 0, False, error)

def main():
    """主函数"""
    # 获取脚本所在目录
    if getattr(sys, 'frozen', False):
        # 打包后的exe，获取exe所在目录
        script_dir = os.path.dirname(sys.executable)
    else:
        # 脚本模式，获取脚本所在目录
        script_dir = os.path.dirname(os.path.abspath(__file__))

    # 切换到脚本所在目录
    os.chdir(script_dir)

    echo("=" * 70)
    echo("           Vlog日志解析工具 - 1501电池数据分析")
    echo("=" * 70)
    echo("")

    # 查找当前目录下所有zip文件
    zip_files = glob.glob("*.zip")

    if not zip_files:
        echo("未找到任何zip文件，按任意键退出...")
        input()
        return

    echo(f"找到 {len(zip_files)} 个zip文件")
    echo("开始解析...")
    echo("-" * 70)

    # 使用线程池并行处理（最多4个并发）
    max_workers = min(4, len(zip_files))
    total_records = 0
    success_count = 0

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        # 提交所有任务
        future_to_zip = {executor.submit(process_zip, zip_file): zip_file
                         for zip_file in sorted(zip_files)}

        # 收集结果
        for future in as_completed(future_to_zip):
            zip_file, output_file, record_count, success, error = future.result()

            if success:
                echo(f"[完成] {zip_file} -> {output_file} ({record_count} 条记录)")
                total_records += record_count
                success_count += 1
            else:
                echo(f"[失败] {zip_file}: {error}")

    echo("")
    echo("=" * 70)
    echo(f"解析完成！")
    echo(f"  成功处理: {success_count}/{len(zip_files)} 个文件")
    echo(f"  总记录数: {total_records} 条")
    echo(f"  输出文件:")
    echo(f"    - vlog_*.txt  (文本数据)")
    echo(f"    - vlog_*.csv  (Excel表格)")
    echo(f"    - vlog_*.html (可视化图表)")
    echo("=" * 70)
    echo("")
    echo("按任意键退出...")
    input()

if __name__ == "__main__":
    main()
