<div align="center">

# ViLog

### Visor de Logs Profesional de Alto Rendimiento

**Un visor de logs de escritorio construido con Electron, diseñado para la velocidad. Maneja archivos de registro de millones de líneas con facilidad.**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-green.svg)]()
[![Electron](https://img.shields.io/badge/Electron-28%2B-blue.svg)](https://www.electronjs.org/)

---

**Language / Idioma / 语言 / 언어 / 言語 / Язык / Langue / Sprache / Língua / لغة**

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

Si alguna vez abriste un archivo de log de 500MB en un editor de texto y lo viste congelarse, ViLog es para ti. Construido desde cero para el **analisis de logs a escala**, combina renderizado Canvas con aceleracion GPU, Web Workers multihilo y optimizaciones a nivel de algoritmo (Aho-Corasick, WASM) para ofrecer filtrado instantaneo y desplazamiento fluido en archivos de millones de lineas.

## Caracteristicas

### Rendimiento Vertiginoso

| Caracteristica | Detalle |
|----------------|---------|
| **Renderizado Canvas** | Visualizacion de logs acelerada por GPU en lugar de nodos DOM — maneja millones de lineas sin esfuerzo |
| **Desplazamiento Virtual** | Solo se renderizan las lineas visibles. Desplazate por 10M+ lineas sin retraso |
| **Filtrado Multihilo** | Web Workers paralelos distribuyen el filtrado entre nucleos de CPU |
| **Algoritmo Aho-Corasick** | Coincidencia de multiples patrones en tiempo O(n+z) — filtra 10+ palabras clave simultaneamente |
| **Busqueda WebAssembly** | Rendimiento de coincidencia de cadenas cercano al nativo mediante modulos WASM |
| **Filtro Hibrido Inteligente** | Selecciona automaticamente entre ripgrep (archivos grandes) y JS Workers (archivos pequenos) |
| **Cache de Datos de Lineas** | El filtrado repetido del mismo archivo omite la transferencia de datos — solo se envian palabras clave a los Workers |

### Filtrado y Busqueda Poderosos

- **Filtrado multi-palabra clave** — Separa palabras clave con `|`, escapa pipes literales con `\|`
- **Soporte de expresiones regulares** — Regex completo de JavaScript en filtro y busqueda
- **Filtrado de dos niveles** — Filtro primario + filtro secundario dentro de resultados
- **Historial de filtros** — Historial persistente de palabras clave con coincidencia difusa (basado en IndexedDB)
- **Resaltado de palabras clave** — 10 colores predefinidos + selector de color personalizado
- **Exclusion de lineas** — Clic derecho para excluir lineas coincidentes de los resultados
- **Navegacion de busqueda** — Enter/Shift+Enter para saltar entre coincidencias

### Gestion de Archivos

- **Barra lateral de arbol de archivos** — Arrastra y suelta archivos, carpetas o archivos comprimidos
- **Navegacion de archivos comprimidos** — ZIP, 7z, RAR, tar.gz — explora contenidos sin extraer
- **Servidor de archivos remoto** — Conectate a maquinas remotas via servidor HTTP C integrado (pool de hilos, alta concurrencia)
- **Compartir local** — Comparte directorios locales con companeros de equipo via LAN
- **Pegar del portapapeles** — Pega archivos directamente con Ctrl+V
- **Vista de tabla CSV/TSV** — Analiza y muestra datos estructurados en tablas ordenables
- **Integracion con Everything** — Busqueda instantanea de archivos en Windows via Everything HTTP API
- **Integracion con Ripgrep** — Busqueda de texto en archivos grandes 20-100x mas rapida

### Visualizacion de Datos

- **Graficos CSV** — Graficos de lineas interactivos con zoom, pan y seleccion de columnas
- **Parser Vlog** — Parser especializado para logs de diagnostico de bateria/dispositivo (21 campos) con visualizacion
- **Selector de columnas** — Mantener o eliminar columnas especificas en la vista de tabla
- **Exportacion** — Copiar resultados filtrados o exportar como HTML

### Espacio de Trabajo y Productividad

- **Ventanas multiples** — Abre multiples archivos de log en ventanas separadas, cambia con Alt+1~9
- **Marcadores** — Marca lineas importantes y navega entre ellas
- **Ir a linea** — Salta instantaneamente a cualquier numero de linea
- **Enlaces rapidos** — Marcadores de sitios web frecuentes (panel web integrado)
- **Asistente IA** — Panel de chat IA integrado para asistencia en analisis de logs
- **Log UART serial** — Ventana de monitoreo de logs de puerto serial
- **Escalado de fuente** — Ctrl+Scroll para zoom, Alt+Scroll para desplazamiento horizontal
- **Monitoreo del sistema** — Visualizacion en tiempo real de CPU, memoria y memoria de la app
- **Terminal integrada** — Abre terminal directamente desde la aplicacion

### Atajos de Teclado

| Atajo | Accion |
|-------|--------|
| `F` | Enfocar caja de filtro de la barra |
| `f` | Abrir dialogo de filtro |
| `Ctrl+F` | Enfocar caja de busqueda |
| `Ctrl+H` | Alternar panel de resultados de filtro |
| `Ctrl+G` | Alternar arbol de archivos flotante |
| `Shift+W` | Alternar maximizacion del panel de filtro |
| `Alt+X` | Alternar pantalla completa |
| `Alt+1~9` | Cambiar a ventana N |
| `Ctrl+Tab` | Ciclar entre ventanas |
| `Ctrl+Shift+T` | Nueva ventana |
| `Ctrl+Scroll` | Zoom de fuente |
| `Alt+Scroll` | Scroll horizontal |

## Arquitectura

```
ViLog/
├── jscode/                          # Aplicacion Electron
│   ├── main.js                      # Proceso principal (gestion de ventanas, I/O de archivos, IPC)
│   ├── preload.js                   # Script de precarga (puente API seguro)
│   ├── index.html                   # UI de la ventana principal
│   ├── renderer/
│   │   ├── css/style.css            # Estilos de la aplicacion
│   │   └── js/
│   │       ├── core/                # Bus de eventos, gestion de estado, ayudantes DOM
│   │       ├── features/            # Modulos de funciones (filtro, busqueda, marcadores, etc.)
│   │       ├── workers/             # Workers del renderer (parser CSV, estadisticas, constructor de indices)
│   │       └── utils/               # Constantes, ayudantes, gestor de workers
│   ├── workers/                     # Workers independientes (WASM timestamp, escaner de directorios)
│   ├── icons/                       # Iconos de la aplicacion
│   └── package.json                 # Manifiesto del paquete Node.js
├── server/
│   └── log_server.c                 # Servidor HTTP C de alto rendimiento (pool de hilos, epoll)
├── docs/                            # Documentacion y recursos
└── LICENSE                          # Licencia MIT
```

### Stack Tecnologico

| Componente | Tecnologia |
|-----------|-----------|
| Framework | Electron 28+ |
| Renderizado | Canvas API (aceleracion GPU) |
| Multihilo | Web Workers (filtrado paralelo) |
| Busqueda nativa | WebAssembly (compilado desde C) |
| Coincidencia multi-patron | Algoritmo Aho-Corasick |
| Busqueda externa | ripgrep, Everything SDK |
| Servidor remoto | C + pthread (32 hilos, 4096 conexiones) |
| Parseo de datos | PapaParse (CSV), parser Vlog personalizado |
| Visualizacion | Chart.js + plugin de zoom |
| Almacenamiento | IndexedDB (historial de filtros, marcadores) |

## Inicio Rapido

### Requisitos Previos

- [Node.js](https://nodejs.org/) 18+
- [Electron](https://www.electronjs.org/) 28+
- (Opcional) [7-Zip](https://www.7-zip.org/) para navegacion de archivos comprimidos
- (Opcional) [ripgrep](https://github.com/BurntSushi/ripgrep) para busqueda acelerada
- (Opcional) [Everything](https://www.voidtools.com/) para busqueda instantanea de archivos en Windows

### Instalacion y Ejecucion

```bash
# Clonar el repositorio
git clone https://github.com/ranxuefeng2022/ViLog.git
cd ViLog

# Instalar dependencias
cd jscode
npm install

# Iniciar la aplicacion
npm start
```

### Compilar el Servidor C (Opcional — para navegacion remota de archivos)

```bash
cd server
gcc -o log_server log_server.c -lpthread -O2 -D_GNU_SOURCE

# Ejecutar en el puerto 8082
./log_server 8082 /ruta/a/logs
```

## Benchmarks de Rendimiento

| Escenario | Lineas | Tamano | Tiempo de Filtrado | FPS de Scroll |
|-----------|--------|--------|-------------------|---------------|
| Archivo unico | 1M | 200MB | ~0.3s | 60 |
| Filtro multi-palabra (5 palabras) | 1M | 200MB | ~0.5s | 60 |
| 10 archivos combinados | 5M | 1GB | ~1.2s | 60 |
| Modo hibrido Ripgrep | 5M | 1GB | ~0.2s | 60 |

*Entorno de prueba: Intel i7-12700, 32GB RAM, NVMe SSD. Los resultados pueden variar.*

## Casos de Uso

- **Desarrollo embebido/IoT** — Analisis de logs de dispositivos, diagnosticos de bateria (formato vlog)
- **Administracion de servidores** — Explorar logs remotos via servidor HTTP integrado
- **QA/Testing** — Comparacion de logs multi-archivo con ventanas lado a lado
- **Desarrollo movil** — Analisis de Android logcat, logs del kernel, dmesg
- **Analisis de datos** — Parseo CSV/TSV con visualizacion de graficos interactivos

## Contribuir

Las contribuciones son bienvenidas! Ya sean reportes de bugs, solicitudes de funciones o Pull Requests — toda contribucion ayuda.

1. Haz fork del repositorio
2. Crea tu rama de funcion (`git checkout -b feature/amazing-feature`)
3. Haz commit de tus cambios (`git commit -m 'Add amazing feature'`)
4. Push a la rama (`git push origin feature/amazing-feature`)
5. Abre un Pull Request

## Licencia

Este proyecto esta licenciado bajo la Licencia MIT — ver el archivo [LICENSE](LICENSE) para mas detalles.


## Apoya el Proyecto

Si ViLog te ayuda en tu trabajo, considera apoyar el proyecto:

<div align="center">

<img src="docs/buy_me_a_coffee.jpg" width="200" alt="Buy Me a Coffee" />

</div>

Si encuentras ViLog util, considera darle una estrella ⭐ — ayuda a otros a descubrir el proyecto!

---

<div align="center">

**ViLog — Rapido. Potente. Profesional.**

</div>

