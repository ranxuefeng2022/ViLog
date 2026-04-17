/**
 * 日志文件查看器 HTTP 服务端 - 高并发优化版
 * 
 * 功能：
 * 1. 接收客户端请求的目录路径，返回目录树结构（JSON格式）
 * 2. 接收客户端请求的文件路径，返回文件内容
 * 3. 使用线程池处理高并发请求
 * 4. 稳定性优化，防止 core dump
 * 
 * 编译命令：
 *   gcc -o engine engine.c -lpthread -O2 -D_GNU_SOURCE
 * 
 * 运行命令：
 *   ./engine [端口号] [基础目录]
 *   例如: ./engine 8080 /home/user/logs
 * 
 * API:
 *   GET /api/tree?path=<目录路径>   - 获取目录树
 *   GET /api/file?path=<文件路径>   - 获取文件内容
 *   GET /health                      - 健康检查（用于状态指示灯）
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <arpa/inet.h>
#include <pthread.h>
#include <dirent.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <errno.h>
#include <signal.h>
#include <ctype.h>
#include <time.h>
#include <sys/time.h>
#include <stdatomic.h>
#include <limits.h>

/* ============== 配置参数 ============== */
#define DEFAULT_PORT 8082
#define MAX_PATH_LEN 4096
#define BUFFER_SIZE 65536
#define MAX_FILE_SIZE (100 * 1024 * 1024)  // 100MB 最大文件大小
#define THREAD_POOL_SIZE 32                 // 线程池大小
#define REQUEST_QUEUE_SIZE 1024             // 请求队列大小
#define MAX_CONNECTIONS 4096                // 最大连接数
#define READ_TIMEOUT_SEC 30                 // 读取超时（秒）
#define WRITE_TIMEOUT_SEC 60                // 写入超时（秒）
#define MAX_REQUEST_SIZE (1024 * 1024)      // 最大请求大小 1MB
#define MAX_HEADER_SIZE 8192                // 最大请求头大小
#define MAX_TREE_DEPTH 20                   // 最大目录递归深度
#define MAX_ENTRIES_PER_DIR 2048            // 每个目录最大条目数
#define HEALTH_CHECK_INTERVAL 5             // 健康检查间隔（秒）

/* ============== 全局变量 ============== */
static char g_base_dir[MAX_PATH_LEN] = ".";
static volatile sig_atomic_t g_running = 1;
static atomic_ulong g_request_count = 0;
static atomic_ulong g_active_connections = 0;
static atomic_ulong g_error_count = 0;
static time_t g_start_time = 0;

/* ============== 线程池结构 ============== */
typedef struct {
    int client_fd;
    struct sockaddr_in client_addr;
    time_t accept_time;
} client_request_t;

typedef struct {
    client_request_t *requests;
    int head;
    int tail;
    int count;
    int capacity;
    pthread_mutex_t mutex;
    pthread_cond_t not_empty;
    pthread_cond_t not_full;
    int shutdown;
} request_queue_t;

typedef struct {
    pthread_t *threads;
    int thread_count;
    request_queue_t *queue;
} thread_pool_t;

static thread_pool_t *g_thread_pool = NULL;

/* ============== 安全内存操作 ============== */

// 安全的 malloc，带有空值检查
static void *safe_malloc(size_t size) {
    if (size == 0 || size > (size_t)1024 * 1024 * 1024) {  // 最大 1GB
        return NULL;
    }
    void *ptr = malloc(size);
    if (ptr) {
        memset(ptr, 0, size);
    }
    return ptr;
}

// 安全的 realloc
static void *safe_realloc(void *ptr, size_t old_size, size_t new_size) {
    if (new_size == 0 || new_size > (size_t)1024 * 1024 * 1024) {
        return NULL;
    }
    void *new_ptr = realloc(ptr, new_size);
    if (new_ptr && new_size > old_size) {
        memset((char *)new_ptr + old_size, 0, new_size - old_size);
    }
    return new_ptr;
}

// 安全的 strdup
static char *safe_strdup(const char *s) {
    if (!s) return NULL;
    size_t len = strlen(s);
    if (len > MAX_PATH_LEN * 4) return NULL;
    char *dup = safe_malloc(len + 1);
    if (dup) {
        memcpy(dup, s, len + 1);
    }
    return dup;
}

// 安全的字符串拷贝
static void safe_strcpy(char *dst, size_t dst_size, const char *src) {
    if (!dst || dst_size == 0) return;
    if (!src) {
        dst[0] = '\0';
        return;
    }
    size_t src_len = strlen(src);
    size_t copy_len = (src_len < dst_size - 1) ? src_len : dst_size - 1;
    memcpy(dst, src, copy_len);
    dst[copy_len] = '\0';
}

/* ============== 请求队列操作 ============== */

