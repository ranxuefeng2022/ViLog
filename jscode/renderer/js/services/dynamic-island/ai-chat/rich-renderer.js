/**
 * AI Agent — Rich Renderer
 *
 * 富展示渲染引擎，扩展 Markdown 输出能力:
 *   - highlight.js  → 代码语法高亮
 *   - Mermaid.js    → 流程图 / 时序图 / 甘特图等
 *   - KaTeX         → 数学公式渲染 ($...$ / $$...$$)
 *   - HTML Preview  → 沙盒 iframe 预览 AI 生成的网页
 *
 * 设计: 纯函数模块，零 DOM 依赖（previewHtml 除外），可单测
 * 降级: 每个库通过 typeof 检测，缺失时优雅回退到纯文本
 */
(function() {
  'use strict';

  window.App = window.App || {};
  window.App._DI = window.App._DI || {};

  window.App._DI.createRichRenderer = function() {

    /* ── Internal State ── */
    var _htmlStore = {};           // sid → html content (for preview)
    var _htmlStoreSeq = 0;         // sequence counter for store IDs
    var _mermaidSeq = 0;           // sequence counter for mermaid element IDs
    var _setupDone = false;

    /* ═══════════════════════════════════════════════════════════════
       Setup — configure marked + mermaid (call once)
       ═══════════════════════════════════════════════════════════════ */

    function setup() {
      if (_setupDone) return;
      if (typeof marked === 'undefined') {
        console.warn('[RichRenderer] marked not available, will retry');
        return;
      }

      // Init mermaid
      if (typeof mermaid !== 'undefined') {
        try {
          mermaid.initialize({
            startOnLoad: false,
            theme: 'default',
            securityLevel: 'strict'
          });
          console.log('[RichRenderer] mermaid initialized');
        } catch (e) {
          console.warn('[RichRenderer] mermaid init failed:', e.message);
        }
      }

      // Configure marked with custom renderer

      var renderer = new marked.Renderer();

      // Custom code block renderer
      renderer.code = function(code, lang) {
        lang = (lang || '').trim().toLowerCase();

        // Mermaid → placeholder container (postProcess renders SVG)
        if (lang === 'mermaid') {
          var id = 'di-mermaid-' + (++_mermaidSeq);
          return '<div class="di-ai-mermaid-wrap">'
            + '<div class="di-ai-mermaid" id="' + id + '">' + _esc(code) + '</div>'
            + '</div>';
        }

        // Syntax highlight with hljs
        var highlighted = _highlight(code, lang);

        // HTML/HTM → add preview button
        if (lang === 'html' || lang === 'htm') {
          var sid = 'html-' + (++_htmlStoreSeq);
          _htmlStore[sid] = code;
          return '<pre><code class="hljs language-' + lang + '">' + highlighted + '</code></pre>'
            + '<button class="di-ai-html-preview-btn" data-sid="' + sid + '">预览</button>'
            + '<button class="di-ai-html-save-btn" data-sid="' + sid + '">保存并打开</button>';
        }

        return '<pre><code class="hljs' + (lang ? ' language-' + lang : '') + '">' + highlighted + '</code></pre>';
      };

      marked.setOptions({
        renderer: renderer,
        breaks: true,
        gfm: true
      });

      _setupDone = true;
      console.log('[RichRenderer] setup complete (hljs=' + (typeof hljs !== 'undefined') + ', mermaid=' + (typeof mermaid !== 'undefined') + ', katex=' + (typeof katex !== 'undefined') + ')');
    }

    /* ═══════════════════════════════════════════════════════════════
       Render — synchronous rendering pipeline
       extract math → marked.parse → restore katex
       ═══════════════════════════════════════════════════════════════ */

    function renderStream(text) {
      if (!text) return '';

      if (!_setupDone) setup();

      // Step 1: Extract math expressions before marked can mangle them
      var mathBlocks = [];
      var processed = _extractMath(text, mathBlocks);

      // Step 2: Parse with marked
      var html = '';
      if (typeof marked !== 'undefined') {
        try { html = marked.parse(processed); }
        catch (e) { html = _fallback(text); }
      } else {
        html = _fallback(text);
      }

      // Step 2.5: Force mermaid code blocks → placeholder (works even without custom renderer)
      html = html.replace(/<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g, function(m, code) {
        var decoded = code.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
        var id = 'di-mermaid-' + (++_mermaidSeq);
        return '<div class="di-ai-mermaid-wrap"><div class="di-ai-mermaid" id="' + id + '">' + decoded + '</div></div>';
      });

      // Step 3: Restore math with KaTeX rendering
      html = _restoreMath(html, mathBlocks);

      return html;
    }

    function render(text) {
      return renderStream(text);
    }

    /* ═══════════════════════════════════════════════════════════════
       PostProcess — async DOM post-processing
       render mermaid diagrams + bind HTML preview buttons
       ═══════════════════════════════════════════════════════════════ */

    function postProcess(containerEl) {
      if (!containerEl) return;
      _renderMermaidBlocks(containerEl);
      _bindPreviewBtns(containerEl);
    }

    /* ═══════════════════════════════════════════════════════════════
       HTML Preview — sandboxed iframe modal
       ═══════════════════════════════════════════════════════════════ */

    function previewHtml(htmlContent) {
      // Remove any existing preview
      var existing = document.querySelector('.di-ai-preview-overlay');
      if (existing) existing.remove();

      var overlay = document.createElement('div');
      overlay.className = 'di-ai-preview-overlay';

      var modal = document.createElement('div');
      modal.className = 'di-ai-preview-modal';

      // Header
      var header = document.createElement('div');
      header.className = 'di-ai-preview-header';
      var title = document.createElement('span');
      title.className = 'di-ai-preview-title';
      title.textContent = 'HTML 预览';
      var closeBtn = document.createElement('button');
      closeBtn.className = 'di-ai-preview-close';
      closeBtn.innerHTML = '&times;';
      header.appendChild(title);
      header.appendChild(closeBtn);

      // Iframe
      var iframe = document.createElement('iframe');
      iframe.className = 'di-ai-preview-iframe';
      iframe.setAttribute('sandbox', 'allow-scripts');
      iframe.srcdoc = htmlContent;

      modal.appendChild(header);
      modal.appendChild(iframe);
      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      // Close handlers
      closeBtn.addEventListener('click', function() { overlay.remove(); });
      overlay.addEventListener('click', function(e) {
        if (e.target === overlay) overlay.remove();
      });
      document.addEventListener('keydown', function handler(e) {
        if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', handler); }
      });
    }

    /* ═══════════════════════════════════════════════════════════════
       Internal — Math extraction / restoration
       ═══════════════════════════════════════════════════════════════ */

    /**
     * Extract $...$ and $$...$$ patterns, replace with safe placeholders.
     * Block math ($$) processed first to avoid conflict with inline ($).
     */
    function _extractMath(text, blocks) {
      // Block math: $$...$$  (multiline allowed)
      text = text.replace(/\$\$([\s\S]+?)\$\$/g, function(m, formula) {
        var idx = blocks.length;
        blocks.push({ formula: formula.trim(), display: true });
        return '%%MATH' + idx + '%%';
      });
      // Inline math: $...$  (single line, no empty, not $$)
      text = text.replace(/\$([^\$\n]+?)\$/g, function(m, formula) {
        // Skip if it looks like currency ($100, $5.00)
        if (/^\d+/.test(formula)) return m;
        var idx = blocks.length;
        blocks.push({ formula: formula.trim(), display: false });
        return '%%MATH' + idx + '%%';
      });
      return text;
    }

    /**
     * Restore math placeholders with KaTeX-rendered HTML.
     * If KaTeX unavailable, show raw formula wrapped in <span>.
     */
    function _restoreMath(html, blocks) {
      for (var i = 0; i < blocks.length; i++) {
        var placeholder = '%%MATH' + i + '%%';
        var rendered = '';
        if (typeof katex !== 'undefined') {
          try {
            rendered = katex.renderToString(blocks[i].formula, {
              displayMode: blocks[i].display,
              throwOnError: false
            });
          } catch (e) {
            rendered = _mathFallback(blocks[i]);
          }
        } else {
          rendered = _mathFallback(blocks[i]);
        }
        // Global replace (placeholder may appear multiple times in edge cases)
        html = html.split(placeholder).join(rendered);
      }
      return html;
    }

    function _mathFallback(block) {
      var delim = block.display ? '$$' : '$';
      var escaped = _esc(block.formula);
      if (block.display) {
        return '<div class="di-ai-math-fallback">' + delim + escaped + delim + '</div>';
      }
      return '<span class="di-ai-math-fallback">' + delim + escaped + delim + '</span>';
    }

    /* ═══════════════════════════════════════════════════════════════
       Internal — Code highlighting
       ═══════════════════════════════════════════════════════════════ */

    function _highlight(code, lang) {
      if (typeof hljs === 'undefined') return _esc(code);
      try {
        if (lang && hljs.getLanguage(lang)) {
          return hljs.highlight(code, { language: lang }).value;
        }
        return hljs.highlightAuto(code).value;
      } catch (e) {
        return _esc(code);
      }
    }

    /* ═══════════════════════════════════════════════════════════════
       Internal — Mermaid rendering
       ═══════════════════════════════════════════════════════════════ */

    function _mermaidId() { return 'di-mermaid-' + (++_mermaidSeq); }

    function _renderOneMermaid(containerEl, code) {
      var svgId = _mermaidId() + '-svg';
      var wrap = document.createElement('div');
      wrap.className = 'di-ai-mermaid-wrap';
      var inner = document.createElement('div');
      inner.className = 'di-ai-mermaid';
      inner.id = _mermaidId();
      wrap.appendChild(inner);
      containerEl.parentNode.replaceChild(wrap, containerEl);
      mermaid.render(svgId, code).then(function(result) {
        wrap.innerHTML = result.svg;
      }).catch(function(err) {
        console.warn('[RichRenderer] mermaid render failed:', err.message);
        wrap.innerHTML = '<pre class="di-ai-mermaid-error">' + _esc(code) + '\n// 渲染失败: ' + err.message + '</pre>';
      });
    }

    var _mermaidWarned = false;

    function _renderMermaidBlocks(container) {
      if (typeof mermaid === 'undefined') {
        if (!_mermaidWarned) {
          _mermaidWarned = true;
          console.error('[RichRenderer] mermaid 库未加载! CDN 可能被拦截。请将 mermaid.min.js 放到项目目录并从 index.html 本地加载。');
        }
        return;
      }

      // Path 1: custom renderer placeholders
      var blocks = container.querySelectorAll('.di-ai-mermaid');
      for (var i = 0; i < blocks.length; i++) {
        (function(block) {
          var code = block.textContent;
          var svgId = block.id + '-svg';
          mermaid.render(svgId, code).then(function(result) {
            var wrap = block.closest('.di-ai-mermaid-wrap');
            if (wrap) wrap.innerHTML = result.svg;
          }).catch(function(err) {
            console.warn('[RichRenderer] mermaid render failed:', err.message);
            block.classList.add('di-ai-mermaid-error');
            block.textContent = code + '\n// 渲染失败: ' + err.message;
          });
        })(blocks[i]);
      }

      // Path 2: fallback — scan standard marked output for language-mermaid code blocks
      var fallbackBlocks = container.querySelectorAll('pre code.language-mermaid');
      for (var j = 0; j < fallbackBlocks.length; j++) {
        var pre = fallbackBlocks[j].parentNode;
        if (pre && pre.tagName === 'PRE' && !pre.querySelector('.di-ai-mermaid')) {
          var code = fallbackBlocks[j].textContent;
          _renderOneMermaid(pre, code);
        }
      }
    }

    /* ═══════════════════════════════════════════════════════════════
       Internal — HTML preview button binding
       ═══════════════════════════════════════════════════════════════ */

    function _bindPreviewBtns(container) {
      var btns = container.querySelectorAll('.di-ai-html-preview-btn');
      for (var i = 0; i < btns.length; i++) {
        (function(btn) {
          if (btn.dataset._bound) return;
          btn.dataset._bound = '1';
          btn.addEventListener('click', function() {
            var sid = btn.dataset.sid;
            if (sid && _htmlStore[sid]) previewHtml(_htmlStore[sid]);
          });
        })(btns[i]);
      }
      var saveBtns = container.querySelectorAll('.di-ai-html-save-btn');
      for (var j = 0; j < saveBtns.length; j++) {
        (function(btn) {
          if (btn.dataset._bound) return;
          btn.dataset._bound = '1';
          btn.addEventListener('click', function() {
            var sid = btn.dataset.sid;
            if (!sid || !_htmlStore[sid]) return;
            if (!window.electronAPI || !window.electronAPI.aiFileWrite || !window.electronAPI.openHtmlWindow) return;
            var fileName = 'ai-output-' + Date.now() + '.html';
            window.electronAPI.aiFileWrite({
              filePath: fileName, content: _htmlStore[sid], backup: false
            }).then(function(r) {
              if (r.success && r.path) {
                window.electronAPI.openHtmlWindow(r.path);
              }
            });
          });
        })(saveBtns[j]);
      }
    }

    /* ═══════════════════════════════════════════════════════════════
       Internal — Utilities
       ═══════════════════════════════════════════════════════════════ */

    function _esc(str) {
      var d = document.createElement('div');
      d.textContent = str;
      return d.innerHTML;
    }

    function _fallback(text) {
      return _esc(text).replace(/\n/g, '<br>');
    }

    /* ═══════════════════════════════════════════════════════════════
       Public API
       ═══════════════════════════════════════════════════════════════ */

    return Object.freeze({
      setup: setup,
      renderStream: renderStream,
      render: render,
      postProcess: postProcess,
      previewHtml: previewHtml
    });
  };
})();
