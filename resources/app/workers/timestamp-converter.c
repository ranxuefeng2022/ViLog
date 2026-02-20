// timestamp-converter.c
// WebAssembly 时间戳转换模块

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <stdint.h>
#ifndef EMSCRIPTEN
#define EMSCRIPTEN_KEEPALIVE
#else
#include <emscripten.h>
#endif

// 导出HEAP指针供JavaScript使用
EMSCRIPTEN_KEEPALIVE
uint8_t* get_heap_ptr() {
    // 返回堆内存起始地址（通过malloc获取）
    static uint8_t *heap_ptr = NULL;
    if (heap_ptr == NULL) {
        heap_ptr = (uint8_t *)malloc(1);
    }
    return heap_ptr;
}

EMSCRIPTEN_KEEPALIVE
int get_heap_size() {
    return 16 * 1024 * 1024; // 16MB
}

// UTC参考点结构
typedef struct {
    long long boot_time;    // boot time (微秒)
    long long utc_timestamp; // UTC timestamp (毫秒)
} ReferencePoint;

// 全局变量
ReferencePoint *g_references = NULL;
int g_reference_count = 0;

// 设置UTC参考点 - 接受uint32数组（每个参考点4个uint32）
EMSCRIPTEN_KEEPALIVE
void set_reference_points(unsigned int *refs, int count) {
    if (g_references != NULL) {
        free(g_references);
    }
    g_references = (ReferencePoint *)malloc(sizeof(ReferencePoint) * count);

    // 从uint32数组转换为ReferencePoint
    for (int i = 0; i < count; i++) {
        int base = i * 4;
        // 重组64位整数（小端序）
        unsigned int low1 = refs[base];
        unsigned int high1 = refs[base + 1];
        g_references[i].boot_time = ((long long)high1 << 32) | low1;

        unsigned int low2 = refs[base + 2];
        unsigned int high2 = refs[base + 3];
        g_references[i].utc_timestamp = ((long long)high2 << 32) | low2;
    }
    g_reference_count = count;
}

// 清空参考点
EMSCRIPTEN_KEEPALIVE
void cleanup_reference_points() {
    if (g_references != NULL) {
        free(g_references);
        g_references = NULL;
    }
    g_reference_count = 0;
}

// 解析纳秒时间戳（返回纳秒，保留精度）
EMSCRIPTEN_KEEPALIVE
long long parse_boot_time(const char *line) {
    char *copy = strdup(line);
    char *token;
    int field = 0;
    long long boot_time = 0;

    token = strtok(copy, ",");
    while (token != NULL && field < 3) {
        if (field == 2) {
            boot_time = atoll(token); // 保持纳秒精度
            break;
        }
        token = strtok(NULL, ",");
        field++;
    }

    free(copy);
    return boot_time;
}

// 线性插值计算UTC时间
EMSCRIPTEN_KEEPALIVE
long long interpolate_utc_time(long long boot_time) {
    if (g_reference_count == 0) {
        return 0;
    }

    // 找到插值区间
    int prev_idx = -1;
    int next_idx = -1;

    for (int i = 0; i < g_reference_count; i++) {
        if (boot_time >= g_references[i].boot_time) {
            prev_idx = i;
        } else {
            next_idx = i;
            break;
        }
    }

    // 边界情况
    if (prev_idx == -1) {
        return g_references[0].utc_timestamp;
    }
    if (next_idx == -1) {
        return g_references[prev_idx].utc_timestamp;
    }

    // 线性插值
    long long ref1_boot = g_references[prev_idx].boot_time;
    long long ref2_boot = g_references[next_idx].boot_time;
    long long ref1_utc = g_references[prev_idx].utc_timestamp;
    long long ref2_utc = g_references[next_idx].utc_timestamp;

    long long boot_diff = ref2_boot - ref1_boot;
    long long utc_diff = ref2_utc - ref1_utc;

    if (boot_diff == 0) {
        return ref1_utc;
    }

    long long offset_from_ref1 = boot_time - ref1_boot;
    long long interpolated_utc = ref1_utc + (offset_from_ref1 * utc_diff / boot_diff);

    return interpolated_utc;
}

// 格式化时间戳为字符串
EMSCRIPTEN_KEEPALIVE
void format_timestamp(long long utc_ms, char *output, int output_size) {
    time_t seconds = utc_ms / 1000;
    int millis = utc_ms % 1000;
    int micros = 0;

    struct tm *tm_info = gmtime(&seconds);

    snprintf(output, output_size,
             "[%04d-%02d-%02d %02d:%02d:%02d.%03d]",
             tm_info->tm_year + 1900,
             tm_info->tm_mon + 1,
             tm_info->tm_mday,
             tm_info->tm_hour,
             tm_info->tm_min,
             tm_info->tm_sec,
             millis);
}