static request_queue_t *queue_create(int capacity) {
    request_queue_t *q = safe_malloc(sizeof(request_queue_t));
    if (!q) return NULL;
    
    q->requests = safe_malloc(sizeof(client_request_t) * capacity);
    if (!q->requests) {
        free(q);
        return NULL;
    }
    
    q->head = 0;
    q->tail = 0;
    q->count = 0;
    q->capacity = capacity;
    q->shutdown = 0;
    
    if (pthread_mutex_init(&q->mutex, NULL) != 0) {
        free(q->requests);
        free(q);
        return NULL;
    }
    
    if (pthread_cond_init(&q->not_empty, NULL) != 0) {
        pthread_mutex_destroy(&q->mutex);
        free(q->requests);
        free(q);
        return NULL;
    }
    
    if (pthread_cond_init(&q->not_full, NULL) != 0) {
        pthread_cond_destroy(&q->not_empty);
        pthread_mutex_destroy(&q->mutex);
        free(q->requests);
        free(q);
        return NULL;
    }
    
    return q;
}

static void queue_destroy(request_queue_t *q) {
    if (!q) return;
    
    pthread_mutex_lock(&q->mutex);
    q->shutdown = 1;
    pthread_cond_broadcast(&q->not_empty);
    pthread_cond_broadcast(&q->not_full);
    pthread_mutex_unlock(&q->mutex);
    
    pthread_cond_destroy(&q->not_empty);
    pthread_cond_destroy(&q->not_full);
    pthread_mutex_destroy(&q->mutex);
    free(q->requests);
    free(q);
}

static int queue_push(request_queue_t *q, client_request_t *req) {
    if (!q || !req) return -1;
    
    pthread_mutex_lock(&q->mutex);
    
    // 等待队列有空位
    while (q->count >= q->capacity && !q->shutdown) {
        // 超时等待，避免死锁
        struct timespec ts;
        clock_gettime(CLOCK_REALTIME, &ts);
        ts.tv_sec += 1;
        int rc = pthread_cond_timedwait(&q->not_full, &q->mutex, &ts);
        if (rc == ETIMEDOUT) {
            pthread_mutex_unlock(&q->mutex);
            return -1;  // 队列满且超时
        }
    }
    
    if (q->shutdown) {
        pthread_mutex_unlock(&q->mutex);
        return -1;
    }
    
    q->requests[q->tail] = *req;
    q->tail = (q->tail + 1) % q->capacity;
    q->count++;
    
    pthread_cond_signal(&q->not_empty);
    pthread_mutex_unlock(&q->mutex);
    
    return 0;
}

static int queue_pop(request_queue_t *q, client_request_t *req) {
    if (!q || !req) return -1;
    
    pthread_mutex_lock(&q->mutex);
    
    while (q->count == 0 && !q->shutdown) {
        // 超时等待，定期检查 shutdown 标志
        struct timespec ts;
        clock_gettime(CLOCK_REALTIME, &ts);
        ts.tv_sec += 1;
        pthread_cond_timedwait(&q->not_empty, &q->mutex, &ts);
    }
    
    if (q->shutdown && q->count == 0) {
        pthread_mutex_unlock(&q->mutex);
        return -1;
    }
    
    *req = q->requests[q->head];
    q->head = (q->head + 1) % q->capacity;
    q->count--;
    
    pthread_cond_signal(&q->not_full);
    pthread_mutex_unlock(&q->mutex);
    
    return 0;
}

/* ============== URL 解码函数 ============== */
static int url_decode(char *dst, size_t dst_size, const char *src) {
    if (!dst || !src || dst_size == 0) return -1;
    
    size_t i = 0;
    while (*src && i < dst_size - 1) {
        if (*src == '%') {
            if (src[1] && src[2] && isxdigit((unsigned char)src[1]) && isxdigit((unsigned char)src[2])) {
                unsigned char a = src[1];
                unsigned char b = src[2];
                
                if (a >= 'a') a -= 'a' - 10;
                else if (a >= 'A') a -= 'A' - 10;
                else a -= '0';
                
                if (b >= 'a') b -= 'a' - 10;
                else if (b >= 'A') b -= 'A' - 10;
                else b -= '0';
                
                dst[i++] = (char)(16 * a + b);
                src += 3;
            } else {
                dst[i++] = *src++;
            }
        } else if (*src == '+') {
            dst[i++] = ' ';
            src++;
        } else {
            dst[i++] = *src++;
        }
    }
    dst[i] = '\0';
    return 0;
}

