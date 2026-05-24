<div align="center">

# ViLog

### Visualizador de Logs Profissional de Alta Performance

**Um visualizador de logs para desktop construido com Electron, projetado para velocidade. Manipule arquivos de log com milhoes de linhas com facilidade.**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-green.svg)]()
[![Electron](https://img.shields.io/badge/Electron-28%2B-blue.svg)](https://www.electronjs.org/)

---

**Language / Lingua / 语言 / 언어 / 言語 / Язык / Idioma / Langue / Sprache / لغة**

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

## Por que ViLog?

Se voce ja abriu um arquivo de log de 500MB em um editor de texto e viu ele travar, ViLog e para voce. Construido do zero para **analise de logs em grande escala**, combina renderizacao Canvas com aceleracao GPU, Web Workers multi-thread e otimizacoes em nivel de algoritmo (Aho-Corasick, WASM) para entregar filtragem instantanea e rolagem suave em arquivos de milhoes de linhas.

## Funcionalidades

### Performance Absurda

| Funcionalidade | Detalhe |
|---------------|---------|
| **Renderizacao Canvas** | Exibicao de logs acelerada por GPU em vez de nos DOM — manipula milhoes de linhas sem esforco |
| **Rolagem Virtual** | Apenas as linhas visiveis sao renderizadas. Role por 10M+ linhas sem atraso |
| **Filtragem Multi-thread** | Web Workers paralelos distribuem a filtragem entre nucleos de CPU |
| **Algoritmo Aho-Corasick** | Correspondencia de multiplos padroes em tempo O(n+z) — filtra 10+ palavras-chave simultaneamente |
| **Busca WebAssembly** | Performance de correspondencia de strings proxima a nativa atraves de modulos WASM |
| **Filtro Hibrido Inteligente** | Seleciona automaticamente entre ripgrep (arquivos grandes) e JS Workers (arquivos pequenos) |
| **Cache de Dados de Linhas** | Filtragem repetida do mesmo arquivo pula a transferencia de dados — apenas palavras-chave sao enviadas aos Workers |

### Filtragem e Busca Poderosas

- **Filtragem multi-palavras-chave** — Separe palavras-chave com `|`, escape pipes literais com `\|`
- **Suporte a expressoes regulares** — Regex JavaScript completo no filtro e busca
- **Filtragem de dois niveis** — Filtro primario + filtro secundario nos resultados
- **Historico de filtros** — Historico persistente de palavras-chave com correspondencia fuzzy (baseado em IndexedDB)
- **Destaque de palavras-chave** — 10 cores predefinidas + seletor de cor personalizado
- **Exclusao de linhas** — Clique direito para excluir linhas correspondentes dos resultados
- **Navegacao de busca** — Enter/Shift+Enter para pular entre correspondencias

### Gerenciamento de Arquivos

- **Barra lateral de arvore de arquivos** — Arraste e solte arquivos, pastas ou arquivos compactados
- **Navegacao de arquivos compactados** — ZIP, 7z, RAR, tar.gz — explore conteudos sem extrair
- **Servidor de arquivos remoto** — Conecte-se a maquinas remotas via servidor HTTP C integrado (pool de threads, alta concorrencia)
- **Compartilhamento local** — Compartilhe diretorios locais com colegas de equipe via LAN
- **Colar da area de transferencia** — Cole arquivos diretamente com Ctrl+V
- **Visualizacao de tabela CSV/TSV** — Analise e exiba dados estruturados em tabelas classificaveis
- **Integracao com Everything** — Busca instantanea de arquivos no Windows via Everything HTTP API
- **Integracao com Ripgrep** — Busca de texto em arquivos grandes 20-100x mais rapida

### Visualizacao de Dados

- **Plotagem de graficos CSV** — Graficos de linha interativos com zoom, pan e selecao de colunas
- **Parser Vlog** — Parser especializado para logs de diagnostico de bateria/dispositivo (21 campos) com visualizacao
- **Seletor de colunas** — Manter ou remover colunas especificas na visualizacao de tabela
- **Exportacao** — Copiar resultados filtrados ou exportar como HTML

### Espaco de Trabalho e Produtividade

- **Multi-janela** — Abra multiplos arquivos de log em janelas separadas, alterne com Alt+1~9
- **Marcadores** — Marque linhas importantes e navegue entre elas
- **Ir para linha** — Pule instantaneamente para qualquer numero de linha
- **Links rapidos** — Marcadores de sites frequentes (painel web integrado)
- **Assistente de IA** — Painel de chat IA integrado para assistencia na analise de logs
- **Log UART serial** — Janela de monitoramento de logs de porta serial
- **Escala de fonte** — Ctrl+Scroll para zoom, Alt+Scroll para rolagem horizontal
- **Monitoramento do sistema** — Exibicao em tempo real de CPU, memoria e memoria do app
- **Terminal integrado** — Abra o terminal diretamente do aplicativo

### Atalhos de Teclado

| Atalho | Acao |
|--------|------|
| `F` | Focar na caixa de filtro da barra de ferramentas |
| `f` | Abrir dialogo de filtro |
| `Ctrl+F` | Focar na caixa de busca |
| `Ctrl+H` | Alternar painel de resultados do filtro |
| `Ctrl+G` | Alternar arvore de arquivos flutuante |
| `Shift+W` | Alternar maximizacao do painel de filtro |
| `Alt+X` | Alternar tela cheia |
| `Alt+1~9` | Mudar para janela N |
| `Ctrl+Tab` | Ciclar entre janelas |
| `Ctrl+Shift+T` | Nova janela |
| `Ctrl+Scroll` | Zoom da fonte |
| `Alt+Scroll` | Scroll horizontal |

## Arquitetura

```
ViLog/
├── jscode/                          # Aplicacao Electron
│   ├── main.js                      # Processo principal (gerenciamento de janelas, I/O de arquivos, IPC)
│   ├── preload.js                   # Script de preload (ponte de API segura)
│   ├── index.html                   # UI da janela principal
│   ├── renderer/
│   │   ├── css/style.css            # Estilos da aplicacao
│   │   └── js/
│   │       ├── core/                # Barramento de eventos, gerenciamento de estado, ajudantes DOM
│   │       ├── features/            # Modulos de funcionalidades (filtro, busca, marcadores, etc.)
│   │       ├── workers/             # Workers do renderer (parser CSV, estatisticas, construtor de indices)
│   │       └── utils/               # Constantes, ajudantes, gerenciador de workers
│   ├── workers/                     # Workers independentes (timestamp WASM, scanner de diretorios)
│   ├── icons/                       # Icones da aplicacao
│   └── package.json                 # Manifesto do pacote Node.js
├── server/
│   └── log_server.c                 # Servidor HTTP C de alta performance (pool de threads, epoll)
├── docs/                            # Documentacao e recursos
└── LICENSE                          # Licenca MIT
```

### Stack Tecnologico

| Componente | Tecnologia |
|-----------|-----------|
| Framework | Electron 28+ |
| Renderizacao | Canvas API (aceleracao GPU) |
| Multi-threading | Web Workers (filtragem paralela) |
| Busca nativa | WebAssembly (compilado de C) |
| Correspondencia multi-padrao | Algoritmo Aho-Corasick |
| Busca externa | ripgrep, Everything SDK |
| Servidor remoto | C + pthread (32 threads, 4096 conexoes) |
| Parseamento de dados | PapaParse (CSV), parser Vlog personalizado |
| Visualizacao | Chart.js + plugin de zoom |
| Armazenamento | IndexedDB (historico de filtros, marcadores) |

## Inicio Rapido

### Pre-requisitos

- [Node.js](https://nodejs.org/) 18+
- [Electron](https://www.electronjs.org/) 28+
- (Opcional) [7-Zip](https://www.7-zip.org/) para navegacao de arquivos compactados
- (Opcional) [ripgrep](https://github.com/BurntSushi/ripgrep) para busca acelerada
- (Opcional) [Everything](https://www.voidtools.com/) para busca instantanea de arquivos no Windows

### Instalacao e Execucao

```bash
# Clonar o repositorio
git clone https://github.com/ranxuefeng2022/ViLog.git
cd ViLog

# Instalar dependencias
cd jscode
npm install

# Iniciar a aplicacao
npm start
```

### Compilar o Servidor C (Opcional — para navegacao remota de arquivos)

```bash
cd server
gcc -o log_server log_server.c -lpthread -O2 -D_GNU_SOURCE

# Executar na porta 8082
./log_server 8082 /caminho/para/logs
```

## Benchmarks de Performance

| Cenario | Linhas | Tamanho do Arquivo | Tempo de Filtragem | FPS de Scroll |
|---------|--------|-------------------|-------------------|---------------|
| Arquivo unico | 1M | 200MB | ~0.3s | 60 |
| Filtro multi-palavra (5 palavras) | 1M | 200MB | ~0.5s | 60 |
| 10 arquivos combinados | 5M | 1GB | ~1.2s | 60 |
| Modo hibrido Ripgrep | 5M | 1GB | ~0.2s | 60 |

*Ambiente de teste: Intel i7-12700, 32GB RAM, NVMe SSD. Resultados podem variar.*

## Casos de Uso

- **Desenvolvimento embarcado/IoT** — Analise de logs de dispositivos, diagnostico de bateria (formato vlog)
- **Administracao de servidores** — Navegar logs remotos via servidor HTTP integrado
- **QA/Testes** — Comparacao de logs multi-arquivo com janelas lado a lado
- **Desenvolvimento mobile** — Analise de Android logcat, logs de kernel, dmesg
- **Analise de dados** — Parseamento CSV/TSV com visualizacao interativa de graficos

## Contribuir

Contribuicoes sao bem-vindas! Sejam relatorios de bugs, solicitacoes de funcionalidades ou Pull Requests — toda contribuicao ajuda.

1. Faca fork do repositorio
2. Crie sua branch de funcionalidade (`git checkout -b feature/amazing-feature`)
3. Commite suas mudancas (`git commit -m 'Add amazing feature'`)
4. Push para a branch (`git push origin feature/amazing-feature`)
5. Abra um Pull Request

## Licenca

Este projeto esta licenciado sob a Licenca MIT — veja o arquivo [LICENSE](LICENSE) para detalhes.


## Apoie o Projeto

Se o ViLog ajuda no seu fluxo de trabalho, considere apoiar o projeto:

<div align="center">

<img src="docs/buy_me_a_coffee.jpg" width="200" alt="Buy Me a Coffee" />

</div>

Se voce acha o ViLog util, considere dar uma estrela ⭐ — ajuda outros a descobrirem o projeto!

---

<div align="center">

**ViLog — Rapido. Poderoso. Profissional.**

</div>