// 转换单行日志
EMSCRIPTEN_KEEPALIVE
void convert_line(char *input, char *output, int output_size) {
    // 检查是否是文件头
    if (input[0] == '=' || strlen(input) == 0) {
        strncpy(output, input, output_size);
        return;
    }

    // 解析 boot time
    long long boot_time = parse_boot_time(input);
    if (boot_time == 0) {
        strncpy(output, input, output_size);
        return;
    }

    // 插值计算 UTC 时间
    long long utc_ms = interpolate_utc_time(boot_time);
    if (utc_ms == 0) {
        strncpy(output, input, output_size);
        return;
    }

    // 格式化时间戳
    char timestamp[64];
    format_timestamp(utc_ms, timestamp, sizeof(timestamp));

    // 提取原始行的其余部分
    char *rest = strchr(input, ',');
    if (rest == NULL) {
        strncpy(output, input, output_size);
        return;
    }

    // 构建输出
    snprintf(output, output_size, "%s%s", timestamp, rest);
}

// 转换单行日志 - 接受输出缓冲区作为参数（更可靠）
EMSCRIPTEN_KEEPALIVE
void convert_line_with_buffer(const char *input, char *output, int output_size) {
    // 检查是否是文件头
    if (input[0] == '=' || strlen(input) == 0) {
        strncpy(output, input, output_size);
        return;
    }

    // 解析 boot time
    long long boot_time = parse_boot_time(input);
    if (boot_time == 0) {
        strncpy(output, input, output_size);
        return;
    }

    // 插值计算 UTC 时间
    long long utc_ms = interpolate_utc_time(boot_time);
    if (utc_ms == 0) {
        strncpy(output, input, output_size);
        return;
    }

    // 格式化时间戳
    char timestamp[64];
    format_timestamp(utc_ms, timestamp, sizeof(timestamp));

    // 提取原始行的其余部分
    char *rest = strchr(input, ',');
    if (rest == NULL) {
        strncpy(output, input, output_size);
        return;
    }

    // 构建输出
    snprintf(output, output_size, "%s%s", timestamp, rest);
}

// 转换单行日志 - 返回字符串（使用堆分配避免静态缓冲区问题）
EMSCRIPTEN_KEEPALIVE
char* convert_line_simple(const char *input) {
    // 使用堆分配缓冲区
    static char *output_buffer = NULL;
    static int buffer_size = 0;

    // 第一次调用时分配缓冲区
    if (output_buffer == NULL) {
        buffer_size = 4096;
        output_buffer = (char *)malloc(buffer_size);
    }

    // 调用实际转换函数
    convert_line_with_buffer(input, output_buffer, buffer_size);

    return output_buffer;
}

// 导出版本信息
EMSCRIPTEN_KEEPALIVE
const char* get_version() {
    return "Timestamp Converter WASM v1.2.0";
}

// ==================== 测试用的 main 函数 ====================
#ifndef EMSCRIPTEN
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// 辅助函数：从android time行解析UTC时间戳
long long parse_android_time(const char *line) {
    // 查找 "android time " 后面的时间
    const char *prefix = "android time ";
    char *time_str = strstr(line, prefix);
    if (!time_str) return 0;
    time_str += strlen(prefix);

    // 解析时间字符串: "2025-07-01 08:21:59.64011"
    int year, month, day, hour, min, sec, millis = 0;
    if (sscanf(time_str, "%d-%d-%d %d:%d:%d.%d", &year, &month, &day, &hour, &min, &sec, &millis) < 6) {
        return 0;
    }

    // 转换为UTC时间戳（毫秒）
    struct tm tm = {
        .tm_year = year - 1900,
        .tm_mon = month - 1,
        .tm_mday = day,
        .tm_hour = hour,
        .tm_min = min,
        .tm_sec = sec,
        .tm_isdst = 0
    };
    time_t seconds = timegm(&tm);
    return (long long)seconds * 1000 + millis;
}