/* ============== JSON 字符串转义 ============== */
static int json_escape(char *dst, size_t dst_size, const char *src) {
    if (!dst || !src || dst_size < 2) return -1;
    
    size_t i = 0;
    while (*src && i < dst_size - 2) {
        switch (*src) {
            case '"':  if (i + 2 >= dst_size) goto end; dst[i++] = '\\'; dst[i++] = '"'; break;
            case '\\': if (i + 2 >= dst_size) goto end; dst[i++] = '\\'; dst[i++] = '\\'; break;
            case '\b': if (i + 2 >= dst_size) goto end; dst[i++] = '\\'; dst[i++] = 'b'; break;
            case '\f': if (i + 2 >= dst_size) goto end; dst[i++] = '\\'; dst[i++] = 'f'; break;
            case '\n': if (i + 2 >= dst_size) goto end; dst[i++] = '\\'; dst[i++] = 'n'; break;
            case '\r': if (i + 2 >= dst_size) goto end; dst[i++] = '\\'; dst[i++] = 'r'; break;
            case '\t': if (i + 2 >= dst_size) goto end; dst[i++] = '\\'; dst[i++] = 't'; break;
            default:
                if ((unsigned char)*src < 0x20) {
                    if (i + 6 >= dst_size) goto end;
                    int n = snprintf(dst + i, dst_size - i, "\\u%04x", (unsigned char)*src);
                    if (n > 0) i += n;
                } else {
                    dst[i++] = *src;
                }
                break;
        }
        src++;
    }
end:
    dst[i] = '\0';
    return 0;
}

/* ============== 安全路径检查 ============== */
static int is_safe_path(const char *path) {
    if (!path) return 0;
    if (path[0] == '\0') return 1;  // 空路径是安全的（表示基础目录）
    if (strstr(path, "..") != NULL) return 0;  // 禁止 ..
    if (path[0] == '/') return 0;  // 禁止绝对路径
    if (strstr(path, "//") != NULL) return 0;  // 禁止双斜杠
    
    // 检查路径长度
    if (strlen(path) > MAX_PATH_LEN - 256) return 0;
    
    return 1;
}

/* ============== Socket 操作辅助函数 ============== */

// 设置 socket 超时
static int set_socket_timeout(int fd, int recv_timeout_sec, int send_timeout_sec) {
    struct timeval tv;
    
    tv.tv_sec = recv_timeout_sec;
    tv.tv_usec = 0;
    if (setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv)) < 0) {
        return -1;
    }
    
    tv.tv_sec = send_timeout_sec;
    tv.tv_usec = 0;
    if (setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv)) < 0) {
        return -1;
    }
    
    return 0;
}

// 安全的写入函数（处理部分写入）
static ssize_t safe_write(int fd, const void *buf, size_t count) {
    if (fd < 0 || !buf || count == 0) return -1;
    
    const char *ptr = buf;
    size_t remaining = count;
    
    while (remaining > 0) {
        ssize_t n = write(fd, ptr, remaining);
        if (n < 0) {
            if (errno == EINTR) continue;
            if (errno == EAGAIN || errno == EWOULDBLOCK) {
                usleep(1000);
                continue;
            }
            return -1;
        }
        if (n == 0) break;
        ptr += n;
        remaining -= n;
    }
    
    return count - remaining;
}

// 安全的读取函数
static ssize_t safe_read(int fd, void *buf, size_t count) {
    if (fd < 0 || !buf || count == 0) return -1;
    
    char *ptr = buf;
    size_t total = 0;
    
    while (total < count) {
        ssize_t n = read(fd, ptr + total, count - total);
        if (n < 0) {
            if (errno == EINTR) continue;
            if (errno == EAGAIN || errno == EWOULDBLOCK) break;
            return -1;
        }
        if (n == 0) break;  // EOF
        total += n;
        
        // 检查是否读到请求结束
        if (total >= 4 && memcmp(ptr + total - 4, "\r\n\r\n", 4) == 0) {
            break;
        }
    }
    
    return total;
}

/* ============== HTTP 响应函数 ============== */

static int send_response_header(int client_fd, int status_code, const char *status_text,
                                const char *content_type, long content_length) {
    if (client_fd < 0 || !status_text || !content_type) return -1;
    
    char header[2048];
    int len = snprintf(header, sizeof(header),
        "HTTP/1.1 %d %s\r\n"
        "Content-Type: %s; charset=utf-8\r\n"
        "Access-Control-Allow-Origin: *\r\n"
        "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
        "Access-Control-Allow-Headers: Content-Type\r\n"
        "Cache-Control: no-cache, no-store, must-revalidate\r\n"
        "Connection: close\r\n",
        status_code, status_text, content_type);
    
    if (len < 0 || len >= (int)sizeof(header) - 64) return -1;
    
    if (content_length >= 0) {
        len += snprintf(header + len, sizeof(header) - len,
            "Content-Length: %ld\r\n", content_length);
    }
    
    len += snprintf(header + len, sizeof(header) - len, "\r\n");
    
    return safe_write(client_fd, header, len) > 0 ? 0 : -1;
}

