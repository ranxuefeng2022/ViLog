<div align="center">

# ViLog

### プロフェッショナル高性能ログビューア

**Electronで構築されたデスクトップログビューア、スピードのために設計。数百万行のログファイルを簡単に処理。**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-green.svg)]()
[![Electron](https://img.shields.io/badge/Electron-28%2B-blue.svg)](https://www.electronjs.org/)

---

**Language / 言語 / 언어 / Язык / Idioma / Langue / Sprache / Língua / لغة**

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

## なぜ ViLog なのか？

500MB のログファイルをテキストエディタで開いてフリーズするのを経験したことがありますか？ViLog はそんな問題を解決するために生まれました。**大規模ログ分析**のためにゼロから設計され、GPU アクセラレーション Canvas レンダリング、マルチスレッド Web Worker、アルゴリズムレベルの最適化（Aho-Corasick、WASM）を組み合わせ、数百万行ファイルで瞬時のフィルタリングとスムーズなスクロールを実現します。

## 機能

### 圧倒的なパフォーマンス

| 機能 | 説明 |
|------|------|
| **Canvas レンダリング** | DOM ノードの代わりに GPU 加速ログ表示 — 数百万行を軽快に処理 |
| **仮想スクロール** | 表示行のみレンダリング。1000万行以上も遅延ゼロでスクロール |
| **マルチスレッドフィルタリング** | 並列 Web Worker がフィルタリングを CPU コアに分散 |
| **Aho-Corasick アルゴリズム** | O(n+z) 時間計算量のマルチパターンマッチング — 10以上のキーワードを同時フィルタリング |
| **WebAssembly 検索** | WASM モジュールによるネイティブに近い文字列マッチング性能 |
| **ハイブリッドスマートフィルター** | ファイルサイズに応じて ripgrep（大容量）と JS Worker（小容量）を自動選択 |
| **行データキャッシュ** | 同一ファイルの繰り返しフィルタリングでデータ転送をスキップ — キーワードのみ Worker に送信 |

### 強力なフィルタリングと検索

- **マルチキーワードフィルタリング** — `|`でキーワード区切り、`\|`でリテラルパイプをエスケープ
- **正規表現サポート** — フィルターと検索の両方で完全な JavaScript 正規表現を使用可能
- **二段階フィルタリング** — プライマリフィルター + 結果内セカンダリフィルター
- **フィルター履歴** — ファジーマッチング付きの永続キーワード履歴（IndexedDB ベース）
- **キーワードハイライト** — 10色のプリセット + カスタムカラーピッカー
- **行除外** — 右クリックでマッチする行を結果から除外
- **検索ナビゲーション** — Enter/Shift+Enter でマッチ間をジャンプ

### ファイル管理

- **ファイルツリーサイドバー** — ファイル、フォルダ、アーカイブを直接ドラッグ＆ドロップ
- **アーカイブブラウジング** — ZIP、7z、RAR、tar.gz — 展開せずに内容を閲覧
- **リモートファイルサーバー** — 内蔵 C 言語 HTTP サーバーでリモートマシンに接続（スレッドプール、高同時接続）
- **ローカル共有** — LAN 経由でチームメンバーとローカルディレクトリを共有
- **クリップボード貼り付け** — Ctrl+V でファイルを直接貼り付け
- **CSV/TSV テーブルビュー** — 構造化データをソート可能なテーブルで解析・表示
- **Everything 連携** — Everything HTTP API による Windows 即時ファイル検索
- **Ripgrep 連携** — 大容量ファイルのテキスト検索が 20-100倍高速化

### データ可視化

- **CSV チャートプロット** — ズーム、パン、列選択機能付きインタラクティブ折れ線グラフ
- **Vlog パーサー** — バッテリー/デバイス診断ログ用専用パーサー（21フィールド）と可視化
- **列セレクター** — テーブルビューで特定の列を保持または削除
- **エクスポート** — フィルター結果のコピーまたは HTML エクスポート

### ワークスペースと生産性

- **マルチウィンドウ** — 別のウィンドウで複数のログファイルを開き、Alt+1~9 で切り替え
- **ブックマーク** — 重要な行をマークしてジャンプ
- **行ジャンプ** — 任意の行番号に即座にジャンプ
- **クイックリンク** — よく使うウェブサイトのブックマーク（内蔵ウェブパネル）
- **AI アシスタント** — ログ分析支援の内蔵 AI チャットパネル
- **UART シリアルログ** — シリアルポートログ監視ウィンドウ
- **フォントズーム** — Ctrl+スクロールでズーム、Alt+スクロールで水平移動
- **システムモニタリング** — リアルタイム CPU、メモリ、アプリメモリ表示
- **内蔵ターミナル** — アプリから直接ターミナルを開く

### キーボードショートカット

| ショートカット | アクション |
|---------------|-----------|
| `F` | ツールバーフィルターボックスにフォーカス |
| `f` | フィルターダイアログを開く |
| `Ctrl+F` | 検索ボックスにフォーカス |
| `Ctrl+H` | フィルター結果パネルの切替 |
| `Ctrl+G` | フローティングファイルツリーの切替 |
| `Shift+W` | フィルターパネル最大化の切替 |
| `Alt+X` | フルスクリーン切替 |
| `Alt+1~9` | ウィンドウ N に切り替え |
| `Ctrl+Tab` | ウィンドウ巡回 |
| `Ctrl+Shift+T` | 新規ウィンドウ |
| `Ctrl+スクロール` | フォントズーム |
| `Alt+スクロール` | 水平スクロール |

## アーキテクチャ

```
ViLog/
├── jscode/                          # Electron アプリケーション
│   ├── main.js                      # メインプロセス（ウィンドウ管理、ファイルI/O、IPC）
│   ├── preload.js                   # プリロードスクリプト（セキュアAPIブリッジ）
│   ├── index.html                   # メインウィンドウUI
│   ├── renderer/
│   │   ├── css/style.css            # アプリケーションスタイル
│   │   └── js/
│   │       ├── core/                # イベントバス、状態管理、DOMヘルパー
│   │       ├── features/            # 機能モジュール（フィルター、検索、ブックマーク等）
│   │       ├── workers/             # レンダラー内ワーカー（CSVパーサー、統計、インデックスビルダー）
│   │       └── utils/               # 定数、ヘルパー、ワーカーマネージャー
│   ├── workers/                     # 独立ワーカー（WASMタイムスタンプ、ディレクトリスキャナー）
│   ├── icons/                       # アプリケーションアイコン
│   └── package.json                 # Node.js パッケージマニフェスト
├── server/
│   └── log_server.c                 # 高性能 C HTTP サーバー（スレッドプール、epoll）
├── docs/                            # ドキュメントとアセット
└── LICENSE                          # MIT ライセンス
```

### 技術スタック

| コンポーネント | 技術 |
|---------------|------|
| フレームワーク | Electron 28+ |
| レンダリング | Canvas API（GPU アクセラレーション） |
| マルチスレッド | Web Workers（並列フィルタリング） |
| ネイティブ検索 | WebAssembly（C コンパイル） |
| マルチパターンマッチング | Aho-Corasick アルゴリズム |
| 外部検索 | ripgrep、Everything SDK |
| リモートサーバー | C + pthread スレッドプール（32スレッド、4096接続） |
| データ解析 | PapaParse（CSV）、カスタム Vlog パーサー |
| 可視化 | Chart.js + ズームプラグイン |
| ストレージ | IndexedDB（フィルター履歴、ブックマーク） |

## はじめに

### 前提条件

- [Node.js](https://nodejs.org/) 18+
- [Electron](https://www.electronjs.org/) 28+
- (オプション) [7-Zip](https://www.7-zip.org/) アーカイブブラウジング用
- (オプション) [ripgrep](https://github.com/BurntSushi/ripgrep) 高速検索用
- (オプション) [Everything](https://www.voidtools.com/) Windows 即時ファイル検索用

### インストールと実行

```bash
# リポジトリをクローン
git clone https://github.com/ranxuefeng2022/ViLog.git
cd ViLog

# 依存関係をインストール
cd jscode
npm install

# アプリケーションを起動
npm start
```

### C サーバーのビルド（オプション — リモートファイルブラウジング用）

```bash
cd server
gcc -o log_server log_server.c -lpthread -O2 -D_GNU_SOURCE

# ポート 8082 で実行
./log_server 8082 /path/to/logs
```

## パフォーマンスベンチマーク

| シナリオ | 行数 | ファイルサイズ | フィルタリング時間 | スクロール FPS |
|----------|------|---------------|-------------------|---------------|
| 単一ファイル | 100万 | 200MB | ~0.3秒 | 60 |
| マルチキーワード（5キーワード） | 100万 | 200MB | ~0.5秒 | 60 |
| 10ファイル統合 | 500万 | 1GB | ~1.2秒 | 60 |
| Ripgrep ハイブリッドモード | 500万 | 1GB | ~0.2秒 | 60 |

*テスト環境：Intel i7-12700, 32GB RAM, NVMe SSD。結果は異なる場合があります。*

## ユースケース

- **組み込み/IoT 開発** — デバイスログ、バッテリー診断の分析（vlog 形式）
- **サーバー管理** — 内蔵 HTTP サーバーでリモートログを閲覧
- **QA/テスト** — サイドバイサイドウィンドウでマルチファイルログを比較
- **モバイル開発** — Android logcat、カーネルログ、dmesg 分析
- **データ分析** — CSV/TSV パーシングとインタラクティブチャート可視化

## コントリビュート

コントリビュートを歓迎します！バグレポート、機能リクエスト、Pull Request など、どんな貢献でも役立ちます。

1. リポジトリをフォーク
2. フィーチャーブランチを作成 (`git checkout -b feature/amazing-feature`)
3. 変更をコミット (`git commit -m 'Add amazing feature'`)
4. ブランチにプッシュ (`git push origin feature/amazing-feature`)
5. Pull Request を作成

## ライセンス

このプロジェクトは MIT ライセンスの下でライセンスされています — [LICENSE](LICENSE) ファイルを参照してください。


## プロジェクトを支援する

ViLog がお役に立ちましたら、ご支援をお願いします：

<div align="center">

<img src="docs/buy_me_a_coffee.jpg" width="200" alt="Buy Me a Coffee" />

</div>

ViLog が便利だと思われましたら、Star ⭐ をお願いします — 他の方にもこのプロジェクトを見つけてもらいやすくなります！

---

<div align="center">

**ViLog — 高速、強力、プロフェッショナル**

</div>