// 批量转换文件
void convert_file(const char *input_file, const char *output_file, const char *ref_line) {
    FILE *in = fopen(input_file, "r");
    FILE *out = fopen(output_file, "w");

    if (!in || !out) {
        fprintf(stderr, "无法打开文件\n");
        if (in) fclose(in);
        if (out) fclose(out);
        return;
    }

    // 解析并设置参考点
    long long boot_time = parse_boot_time(ref_line);
    long long utc_ms = parse_android_time(ref_line);

    g_references = (ReferencePoint *)malloc(sizeof(ReferencePoint));
    g_references[0].boot_time = boot_time;
    g_references[0].utc_timestamp = utc_ms;
    g_reference_count = 1;

    printf("使用参考点: boot_time=%lld, utc_time=%lld\n", boot_time, utc_ms);

    char line[4096];
    int line_count = 0;
    int converted_count = 0;

    while (fgets(line, sizeof(line), in)) {
        // 移除换行符
        line[strcspn(line, "\r\n")] = 0;

        // 跳过空行
        if (strlen(line) == 0) {
            fprintf(out, "\n");
            continue;
        }

        line_count++;

        // 转换行
        char *result = convert_line_simple(line);

        // 写入输出
        fprintf(out, "%s\n", result);

        if (result != line) {
            converted_count++;
        }

        // 每10000行显示进度
        if (line_count % 10000 == 0) {
            printf("已处理 %d 行...\n", line_count);
        }
    }

    fclose(in);
    fclose(out);

    printf("转换完成！共处理 %d 行，转换 %d 行\n", line_count, converted_count);
    printf("输出文件: %s\n", output_file);
}

int main(int argc, char *argv[]) {
    if (argc < 2) {
        printf("用法:\n");
        printf("  单行转换: %s \"<日志行>\"\n", argv[0]);
        printf("  文件转换: %s -f <输入文件> <输出文件> <参考点行>\n", argv[0]);
        printf("\n");
        printf("示例:\n");
        printf("  %s \"3,249007,1343494861,-,caller=T949;test\"\n", argv[0]);
        printf("  %s -f input.log output.log \"12,254242,1368588833,-,caller=T2415;android time 2025-07-01 08:21:59.64011\"\n", argv[0]);
        return 1;
    }

    // 文件批量转换模式
    if (strcmp(argv[1], "-f") == 0) {
        if (argc < 5) {
            fprintf(stderr, "文件转换模式需要3个参数: 输入文件 输出文件 参考点行\n");
            return 1;
        }
        convert_file(argv[2], argv[3], argv[4]);
        return 0;
    }

    // 单行转换模式
    const char *input = argv[1];

    // 从第一个参数解析参考点（如果包含android time）
    if (strstr(input, "android time")) {
        long long boot_time = parse_boot_time(input);
        long long utc_ms = parse_android_time(input);

        printf("检测到android time参考点行\n");
        printf("  boot_time: %lld 微秒\n", boot_time);
        printf("  utc_time: %lld 毫秒 (%s)\n", utc_ms, ctime(&((time_t){utc_ms/1000})));

        // 设置参考点（直接设置，不通过数组）
        g_references = (ReferencePoint *)malloc(sizeof(ReferencePoint));
        g_references[0].boot_time = boot_time;
        g_references[0].utc_timestamp = utc_ms;
        g_reference_count = 1;
    } else {
        // 使用默认参考点（从日志中提取的）
        // android time 2025-07-01 08:21:59.64011 = 1719822119640 ms
        // boot_time: 1368588833 ns = 1368588 us
        unsigned int test_refs[] = {
            1368588, 0,  // boot_time (64位)
            0x9ae8e7e0, 0x00000190,  // utc_time (1719822119640 ms)
        };
        set_reference_points(test_refs, 1);
    }

    printf("输入: %s\n", input);
    printf("参考点数量: %d\n", g_reference_count);
    if (g_reference_count > 0) {
        printf("参考点[0]: boot_time=%lld, utc_time=%lld\n",
               g_references[0].boot_time, g_references[0].utc_timestamp);
    }

    // 解析 boot time
    long long boot_time_parsed = parse_boot_time(input);
    printf("解析的 boot_time: %lld 微秒\n", boot_time_parsed);

    // 计算 UTC 时间
    long long utc_ms_calc = interpolate_utc_time(boot_time_parsed);
    printf("计算的 utc_ms: %lld 毫秒\n", utc_ms_calc);

    if (utc_ms_calc > 0) {
        time_t seconds = utc_ms_calc / 1000;
        printf("UTC时间: %s", ctime(&seconds));
    }

    // 转换行
    char *result = convert_line_simple(input);
    printf("输出: %s\n", result);

    // 清理
    cleanup_reference_points();

    return 0;
}
#endif