static int send_error_response(int client_fd, int status_code, const char *status_text, const char *message) {
    if (client_fd < 0 || !status_text || !message) return -1;
    
    char escaped_msg[512];
    json_escape(escaped_msg, sizeof(escaped_msg), message);
    
    char body[1024];
    int body_len = snprintf(body, sizeof(body),
        "{\"error\":true,\"code\":%d,\"message\":\"%s\"}", status_code, escaped_msg);
    
    if (body_len < 0 || body_len >= (int)sizeof(body)) {
        body_len = snprintf(body, sizeof(body), "{\"error\":true,\"code\":%d}", status_code);
    }
    
    if (send_response_header(client_fd, status_code, status_text, "application/json", body_len) < 0) {
        return -1;
    }
    
    return safe_write(client_fd, body, body_len) > 0 ? 0 : -1;
}

/* ============== 目录树生成 ============== */

typedef struct {
    char *buffer;
    size_t size;
    size_t capacity;
} string_builder_t;

static string_builder_t *sb_create(size_t initial_capacity) {
    string_builder_t *sb = safe_malloc(sizeof(string_builder_t));
    if (!sb) return NULL;
    
    sb->buffer = safe_malloc(initial_capacity);
    if (!sb->buffer) {
        free(sb);
        return NULL;
    }
    
    sb->size = 0;
    sb->capacity = initial_capacity;
    sb->buffer[0] = '\0';
    return sb;
}

static void sb_destroy(string_builder_t *sb) {
    if (sb) {
        free(sb->buffer);
        free(sb);
    }
}

static int sb_ensure_capacity(string_builder_t *sb, size_t additional) {
    if (!sb) return -1;
    
    size_t needed = sb->size + additional + 1;
    if (needed <= sb->capacity) return 0;
    
    size_t new_capacity = sb->capacity * 2;
    while (new_capacity < needed) {
        new_capacity *= 2;
        if (new_capacity > 256 * 1024 * 1024) {  // 最大 256MB
            return -1;
        }
    }
    
    char *new_buffer = safe_realloc(sb->buffer, sb->capacity, new_capacity);
    if (!new_buffer) return -1;
    
    sb->buffer = new_buffer;
    sb->capacity = new_capacity;
    return 0;
}

static int sb_append(string_builder_t *sb, const char *str) {
    if (!sb || !str) return -1;
    
    size_t len = strlen(str);
    if (sb_ensure_capacity(sb, len) < 0) return -1;
    
    memcpy(sb->buffer + sb->size, str, len + 1);
    sb->size += len;
    return 0;
}

static int sb_append_len(string_builder_t *sb, const char *str, size_t len) {
    if (!sb || !str) return -1;
    
    if (sb_ensure_capacity(sb, len) < 0) return -1;
    
    memcpy(sb->buffer + sb->size, str, len);
    sb->size += len;
    sb->buffer[sb->size] = '\0';
    return 0;
}

// 目录条目结构
typedef struct {
    char name[256];
    int is_dir;
    long size;
} dir_entry_t;

// 自然排序比较函数（类似 sort -V）
// 将数字部分按数值大小比较，而不是字符串比较
static int natural_compare(const char *a, const char *b) {
    if (!a && !b) return 0;
    if (!a) return -1;
    if (!b) return 1;
    
    const char *pa = a;
    const char *pb = b;
    
    while (*pa && *pb) {
        // 如果两个都是数字，按数值大小比较
        if (isdigit((unsigned char)*pa) && isdigit((unsigned char)*pb)) {
            // 读取数字部分并转换为数值
            // 对于文件名，数字通常不会很大，使用 long long 足够
            long long num_a = 0, num_b = 0;
            
            // 读取数字部分
            while (isdigit((unsigned char)*pa)) {
                num_a = num_a * 10 + (*pa - '0');
                pa++;
            }
            while (isdigit((unsigned char)*pb)) {
                num_b = num_b * 10 + (*pb - '0');
                pb++;
            }
            
            // 按数值比较
            if (num_a != num_b) {
                return (num_a < num_b) ? -1 : 1;
            }
        } else {
            // 至少有一个不是数字，进行不区分大小写的字符比较
            char ca = tolower((unsigned char)*pa);
            char cb = tolower((unsigned char)*pb);
            if (ca != cb) {
                return ca - cb;
            }
            pa++;
            pb++;
        }
    }
    
    // 一个字符串结束
    if (*pa) return 1;
    if (*pb) return -1;
    return 0;
}

// 比较函数用于排序
static int compare_entries(const void *a, const void *b) {
    const dir_entry_t *ea = a;
    const dir_entry_t *eb = b;
    
    // 文件夹在前
    if (ea->is_dir != eb->is_dir) {
        return eb->is_dir - ea->is_dir;
    }
    
    // 按名称自然排序（类似 sort -V）
    return natural_compare(ea->name, eb->name);
}

