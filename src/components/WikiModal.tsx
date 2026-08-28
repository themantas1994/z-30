/**
 * Interactive GitHub Wiki & Documentation Browser Modal for z-30
 * Allows new users and developers to read, search, copy, and export
 * full documentation directly inside the application.
 */

import React, { useState, useMemo } from 'react';
import { WIKI_ARTICLES, WikiArticle } from '../data/wikiArticles';
import { 
  BookOpen, 
  Search, 
  Copy, 
  Check, 
  Download, 
  X, 
  FileText, 
  Terminal, 
  Radio, 
  Cpu, 
  Layers, 
  ShieldCheck, 
  Zap, 
  ExternalLink,
  ChevronRight,
  FolderOpen
} from 'lucide-react';

interface WikiModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialArticleSlug?: string;
}

export const WikiModal: React.FC<WikiModalProps> = ({
  isOpen,
  onClose,
  initialArticleSlug = 'Home',
}) => {
  const [selectedSlug, setSelectedSlug] = useState<string>(initialArticleSlug);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [copied, setCopied] = useState<boolean>(false);

  // Sync initial slug if modal opens with a specific target
  React.useEffect(() => {
    if (initialArticleSlug) {
      setSelectedSlug(initialArticleSlug);
    }
  }, [initialArticleSlug, isOpen]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    WIKI_ARTICLES.forEach((a) => set.add(a.category));
    return ['ALL', ...Array.from(set)];
  }, []);

  const filteredArticles = useMemo(() => {
    return WIKI_ARTICLES.filter((article) => {
      const matchesCategory =
        selectedCategory === 'ALL' || article.category === selectedCategory;
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        article.title.toLowerCase().includes(q) ||
        article.description.toLowerCase().includes(q) ||
        article.tags.some((t) => t.toLowerCase().includes(q)) ||
        article.markdown.toLowerCase().includes(q);
      return matchesCategory && matchesSearch;
    });
  }, [selectedCategory, searchQuery]);

  const currentArticle: WikiArticle = useMemo(() => {
    return (
      WIKI_ARTICLES.find((a) => a.slug === selectedSlug) ||
      WIKI_ARTICLES[0]
    );
  }, [selectedSlug]);

  const handleCopyMarkdown = () => {
    navigator.clipboard.writeText(currentArticle.markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadMarkdown = () => {
    const blob = new Blob([currentArticle.markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentArticle.slug}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportFullWikiBundle = () => {
    let bundle = `# z-30 Amateur Radio Complete Documentation & GitHub Wiki Bundle\n\nGenerated: ${new Date().toISOString()}\nRepository: https://github.com/themantas1994/z-30\n\n`;
    WIKI_ARTICLES.forEach((a) => {
      bundle += `\n\n<!-- ========================================================= -->\n`;
      bundle += `<!-- WIKI PAGE: ${a.slug}.md (${a.title}) -->\n`;
      bundle += `<!-- ========================================================= -->\n\n`;
      bundle += a.markdown;
      bundle += `\n\n---\n`;
    });
    const blob = new Blob([bundle], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'z30_github_wiki_complete_bundle.md';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-2 sm:p-4 font-mono select-none">
      <div className="bg-[#141414] border border-[#333] w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Top Header */}
        <div className="flex flex-wrap items-center justify-between px-3 sm:px-4 py-2 bg-[#0F0F0F] border-b border-[#333] gap-2 flex-shrink-0">
          <div className="flex items-center space-x-2.5">
            <div className="w-6 h-6 bg-[#050505] border border-[#333] flex items-center justify-center text-[#00FF41]">
              <BookOpen className="w-3.5 h-3.5" />
            </div>
            <div>
              <span className="text-xs font-bold text-[#D4D4D4] uppercase tracking-wider block">
                z-30 GitHub Wiki & Technical Documentation
              </span>
              <span className="text-[10px] text-[#888] hidden sm:inline">
                Complete guides for new operators, DSP developers, hardware builders, and maintainers
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              id="wiki-copy-page-btn"
              onClick={handleCopyMarkdown}
              title="Copy current article as Markdown"
              className="flex items-center space-x-1 px-2.5 py-1 bg-[#1A1A1A] hover:bg-[#262626] text-[#D4D4D4] hover:text-[#00FF41] border border-[#333] text-[11px] font-bold uppercase transition-colors"
            >
              {copied ? <Check className="w-3 h-3 text-[#00FF41]" /> : <Copy className="w-3 h-3" />}
              <span>{copied ? 'Copied' : 'Copy Page .md'}</span>
            </button>

            <button
              id="wiki-download-page-btn"
              onClick={handleDownloadMarkdown}
              title="Download current Markdown page file"
              className="flex items-center space-x-1 px-2.5 py-1 bg-[#1A1A1A] hover:bg-[#262626] text-cyan-400 border border-cyan-800/80 text-[11px] font-bold uppercase transition-colors"
            >
              <Download className="w-3 h-3" />
              <span>Download .md</span>
            </button>

            <button
              id="wiki-export-bundle-btn"
              onClick={handleExportFullWikiBundle}
              title="Download full documentation bundle"
              className="flex items-center space-x-1 px-2.5 py-1 bg-[#00FF41] hover:bg-[#00FF41]/80 text-black text-[11px] font-bold uppercase transition-all shadow-[0_0_8px_rgba(0,255,65,0.3)]"
            >
              <FolderOpen className="w-3 h-3 fill-current" />
              <span>Export Full Wiki</span>
            </button>

            <button
              id="wiki-close-btn"
              onClick={onClose}
              className="p-1 bg-[#1A1A1A] hover:bg-[#262626] text-[#888] hover:text-[#D4D4D4] border border-[#333] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Main Content Area (Split Sidebar & Article Viewer) */}
        <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
          {/* Left Sidebar: Search, Category Filters, and Article Directory */}
          <div className="w-full md:w-80 bg-[#0A0A0A] border-r border-[#333] flex flex-col flex-shrink-0 min-h-0">
            {/* Search Input */}
            <div className="p-2 border-b border-[#333] bg-[#0F0F0F]">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-[#666] absolute left-2.5 top-2.5" />
                <input
                  id="wiki-search-input"
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search articles, math, CAT, terms..."
                  className="w-full bg-[#050505] border border-[#333] text-[#D4D4D4] pl-8 pr-2.5 py-1.5 text-xs focus:outline-none focus:border-[#00FF41]"
                />
              </div>
            </div>

            {/* Category Filter Pills */}
            <div className="px-2 py-1.5 border-b border-[#333] bg-[#080808] flex items-center space-x-1 overflow-x-auto text-[10px]">
              {categories.map((cat) => {
                const isSelected = selectedCategory === cat;
                return (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-2 py-0.5 whitespace-nowrap uppercase font-bold transition-colors ${
                      isSelected
                        ? 'bg-[#00FF41]/20 text-[#00FF41] border border-[#00FF41]/50'
                        : 'text-[#888] hover:text-[#D4D4D4] bg-[#141414] border border-[#222]'
                    }`}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>

            {/* Articles List */}
            <div className="flex-1 overflow-y-auto p-1.5 space-y-1 select-none">
              {filteredArticles.length === 0 ? (
                <div className="p-4 text-center text-xs text-[#666]">
                  No wiki articles match your query.
                </div>
              ) : (
                filteredArticles.map((art) => {
                  const isSelected = art.slug === selectedSlug;
                  return (
                    <button
                      key={art.id}
                      onClick={() => setSelectedSlug(art.slug)}
                      className={`w-full text-left p-2 transition-all flex flex-col space-y-0.5 border ${
                        isSelected
                          ? 'bg-[#141414] border-[#00FF41]/60 text-[#00FF41] shadow-[inset_2px_0_0_#00FF41]'
                          : 'bg-[#050505] border-[#222] text-[#AAA] hover:bg-[#111] hover:text-[#D4D4D4]'
                      }`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <span className="text-[11px] font-bold truncate pr-1">
                          {art.title}
                        </span>
                        <ChevronRight className={`w-3 h-3 flex-shrink-0 ${isSelected ? 'text-[#00FF41]' : 'text-[#555]'}`} />
                      </div>
                      <span className="text-[9px] text-[#666] truncate">
                        {art.description}
                      </span>
                      <div className="flex items-center space-x-1 mt-1">
                        <span className="text-[8px] uppercase px-1 py-0.2 bg-[#1A1A1A] text-cyan-400 border border-[#333]">
                          {art.category}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Area: Formatted Markdown Article Reader */}
          <div className="flex-1 bg-[#050505] flex flex-col min-h-0 overflow-hidden">
            {/* Article Path Bar */}
            <div className="px-4 py-2 bg-[#0F0F0F] border-b border-[#333] flex items-center justify-between text-xs text-[#888] flex-shrink-0">
              <div className="flex items-center space-x-2">
                <FileText className="w-3.5 h-3.5 text-cyan-400" />
                <span>
                  wiki / <strong className="text-[#00FF41]">{currentArticle.slug}.md</strong>
                </span>
                <span className="text-[9px] px-1.5 py-0.5 bg-[#141414] text-purple-400 border border-purple-800/60 uppercase">
                  {currentArticle.category}
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-[10px] text-[#666]">
                  Tags: {currentArticle.tags.slice(0, 4).join(', ')}
                </span>
              </div>
            </div>

            {/* Article Body (Selectable & Scrollable Text) */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 text-xs text-[#D4D4D4] leading-relaxed select-text space-y-4 font-mono">
              <MarkdownRenderer content={currentArticle.markdown} onNavigateSlug={(slug) => setSelectedSlug(slug)} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Lightweight, robust Markdown Renderer for in-app Wiki
 */
interface MarkdownRendererProps {
  content: string;
  onNavigateSlug?: (slug: string) => void;
}

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, onNavigateSlug }) => {
  const lines = content.split('\n');

  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeBlockLang = '';
  let codeBlockLines: string[] = [];
  let inTable = false;
  let tableRows: string[][] = [];

  const flushCodeBlock = (key: string) => {
    const code = codeBlockLines.join('\n');
    elements.push(
      <div key={key} className="my-3 bg-[#0A0A0A] border border-[#333] p-3 rounded-none relative group">
        <div className="flex items-center justify-between pb-1 mb-2 border-b border-[#222] text-[10px] text-[#777]">
          <span className="uppercase text-cyan-400 font-bold">{codeBlockLang || 'terminal / code'}</span>
          <button
            onClick={() => navigator.clipboard.writeText(code)}
            className="px-1.5 py-0.5 bg-[#141414] hover:bg-[#202020] text-[#AAA] hover:text-[#00FF41] border border-[#333] text-[9px] uppercase font-bold"
          >
            Copy Snippet
          </button>
        </div>
        <pre className="whitespace-pre overflow-x-auto text-[11px] text-[#00FF41] leading-snug font-mono">
          <code>{code}</code>
        </pre>
      </div>
    );
    codeBlockLines = [];
    inCodeBlock = false;
    codeBlockLang = '';
  };

  const flushTable = (key: string) => {
    if (tableRows.length === 0) return;
    const header = tableRows[0];
    const rows = tableRows.slice(1);

    elements.push(
      <div key={key} className="my-3 overflow-x-auto border border-[#333]">
        <table className="w-full text-left text-[11px] divide-y divide-[#333]">
          <thead className="bg-[#0F0F0F] text-[#00FF41] uppercase text-[10px]">
            <tr>
              {header.map((col, idx) => (
                <th key={idx} className="p-2 font-bold border-r border-[#333] last:border-none">
                  {col.trim()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-[#050505] divide-y divide-[#222] text-[#CCC]">
            {rows.map((r, rIdx) => (
              <tr key={rIdx} className="hover:bg-[#111]">
                {r.map((c, cIdx) => (
                  <td key={cIdx} className="p-2 border-r border-[#222] last:border-none">
                    {c.trim()}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
    tableRows = [];
    inTable = false;
  };

  lines.forEach((line, idx) => {
    const key = `line-${idx}`;

    // Code block check
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        flushCodeBlock(key);
      } else {
        if (inTable) flushTable(`table-${idx}`);
        inCodeBlock = true;
        codeBlockLang = line.trim().replace('```', '');
      }
      return;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      return;
    }

    // Table check
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      // Check if separator line (| :--- | :--- |)
      if (line.includes('---')) {
        return; // skip separator row
      }
      inTable = true;
      const cells = line
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim());
      tableRows.push(cells);
      return;
    } else if (inTable) {
      flushTable(`table-${idx}`);
    }

    // Headings
    if (line.startsWith('# ')) {
      elements.push(
        <h1 key={key} className="text-base sm:text-lg font-bold text-[#00FF41] border-b border-[#333] pb-2 pt-1 uppercase tracking-wider flex items-center space-x-2">
          <span>{line.replace('# ', '')}</span>
        </h1>
      );
      return;
    }
    if (line.startsWith('## ')) {
      elements.push(
        <h2 key={key} className="text-sm sm:text-base font-bold text-cyan-400 border-b border-[#222] pb-1 pt-3 uppercase tracking-wider">
          {line.replace('## ', '')}
        </h2>
      );
      return;
    }
    if (line.startsWith('### ')) {
      elements.push(
        <h3 key={key} className="text-xs sm:text-sm font-bold text-yellow-400 pt-2 uppercase">
          {line.replace('### ', '')}
        </h3>
      );
      return;
    }

    // Divider
    if (line.trim() === '---') {
      elements.push(<hr key={key} className="border-[#333] my-3" />);
      return;
    }

    // List item
    if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
      elements.push(
        <li key={key} className="ml-4 list-disc text-[#DDD] leading-relaxed my-0.5">
          {formatInlineMarkdown(line.trim().substring(2))}
        </li>
      );
      return;
    }

    // Numbered list item
    if (/^\d+\.\s/.test(line.trim())) {
      const match = line.trim().match(/^(\d+\.)\s(.*)$/);
      if (match) {
        elements.push(
          <li key={key} className="ml-4 list-decimal text-[#DDD] leading-relaxed my-0.5">
            {formatInlineMarkdown(match[2])}
          </li>
        );
        return;
      }
    }

    // Standard paragraph
    if (line.trim().length > 0) {
      elements.push(
        <p key={key} className="text-[#CCC] leading-relaxed my-1.5">
          {formatInlineMarkdown(line)}
        </p>
      );
    }
  });

  if (inCodeBlock) flushCodeBlock('flush-end-code');
  if (inTable) flushTable('flush-end-table');

  return <div className="space-y-1 select-text">{elements}</div>;
};

/**
 * Parses bold, code chips, and links inside text lines
 */
function formatInlineMarkdown(text: string): React.ReactNode {
  // Regex to split by bold (**...**), code (`...`), and links ([label](url))
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let keyIdx = 0;

  while (remaining.length > 0) {
    // 1. Code chip `code`
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      parts.push(
        <code key={keyIdx++} className="bg-[#181818] text-[#00FF41] border border-[#333] px-1 py-0.2 text-[10px] font-mono mx-0.5">
          {codeMatch[1]}
        </code>
      );
      remaining = remaining.substring(codeMatch[0].length);
      continue;
    }

    // 2. Bold text **text**
    const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
    if (boldMatch) {
      parts.push(
        <strong key={keyIdx++} className="font-bold text-white">
          {boldMatch[1]}
        </strong>
      );
      remaining = remaining.substring(boldMatch[0].length);
      continue;
    }

    // 3. Links [label](target)
    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      const label = linkMatch[1];
      const target = linkMatch[2];
      parts.push(
        <span key={keyIdx++} className="text-cyan-400 underline decoration-cyan-700 mx-0.5">
          {label}
        </span>
      );
      remaining = remaining.substring(linkMatch[0].length);
      continue;
    }

    // Next plain character
    parts.push(remaining[0]);
    remaining = remaining.substring(1);
  }

  return <>{parts}</>;
}
