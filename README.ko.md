<div align="center">

# ViLog

### 전문 고성능 로그 뷰어

**Electron으로 구축된 데스크톱 로그 뷰어, 속도를 위해 설계됨. 수백만 줄의 로그 파일을 쉽게 처리하세요.**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-green.svg)]()
[![Electron](https://img.shields.io/badge/Electron-28%2B-blue.svg)](https://www.electronjs.org/)

---

**Language / 언어 / 言語 / Язык / Idioma / Langue / Sprache / Língua / لغة**

[![English](https://img.shields.io/badge/English-✓-blue.svg)](README.md)
[![中文](https://img.shields.io/badge/中文-✓-red.svg)](README.zh-CN.md)
[![日本語](https://img.shields.io/badge/日本語-✓-white.svg)](README.ja.md)
[![한국어](https://img.shields.io/badge/한국어-✓-blue.svg)](README.ko.md)
[![Русский](https://img.shields.io/badge/Русский-✓-orange.svg)](README.ru.md)
[![Español](https://img.shields.io/badge/Español-✓-yellow.svg)](README.es.md)
[![Français](https://img.shields.io/badge/Français-✓-purple.svg)](README.fr.md)
[![Deutsch](https://img.shields.io/badge/Deutsch-✓-darkgreen.svg)](README.de.md)
[![Português](https://img.shields.io/badge/Português-✓-brightgreen.svg)](README.pt-BR.md)
[![العربية](https://img.shields.io/badge/العربية-✓-teal.svg)](README.ar.md)

</div>

---

## 왜 ViLog인가?

500MB 로그 파일을 텍스트 에디터에서 열어보고 멈추는 것을 경험해 보셨나요? ViLog은 바로 그런 문제를 해결하기 위해 탄생했습니다. **대규모 로그 분석**을 위해 처음부터 설계되었으며, GPU 가속 Canvas 렌더링, 멀티스레드 Web Worker, 그리고 알고리즘 수준의 최적화(Aho-Corasick, WASM)를 결합하여 수백만 줄 파일에서 즉각적인 필터링과 부드러운 스크롤링을 제공합니다.

## 주요 기능

### 압도적인 성능

| 기능 | 설명 |
|------|------|
| **Canvas 렌더링** | DOM 노드 대신 GPU 가속 로그 표시 — 수백만 줄을 거뜬히 처리 |
| **가상 스크롤링** | 보이는 줄만 렌더링. 1천만 줄 이상도 지연 없이 스크롤 |
| **멀티스레드 필터링** | 병렬 Web Worker가 필터링 작업을 CPU 코어에 분산 |
| **Aho-Corasick 알고리즘** | O(n+z) 시간 복잡도의 다중 패턴 매칭 — 10개 이상 키워드 동시 필터링 |
| **WebAssembly 검색** | WASM 모듈을 통한 네이티브 수준의 문자열 매칭 성능 |
| **하이브리드 스마트 필터** | 파일 크기에 따라 ripgrep(대용량)과 JS Worker(소용량) 자동 선택 |
| **행 데이터 캐싱** | 동일 파일 반복 필터링 시 데이터 전송 생략 — 키워드만 Worker에 전송 |

### 강력한 필터링 및 검색

- **다중 키워드 필터링** — `|`로 키워드 구분, `\|`로 리터럴 파이프 이스케이프
- **정규식 지원** — 필터 및 검색에서 완전한 JavaScript 정규식 사용 가능
- **2단계 필터링** — 기본 필터 + 결과 내 2차 필터링
- **필터 기록** — 퍼지 매칭이 포함된 영구 키워드 기록 (IndexedDB 기반)
- **키워드 하이라이트** — 10가지 기본 색상 + 커스텀 색상 선택기
- **행 제외** — 우클릭으로 매칭되는 행을 결과에서 제외
- **검색 탐색** — Enter/Shift+Enter로 매치 간 이동

### 파일 관리

- **파일 트리 사이드바** — 파일, 폴더, 아카이브를 직접 드래그 앤 드롭
- **아카이브 브라우징** — ZIP, 7z, RAR, tar.gz — 압축 해제 없이 내용 탐색
- **원격 파일 서버** — 내장 C HTTP 서버로 원격 머신 연결 (스레드 풀, 고동시성)
- **로컬 공유** — LAN을 통해 팀원과 로컬 디렉토리 공유
- **클립보드 붙여넣기** — Ctrl+V로 파일 직접 붙여넣기
- **CSV/TSV 테이블 뷰** — 정형 데이터를 정렬 가능한 테이블로 파싱 및 표시
- **Everything 연동** — Everything HTTP API를 통한 Windows 즉시 파일 검색
- **Ripgrep 연동** — 대용량 파일 텍스트 검색 20-100배 향상

### 데이터 시각화

- **CSV 차트 플롯팅** — 줌, 팬, 열 선택 기능이 있는 인터랙티브 라인 차트
- **Vlog 파서** — 배터리/기기 진단 로그용 전용 파서 (21개 필드) 및 시각화
- **열 선택기** — 테이블 뷰에서 특정 열 유지 또는 제거
- **내보내기** — 필터링된 결과 복사 또는 HTML로 내보내기

### 작업 공간 및 생산성

- **멀티 윈도우** — 별도의 창에서 여러 로그 파일 열기, Alt+1~9로 전환
- **북마크** — 중요한 줄 표시 및 이동
- **줄 이동** — 임의의 줄 번호로 즉시 이동
- **빠른 링크** — 자주 사용하는 웹사이트 북마크 (내장 웹 패널)
- **AI 어시스턴트** — 로그 분석을 위한 내장 AI 채팅 패널
- **UART 시리얼 로그** — 시리얼 포트 로그 모니터링 창
- **글꼴 확대/축소** — Ctrl+스크롤로 확대, Alt+스크롤로 수평 이동
- **시스템 모니터링** — 실시간 CPU, 메모리 및 앱 메모리 표시
- **내장 터미널** — 앱에서 바로 터미널 열기

### 키보드 단축키

| 단축키 | 동작 |
|--------|------|
| `F` | 툴바 필터 박스 포커스 |
| `f` | 필터 대화상자 열기 |
| `Ctrl+F` | 검색 박스 포커스 |
| `Ctrl+H` | 필터 결과 패널 토글 |
| `Ctrl+G` | 플로팅 파일 트리 토글 |
| `Shift+W` | 필터 패널 최대화 토글 |
| `Alt+X` | 전체화면 토글 |
| `Alt+1~9` | 창 N으로 전환 |
| `Ctrl+Tab` | 창 순환 |
| `Ctrl+Shift+T` | 새 창 |
| `Ctrl+스크롤` | 글꼴 확대/축소 |
| `Alt+스크롤` | 수평 스크롤 |

## 아키텍처

```
ViLog/
├── jscode/                          # Electron 애플리케이션
│   ├── main.js                      # 메인 프로세스 (창 관리, 파일 I/O, IPC)
│   ├── preload.js                   # 프리로드 스크립트 (보안 API 브릿지)
│   ├── index.html                   # 메인 창 UI
│   ├── renderer/
│   │   ├── css/style.css            # 애플리케이션 스타일
│   │   └── js/
│   │       ├── core/                # 이벤트 버스, 상태 관리, DOM 헬퍼
│   │       ├── features/            # 기능 모듈 (필터, 검색, 북마크 등)
│   │       ├── workers/             # 렌더러 내 워커 (CSV 파서, 통계, 인덱스 빌더)
│   │       └── utils/               # 상수, 헬퍼, 워커 매니저
│   ├── workers/                     # 독립 워커 (WASM 타임스탬프, 디렉토리 스캐너)
│   ├── icons/                       # 애플리케이션 아이콘
│   └── package.json                 # Node.js 패키지 매니페스트
├── server/
│   └── log_server.c                 # 고성능 C HTTP 서버 (스레드 풀, epoll)
├── docs/                            # 문서 및 에셋
└── LICENSE                          # MIT 라이선스
```

### 기술 스택

| 구성 요소 | 기술 |
|-----------|------|
| 프레임워크 | Electron 28+ |
| 렌더링 | Canvas API (GPU 가속) |
| 멀티스레딩 | Web Workers (병렬 필터링) |
| 네이티브 검색 | WebAssembly (C 컴파일) |
| 다중 패턴 매칭 | Aho-Corasick 알고리즘 |
| 외부 검색 | ripgrep, Everything SDK |
| 원격 서버 | C + pthread 스레드 풀 (32스레드, 4096연결) |
| 데이터 파싱 | PapaParse (CSV), 커스텀 Vlog 파서 |
| 시각화 | Chart.js + 줌 플러그인 |
| 저장소 | IndexedDB (필터 기록, 북마크) |

## 시작하기

### 필수 조건

- [Node.js](https://nodejs.org/) 18+
- [Electron](https://www.electronjs.org/) 28+
- (선택) [7-Zip](https://www.7-zip.org/) 아카이브 브라우징용
- (선택) [ripgrep](https://github.com/BurntSushi/ripgrep) 가속 검색용
- (선택) [Everything](https://www.voidtools.com/) Windows 즉시 파일 검색용

### 설치 및 실행

```bash
# 저장소 클론
git clone https://github.com/ranxuefeng2022/ViLog.git
cd ViLog

# 의존성 설치
cd jscode
npm install

# 애플리케이션 실행
npm start
```

### C 서버 빌드 (선택 — 원격 파일 브라우징용)

```bash
cd server
gcc -o log_server log_server.c -lpthread -O2 -D_GNU_SOURCE

# 포트 8082에서 실행
./log_server 8082 /path/to/logs
```

## 성능 벤치마크

| 시나리오 | 줄 수 | 파일 크기 | 필터링 시간 | 스크롤 FPS |
|----------|-------|-----------|-------------|------------|
| 단일 파일 | 100만 | 200MB | ~0.3초 | 60 |
| 다중 키워드 필터 (5개 키워드) | 100만 | 200MB | ~0.5초 | 60 |
| 10개 파일 병합 | 500만 | 1GB | ~1.2초 | 60 |
| Ripgrep 하이브리드 모드 | 500만 | 1GB | ~0.2초 | 60 |

*테스트 환경: Intel i7-12700, 32GB RAM, NVMe SSD. 결과는 다를 수 있습니다.*

## 활용 사례

- **임베디드/IoT 개발** — 장치 로그, 배터리 진단 분석 (vlog 형식)
- **서버 관리** — 내장 HTTP 서버로 원격 로그 탐색
- **QA/테스트** — 나란히 창으로 다중 파일 로그 비교
- **모바일 개발** — Android logcat, 커널 로그, dmesg 분석
- **데이터 분석** — CSV/TSV 파싱과 인터랙티브 차트 시각화

## 기여

기여를 환영합니다! 버그 리포트, 기능 요청, Pull Request 모두 도움이 됩니다.

1. 저장소를 Fork
2. 기능 브랜치 생성 (`git checkout -b feature/amazing-feature`)
3. 변경사항 커밋 (`git commit -m 'Add amazing feature'`)
4. 브랜치에 푸시 (`git push origin feature/amazing-feature`)
5. Pull Request 생성

## 라이선스

이 프로젝트는 MIT 라이선스에 따라 라이선스가 부여됩니다 — [LICENSE](LICENSE) 파일을 참조하세요.

## 프로젝트 후원

ViLog이 도움이 되셨다면 후원을 고려해 주세요:

<div align="center">

<img src="docs/buy_me_a_coffee.jpg" width="200" alt="Buy Me a Coffee" />

</div>

ViLog이 유용하시다면 Star ⭐를 부탁드립니다 — 더 많은 사람들이 이 프로젝트를 발견할 수 있도록 도와주세요!

---

<div align="center">

**ViLog — 빠르고, 강력하고, 전문적**

</div>