// 递归获取目录树
static int get_directory_tree_recursive(string_builder_t *sb, const char *dir_path, int depth) {
    if (!sb || !dir_path) return -1;
    if (depth > MAX_TREE_DEPTH) {
        sb_append(sb, "[]");
        return 0;
    }
    
    DIR *dir = opendir(dir_path);
    if (!dir) {
        sb_append(sb, "[]");
        return 0;
    }
    
    // 收集目录条目
    dir_entry_t *entries = safe_malloc(sizeof(dir_entry_t) * MAX_ENTRIES_PER_DIR);
    if (!entries) {
        closedir(dir);
        sb_append(sb, "[]");
        return -1;
    }
    
    int entry_count = 0;
    struct dirent *entry;
    
    while ((entry = readdir(dir)) != NULL && entry_count < MAX_ENTRIES_PER_DIR) {
        // 跳过 . 和 ..
        if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0) {
            continue;
        }
        
        // 跳过隐藏文件
        if (entry->d_name[0] == '.') {
            continue;
        }
        
        char full_path[MAX_PATH_LEN];
        int n = snprintf(full_path, sizeof(full_path), "%s/%s", dir_path, entry->d_name);
        if (n < 0 || n >= (int)sizeof(full_path)) {
            continue;
        }
        
        struct stat st;
        if (stat(full_path, &st) != 0) {
            continue;
        }
        
        safe_strcpy(entries[entry_count].name, sizeof(entries[entry_count].name), entry->d_name);
        entries[entry_count].is_dir = S_ISDIR(st.st_mode);
        entries[entry_count].size = S_ISREG(st.st_mode) ? st.st_size : 0;
        entry_count++;
    }
    closedir(dir);
    
    // 排序
    if (entry_count > 1) {
        qsort(entries, entry_count, sizeof(dir_entry_t), compare_entries);
    }
    
    // 生成 JSON
    sb_append(sb, "[");
    
    for (int i = 0; i < entry_count; i++) {
        if (i > 0) sb_append(sb, ",");
        
        char full_path[MAX_PATH_LEN];
        snprintf(full_path, sizeof(full_path), "%s/%s", dir_path, entries[i].name);
        
        // 计算相对路径
        const char *relative_path = full_path;
        size_t base_len = strlen(g_base_dir);
        if (strncmp(full_path, g_base_dir, base_len) == 0) {
            relative_path = full_path + base_len;
            if (*relative_path == '/') relative_path++;
        }
        
        char escaped_name[512];
        char escaped_path[MAX_PATH_LEN * 2];
        json_escape(escaped_name, sizeof(escaped_name), entries[i].name);
        json_escape(escaped_path, sizeof(escaped_path), relative_path);
        
        if (entries[i].is_dir) {
            char header[MAX_PATH_LEN * 3];
            snprintf(header, sizeof(header),
                "{\"name\":\"%s\",\"path\":\"%s\",\"type\":\"folder\",\"children\":",
                escaped_name, escaped_path);
            sb_append(sb, header);
            
            get_directory_tree_recursive(sb, full_path, depth + 1);
            sb_append(sb, "}");
        } else {
            char item[MAX_PATH_LEN * 3];
            snprintf(item, sizeof(item),
                "{\"name\":\"%s\",\"path\":\"%s\",\"type\":\"file\",\"size\":%ld}",
                escaped_name, escaped_path, entries[i].size);
            sb_append(sb, item);
        }
    }
    
    sb_append(sb, "]");
    
    free(entries);
    return 0;
}

/* ============== 请求处理函数 ============== */

static void handle_tree_request(int client_fd, const char *path) {
    char decoded_path[MAX_PATH_LEN];
    if (url_decode(decoded_path, sizeof(decoded_path), path ? path : "") < 0) {
        send_error_response(client_fd, 400, "Bad Request", "Invalid path encoding");
        return;
    }
    
    // 构建完整路径
    char full_path[MAX_PATH_LEN];
    if (decoded_path[0] == '\0') {
        safe_strcpy(full_path, sizeof(full_path), g_base_dir);
    } else {
        if (!is_safe_path(decoded_path)) {
            send_error_response(client_fd, 403, "Forbidden", "Invalid path");
            return;
        }
        snprintf(full_path, sizeof(full_path), "%s/%s", g_base_dir, decoded_path);
    }
    
    // 检查目录存在
    struct stat st;
    if (stat(full_path, &st) != 0 || !S_ISDIR(st.st_mode)) {
        send_error_response(client_fd, 404, "Not Found", "Directory not found");
        return;
    }
    
    // 获取目录树
    string_builder_t *sb = sb_create(65536);
    if (!sb) {
        send_error_response(client_fd, 500, "Internal Server Error", "Memory allocation failed");
        return;
    }
    
    // 构建响应
    char escaped_path[MAX_PATH_LEN * 2];
    json_escape(escaped_path, sizeof(escaped_path), decoded_path);
    
    char header[MAX_PATH_LEN * 3];
    snprintf(header, sizeof(header), "{\"success\":true,\"path\":\"%s\",\"tree\":", escaped_path);
    sb_append(sb, header);
    
    get_directory_tree_recursive(sb, full_path, 0);
    
    sb_append(sb, "}");
    
    // 发送响应
    send_response_header(client_fd, 200, "OK", "application/json", sb->size);
    safe_write(client_fd, sb->buffer, sb->size);
    
    sb_destroy(sb);
}

static void handle_file_request(int client_fd, const char *path) {
    if (!path || *path == '\0') {
        send_error_response(client_fd, 400, "Bad Request", "Missing path parameter");
        return;
    }
    
    char decoded_path[MAX_PATH_LEN];
    if (url_decode(decoded_path, sizeof(decoded_path), path) < 0) {
        send_error_response(client_fd, 400, "Bad Request", "Invalid path encoding");
        return;
    }
    
    if (!is_safe_path(decoded_path)) {
        send_error_response(client_fd, 403, "Forbidden", "Invalid path");
        return;
    }
    
    char full_path[MAX_PATH_LEN];
    snprintf(full_path, sizeof(full_path), "%s/%s", g_base_dir, decoded_path);
    
    // 检查文件
    struct stat st;
    if (stat(full_path, &st) != 0) {
        send_error_response(client_fd, 404, "Not Found", "File not found");
        return;
    }
    
    if (!S_ISREG(st.st_mode)) {
        send_error_response(client_fd, 400, "Bad Request", "Not a regular file");
        return;
    }
    
    if (st.st_size > MAX_FILE_SIZE) {
        send_error_response(client_fd, 413, "Payload Too Large", "File too large");
        return;
    }
    
    // 打开文件
    int fd = open(full_path, O_RDONLY);
    if (fd < 0) {
        send_error_response(client_fd, 500, "Internal Server Error", "Cannot open file");
        return;
    }
    
    // 发送响应头
    if (send_response_header(client_fd, 200, "OK", "text/plain", st.st_size) < 0) {
        close(fd);
        return;
    }
    
    // 发送文件内容（使用较大的缓冲区提高效率）
    char *buffer = safe_malloc(BUFFER_SIZE);
    if (!buffer) {
        close(fd);
        return;
    }
    
    ssize_t bytes_read;
    while ((bytes_read = read(fd, buffer, BUFFER_SIZE)) > 0) {
        if (safe_write(client_fd, buffer, bytes_read) < 0) {
            break;
        }
    }
    
    free(buffer);
    close(fd);
}

static void handle_health_request(int client_fd) {
    time_t now = time(NULL);
    time_t uptime = now - g_start_time;
    
    char response[512];
    int len = snprintf(response, sizeof(response),
        "{\"status\":\"ok\",\"service\":\"log_server\","
        "\"uptime\":%ld,\"requests\":%lu,\"connections\":%lu,\"errors\":%lu}",
        uptime,
        atomic_load(&g_request_count),
        atomic_load(&g_active_connections),
        atomic_load(&g_error_count));
    
    send_response_header(client_fd, 200, "OK", "application/json", len);
    safe_write(client_fd, response, len);
}

/* ============== 查询参数解析 ============== */
static const char *get_query_param(const char *query, const char *name, char *value, size_t value_size) {
    if (!query || !name || !value || value_size == 0) return NULL;
    
    size_t name_len = strlen(name);
    const char *p = query;
    
    while ((p = strstr(p, name)) != NULL) {
        // 检查是否在参数开头
        if (p != query && *(p - 1) != '&' && *(p - 1) != '?') {
            p += name_len;
            continue;
        }
        
        // 检查后面是否是 =
        if (*(p + name_len) != '=') {
            p += name_len;
            continue;
        }
        
        // 提取值
        p += name_len + 1;
        size_t i = 0;
        while (*p && *p != '&' && i < value_size - 1) {
            value[i++] = *p++;
        }
        value[i] = '\0';
        return value;
    }
    
    return NULL;
}

/* ============== HTTP 请求处理 ============== */
static void process_request(int client_fd) {
    atomic_fetch_add(&g_active_connections, 1);
    atomic_fetch_add(&g_request_count, 1);
    
    // 设置 socket 超时
    set_socket_timeout(client_fd, READ_TIMEOUT_SEC, WRITE_TIMEOUT_SEC);
    
    // 读取请求
    char *buffer = safe_malloc(MAX_HEADER_SIZE + 1);
    if (!buffer) {
        send_error_response(client_fd, 500, "Internal Server Error", "Memory allocation failed");
        goto cleanup;
    }
    
    ssize_t bytes_read = safe_read(client_fd, buffer, MAX_HEADER_SIZE);
    if (bytes_read <= 0) {
        goto cleanup;
    }
    buffer[bytes_read] = '\0';
    
    // 解析请求行
    char method[16] = {0};
    char uri[MAX_PATH_LEN] = {0};
    char version[16] = {0};
    
    if (sscanf(buffer, "%15s %4095s %15s", method, uri, version) != 3) {
        send_error_response(client_fd, 400, "Bad Request", "Invalid request line");
        goto cleanup;
    }
    
    // 处理 OPTIONS (CORS 预检)
    if (strcmp(method, "OPTIONS") == 0) {
        send_response_header(client_fd, 204, "No Content", "text/plain", 0);
        goto cleanup;
    }
    
    // 只支持 GET
    if (strcmp(method, "GET") != 0) {
        send_error_response(client_fd, 405, "Method Not Allowed", "Only GET is supported");
        goto cleanup;
    }
    
    // 分离 URI 和查询字符串
    char *query = strchr(uri, '?');
    if (query) {
        *query++ = '\0';
    }
    
    // 路由请求
    char param_value[MAX_PATH_LEN];
    
    if (strcmp(uri, "/api/tree") == 0) {
        const char *path = get_query_param(query, "path", param_value, sizeof(param_value));
        handle_tree_request(client_fd, path);
    } else if (strcmp(uri, "/api/file") == 0) {
        const char *path = get_query_param(query, "path", param_value, sizeof(param_value));
        if (!path || *path == '\0') {
            send_error_response(client_fd, 400, "Bad Request", "Missing path parameter");
        } else {
            handle_file_request(client_fd, path);
        }
    } else if (strcmp(uri, "/") == 0 || strcmp(uri, "/health") == 0) {
        handle_health_request(client_fd);
    } else {
        send_error_response(client_fd, 404, "Not Found", "Endpoint not found");
    }
    
cleanup:
    free(buffer);
    atomic_fetch_sub(&g_active_connections, 1);
}

/* ============== 线程池工作线程 ============== */
static void *worker_thread(void *arg) {
    request_queue_t *queue = arg;
    if (!queue) return NULL;
    
    // 设置线程为可取消
    pthread_setcancelstate(PTHREAD_CANCEL_ENABLE, NULL);
    pthread_setcanceltype(PTHREAD_CANCEL_DEFERRED, NULL);
    
    while (1) {
        client_request_t req;
        
        if (queue_pop(queue, &req) < 0) {
            if (queue->shutdown) break;
            continue;
        }
        
        // 处理请求
        process_request(req.client_fd);
        close(req.client_fd);
    }
    
    return NULL;
}

/* ============== 线程池管理 ============== */
static thread_pool_t *thread_pool_create(int thread_count, int queue_size) {
    thread_pool_t *pool = safe_malloc(sizeof(thread_pool_t));
    if (!pool) return NULL;
    
    pool->threads = safe_malloc(sizeof(pthread_t) * thread_count);
    if (!pool->threads) {
        free(pool);
        return NULL;
    }
    
    pool->queue = queue_create(queue_size);
    if (!pool->queue) {
        free(pool->threads);
        free(pool);
        return NULL;
    }
    
    pool->thread_count = thread_count;
    
    // 创建工作线程
    for (int i = 0; i < thread_count; i++) {
        if (pthread_create(&pool->threads[i], NULL, worker_thread, pool->queue) != 0) {
            // 创建失败，清理已创建的线程
            pool->queue->shutdown = 1;
            pthread_cond_broadcast(&pool->queue->not_empty);
            for (int j = 0; j < i; j++) {
                pthread_join(pool->threads[j], NULL);
            }
            queue_destroy(pool->queue);
            free(pool->threads);
            free(pool);
            return NULL;
        }
    }
    
    return pool;
}

static void thread_pool_destroy(thread_pool_t *pool) {
    if (!pool) return;
    
    // 设置关闭标志
    pthread_mutex_lock(&pool->queue->mutex);
    pool->queue->shutdown = 1;
    pthread_cond_broadcast(&pool->queue->not_empty);
    pthread_cond_broadcast(&pool->queue->not_full);
    pthread_mutex_unlock(&pool->queue->mutex);
    
    // 等待所有线程结束
    for (int i = 0; i < pool->thread_count; i++) {
        pthread_join(pool->threads[i], NULL);
    }
    
    // 清理队列中剩余的连接
    while (pool->queue->count > 0) {
        client_request_t req;
        if (queue_pop(pool->queue, &req) == 0) {
            close(req.client_fd);
        }
    }
    
    queue_destroy(pool->queue);
    free(pool->threads);
    free(pool);
}

/* ============== 信号处理 ============== */
static void signal_handler(int sig) {
    (void)sig;
    g_running = 0;
}

static void setup_signals(void) {
    struct sigaction sa;
    memset(&sa, 0, sizeof(sa));
    sa.sa_handler = signal_handler;
    sigemptyset(&sa.sa_mask);
    sa.sa_flags = 0;
    
    sigaction(SIGINT, &sa, NULL);
    sigaction(SIGTERM, &sa, NULL);
    
    // 忽略 SIGPIPE
    sa.sa_handler = SIG_IGN;
    sigaction(SIGPIPE, &sa, NULL);
}

/* ============== 主函数 ============== */
int main(int argc, char *argv[]) {
    int port = DEFAULT_PORT;
    
    // 解析命令行参数
    if (argc >= 2) {
        port = atoi(argv[1]);
        if (port <= 0 || port > 65535) {
            fprintf(stderr, "无效的端口号: %s\n", argv[1]);
            return 1;
        }
    }
    
    if (argc >= 3) {
        if (realpath(argv[2], g_base_dir) == NULL) {
            fprintf(stderr, "无效的目录: %s (%s)\n", argv[2], strerror(errno));
            return 1;
        }
    } else {
        if (getcwd(g_base_dir, sizeof(g_base_dir)) == NULL) {
            fprintf(stderr, "无法获取当前目录: %s\n", strerror(errno));
            return 1;
        }
    }
    
    // 检查目录
    struct stat st;
    if (stat(g_base_dir, &st) != 0 || !S_ISDIR(st.st_mode)) {
        fprintf(stderr, "目录不存在或不是目录: %s\n", g_base_dir);
        return 1;
    }
    
    // 设置信号处理
    setup_signals();
    
    // 记录启动时间
    g_start_time = time(NULL);
    
    // 创建线程池
    g_thread_pool = thread_pool_create(THREAD_POOL_SIZE, REQUEST_QUEUE_SIZE);
    if (!g_thread_pool) {
        fprintf(stderr, "创建线程池失败\n");
        return 1;
    }
    
    // 创建套接字
    int server_fd = socket(AF_INET, SOCK_STREAM, 0);
    if (server_fd < 0) {
        perror("socket");
        thread_pool_destroy(g_thread_pool);
        return 1;
    }
    
    // 设置套接字选项
    int opt = 1;
    setsockopt(server_fd, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));
    setsockopt(server_fd, SOL_SOCKET, SO_REUSEPORT, &opt, sizeof(opt));
    
    // TCP 优化
    setsockopt(server_fd, IPPROTO_TCP, TCP_NODELAY, &opt, sizeof(opt));
    
    // 设置 accept 超时
    struct timeval tv;
    tv.tv_sec = 1;
    tv.tv_usec = 0;
    setsockopt(server_fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
    
    // 绑定地址
    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = INADDR_ANY;
    addr.sin_port = htons(port);
    
    if (bind(server_fd, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
        perror("bind");
        close(server_fd);
        thread_pool_destroy(g_thread_pool);
        return 1;
    }
    
    // 监听
    if (listen(server_fd, MAX_CONNECTIONS) < 0) {
        perror("listen");
        close(server_fd);
        thread_pool_destroy(g_thread_pool);
        return 1;
    }
    
    printf("========================================\n");
    printf("日志文件查看器 HTTP 服务端 (高并发版)\n");
    printf("========================================\n");
    printf("监听端口: %d\n", port);
    printf("基础目录: %s\n", g_base_dir);
    printf("线程池大小: %d\n", THREAD_POOL_SIZE);
    printf("请求队列大小: %d\n", REQUEST_QUEUE_SIZE);
    printf("API 端点:\n");
    printf("  GET /api/tree?path=<目录路径>  - 获取目录树\n");
    printf("  GET /api/file?path=<文件路径>  - 获取文件内容\n");
    printf("  GET /health                    - 健康检查\n");
    printf("========================================\n");
    printf("服务器已启动，按 Ctrl+C 停止\n\n");
    
    // 主循环
    while (g_running) {
        struct sockaddr_in client_addr;
        socklen_t client_len = sizeof(client_addr);
        
        int client_fd = accept(server_fd, (struct sockaddr *)&client_addr, &client_len);
        if (client_fd < 0) {
            if (errno == EAGAIN || errno == EWOULDBLOCK || errno == EINTR) {
                continue;
            }
            if (g_running) {
                atomic_fetch_add(&g_error_count, 1);
            }
            continue;
        }
        
        // 禁用 Nagle 算法以减少延迟
        int flag = 1;
        setsockopt(client_fd, IPPROTO_TCP, TCP_NODELAY, &flag, sizeof(flag));
        
        // 将请求加入队列
        client_request_t req = {
            .client_fd = client_fd,
            .client_addr = client_addr,
            .accept_time = time(NULL)
        };
        
        if (queue_push(g_thread_pool->queue, &req) < 0) {
            // 队列满，返回服务繁忙
            send_error_response(client_fd, 503, "Service Unavailable", "Server is busy");
            close(client_fd);
            atomic_fetch_add(&g_error_count, 1);
        }
    }
    
    printf("\n正在关闭服务器...\n");
    
    // 清理
    close(server_fd);
    thread_pool_destroy(g_thread_pool);
    
    printf("服务器已关闭\n");
    printf("统计信息: 总请求 %lu, 错误 %lu\n",
        atomic_load(&g_request_count), atomic_load(&g_error_count));
    
    return 0;
}
