import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import LanguageIcon from "../components/LanguageIcon.jsx";
import beanIcon from "../images/bean.svg";
import { analyzeSubmission, detectLanguage } from "../utils/parser.js";
import { setDocumentHead } from "../utils/documentHead.js";
import { getLanguageConfig, SUPPORTED_LANGUAGES } from "../utils/languages.js";
import { supabase } from "../utils/supabaseClient.js";

const WRAP_STORAGE_KEY = "ccs-freedom-screen-terminal-wrap-lines";
const LINE_HEIGHT = 21;
const FONT_SIZE = 13;

const VS = {
  bg: "#1e1e1e",
  sidebar: "#252526",
  activityBar: "#333333",
  tabBar: "#2d2d2d",
  tabActive: "#1e1e1e",
  statusBar: "#007acc",
  lineNum: "#858585",
  fg: "#d4d4d4",
  border: "#1a1a1a",
  keyword: "#569cd6",
  string: "#ce9178",
  comment: "#6a9955",
  func: "#dcdcaa",
  variable: "#9cdcfe",
  number: "#b5cea8",
  type: "#4ec9b0",
  operator: "#d4d4d4",
  bracket: "#ffd700",
  preprocessor: "#c586c0",
  plain: "#d4d4d4",
};

const TOKEN_PATTERNS = {
  python: [
    [/^#[^\n]*/, "comment"],
    [/^("""[\s\S]*?"""|'''[\s\S]*?''')/, "string"],
    [/^[fbrFBR]*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/, "string"],
    [/^\b(False|None|True|and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield)\b/, "keyword"],
    [/^\b(print|len|range|enumerate|zip|map|filter|sorted|list|dict|set|tuple|str|int|float|bool|type|isinstance|input|open|abs|max|min|sum|round|super)\b/, "func"],
    [/^\b\d+\.?\d*\b/, "number"],
    [/^\b[A-Z]\w*\b/, "type"],
    [/^\b\w+(?=\s*\()/, "func"],
    [/^\b[a-zA-Z_]\w*\b/, "variable"],
    [/^[+\-*/%=<>!&|^~@]/, "operator"],
  ],
  javascript: [
    [/^\/\/[^\n]*/, "comment"],
    [/^\/\*[\s\S]*?\*\//, "comment"],
    [/^`(?:[^`\\]|\\.|\$\{[^}]*\})*`/, "string"],
    [/^("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/, "string"],
    [/^\b(async|await|break|case|catch|class|const|continue|default|delete|do|else|export|extends|false|finally|for|from|function|if|import|in|instanceof|let|new|null|of|return|static|super|switch|this|throw|true|try|typeof|undefined|var|void|while|with|yield)\b/, "keyword"],
    [/^\b(console|document|window|Math|Array|Object|String|Number|Boolean|Promise|JSON|parseInt|parseFloat|setTimeout|setInterval|fetch|Date|Error|Map|Set)\b/, "type"],
    [/^\b\d+\.?\d*([eE][+-]?\d+)?\b/, "number"],
    [/^\b[A-Z]\w*\b/, "type"],
    [/^\b\w+(?=\s*\()/, "func"],
    [/^=>/, "keyword"],
    [/^[a-zA-Z_$]\w*/, "variable"],
    [/^[+\-*/%=<>!&|^~?:.]/, "operator"],
  ],
  java: [
    [/^\/\/[^\n]*/, "comment"],
    [/^\/\*[\s\S]*?\*\//, "comment"],
    [/^("(?:[^"\\]|\\.)*")/, "string"],
    [/^\b(abstract|assert|break|case|catch|class|continue|default|do|else|enum|extends|final|finally|for|if|implements|import|instanceof|interface|new|package|private|protected|public|return|static|super|switch|synchronized|this|throw|throws|try|volatile|while)\b/, "keyword"],
    [/^\b(true|false|null)\b/, "keyword"],
    [/^\b(int|long|double|float|boolean|char|byte|short|void|String|Object|Integer|System|Math|Arrays|List|Map|ArrayList|HashMap)\b/, "type"],
    [/^\b\d+\.?\d*[lLfFdD]?\b/, "number"],
    [/^@\w+/, "preprocessor"],
    [/^\b[A-Z]\w*\b/, "type"],
    [/^\b\w+(?=\s*\()/, "func"],
    [/^\b[a-zA-Z_]\w*\b/, "variable"],
    [/^[+\-*/%=<>!&|^~?.]/, "operator"],
  ],
  cpp: [
    [/^\/\/[^\n]*/, "comment"],
    [/^\/\*[\s\S]*?\*\//, "comment"],
    [/^#[^\n]*/, "preprocessor"],
    [/^("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/, "string"],
    [/^\b(auto|break|case|catch|class|const|constexpr|continue|default|delete|do|else|enum|explicit|extern|false|final|for|friend|if|inline|mutable|namespace|new|nullptr|operator|override|private|protected|public|return|sizeof|static|struct|switch|template|this|throw|true|try|typedef|typename|union|using|virtual|void|volatile|while)\b/, "keyword"],
    [/^\b(int|long|double|float|char|bool|string|vector|map|set|cout|cin|cerr|endl|std|size_t)\b/, "type"],
    [/^\b\d+\.?\d*[uUlLfF]?\b/, "number"],
    [/^\b[A-Z]\w*\b/, "type"],
    [/^\b\w+(?=\s*\()/, "func"],
    [/^[a-zA-Z_]\w*/, "variable"],
    [/^[+\-*/%=<>!&|^~?:.]/, "operator"],
  ],
  csharp: [
    [/^\/\/[^\n]*/, "comment"],
    [/^\/\*[\s\S]*?\*\//, "comment"],
    [/^@?"(?:[^"]|"")*"/, "string"],
    [/^\b(abstract|as|base|break|case|catch|class|const|continue|default|delegate|do|else|enum|event|explicit|extern|false|finally|for|foreach|if|implicit|in|interface|internal|is|lock|namespace|new|null|operator|out|override|private|protected|public|readonly|ref|return|sealed|sizeof|stackalloc|static|struct|switch|this|throw|true|try|typeof|using|virtual|void|while)\b/, "keyword"],
    [/^\b(bool|byte|char|decimal|double|dynamic|float|int|long|object|string|var|Console|DateTime|List|Dictionary)\b/, "type"],
    [/^\b\d+\.?\d*[fFdDmM]?\b/, "number"],
    [/^\b[A-Z]\w*\b/, "type"],
    [/^\b\w+(?=\s*\()/, "func"],
    [/^[a-zA-Z_]\w*/, "variable"],
    [/^[+\-*/%=<>!&|^~?:.]/, "operator"],
  ],
};

const TOKEN_COLORS = {
  keyword: VS.keyword,
  string: VS.string,
  comment: VS.comment,
  func: VS.func,
  variable: VS.variable,
  number: VS.number,
  type: VS.type,
  operator: VS.operator,
  bracket: VS.bracket,
  preprocessor: VS.preprocessor,
};

const LANGUAGE_SNIPPETS = {
  python: 'message = "hello wall"\nprint(message)',
  javascript: 'const message = "hello wall";\nconsole.log(message);',
  java: 'public class Main {\n  public static void main(String[] args) {\n    String message = "hello wall";\n    System.out.println(message);\n  }\n}',
  cpp: '#include <iostream>\nusing namespace std;\n\nint main() {\n  string message = "hello wall";\n  cout << message;\n  return 0;\n}',
  csharp: 'using System;\n\nclass Program {\n  static void Main() {\n    string message = "hello wall";\n    Console.WriteLine(message);\n  }\n}',
};

function getInitialWrapState() {
  if (typeof window === "undefined") return true;

  const stored = window.localStorage.getItem(WRAP_STORAGE_KEY);
  if (stored === "0") return false;
  if (stored === "1") return true;
  return window.innerWidth < 820;
}

function escapeHtml(input) {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function tokenize(code, language) {
  if (!code) return "";

  const patterns = TOKEN_PATTERNS[language] ?? [];
  let remaining = code;
  let output = "";

  while (remaining.length > 0) {
    let matched = false;

    for (const [pattern, type] of patterns) {
      const match = remaining.match(pattern);
      if (!match || match.index !== 0) continue;

      output += `<span style="color:${TOKEN_COLORS[type] ?? VS.plain}">${escapeHtml(match[0])}</span>`;
      remaining = remaining.slice(match[0].length);
      matched = true;
      break;
    }

    if (!matched) {
      output += escapeHtml(remaining[0]);
      remaining = remaining.slice(1);
    }
  }

  return output;
}

export default function Terminal() {
  const [code, setCode] = useState("");
  const [wrapLines, setWrapLines] = useState(getInitialWrapState);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState(null);
  const [errorLine, setErrorLine] = useState(null);
  const [lineHeights, setLineHeights] = useState([]);

  const textareaRef = useRef(null);
  const highlightedRef = useRef(null);
  const lineNumberRef = useRef(null);
  const editorWrapRef = useRef(null);
  const measureRef = useRef(null);

  const detectedLanguage = useMemo(() => getLanguageConfig(detectLanguage(code)), [code]);
  const sourceLines = useMemo(() => code.split("\n"), [code]);
  const lineCount = sourceLines.length;
  const highlightedCode = useMemo(
    () => tokenize(`${code}${code.endsWith("\n") ? "" : "\n"}`, detectedLanguage.key),
    [code, detectedLanguage.key]
  );

  useEffect(() => {
    setDocumentHead("CCS Freedom Terminal", beanIcon);
  }, []);

  useEffect(() => {
    if (!toast || typeof window === "undefined") return undefined;
    const timeout = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const recomputeLineHeights = useCallback(() => {
    if (!wrapLines || !editorWrapRef.current || !measureRef.current) {
      setLineHeights([]);
      return;
    }

    const containerWidth = editorWrapRef.current.clientWidth - 20;
    if (containerWidth <= 0) return;

    measureRef.current.style.width = `${containerWidth}px`;
    const nextHeights = sourceLines.map((line) => {
      measureRef.current.textContent = line || " ";
      return measureRef.current.clientHeight;
    });
    setLineHeights(nextHeights);
  }, [sourceLines, wrapLines]);

  useEffect(() => {
    recomputeLineHeights();
  }, [recomputeLineHeights]);

  useEffect(() => {
    if (!editorWrapRef.current) return undefined;

    const observer = new ResizeObserver(recomputeLineHeights);
    observer.observe(editorWrapRef.current);
    return () => observer.disconnect();
  }, [recomputeLineHeights]);

  const syncScroll = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    if (highlightedRef.current) {
      highlightedRef.current.scrollTop = textarea.scrollTop;
      highlightedRef.current.scrollLeft = textarea.scrollLeft;
    }

    if (lineNumberRef.current) {
      lineNumberRef.current.scrollTop = textarea.scrollTop;
    }
  }, []);

  const toggleWrapLines = () => {
    setWrapLines((previous) => {
      const next = !previous;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(WRAP_STORAGE_KEY, next ? "1" : "0");
      }
      return next;
    });
  };

  const loadSnippet = (languageKey) => {
    setCode(LANGUAGE_SNIPPETS[languageKey] ?? "");
    setErrorLine(null);
    setSidebarOpen(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const handleRun = async (event) => {
    event?.preventDefault();

    const analysis = analyzeSubmission(code);

    if (!analysis.parsed) {
      setErrorLine(analysis.syntaxError?.line ?? 1);
      setToast({
        kind: "error",
        message: analysis.syntaxError?.message ?? "Invalid print syntax.",
      });
      textareaRef.current?.focus();
      return;
    }

    setIsSubmitting(true);
    setToast(null);
    setErrorLine(null);

    const payload = {
      text: analysis.parsed.output.trim(),
      full_code: code,
      language: analysis.parsed.language,
    };

    let insertErrorMessage = null;

    const { error: extendedInsertError } = await supabase.from("messages").insert([payload]);

    if (extendedInsertError) {
      const missingColumnError =
        extendedInsertError.message.includes("full_code") ||
        extendedInsertError.message.includes("language") ||
        extendedInsertError.message.includes("column");

      if (missingColumnError) {
        const { error: fallbackInsertError } = await supabase
          .from("messages")
          .insert([{ text: analysis.parsed.output.trim() }]);

        insertErrorMessage = fallbackInsertError?.message ?? null;
      } else {
        insertErrorMessage = extendedInsertError.message;
      }
    }

    setIsSubmitting(false);

    if (insertErrorMessage) {
      setToast({
        kind: "error",
        message: insertErrorMessage,
      });
      textareaRef.current?.focus();
      return;
    }

    setToast({
      kind: "success",
      message: "entry sent",
    });
    textareaRef.current?.focus();
  };

  const handleKeyDown = useCallback((event) => {
    const element = event.target;

    if (event.key === "Tab") {
      event.preventDefault();
      const start = element.selectionStart;
      const end = element.selectionEnd;
      const nextValue = `${code.slice(0, start)}  ${code.slice(end)}`;
      setCode(nextValue);
      requestAnimationFrame(() => {
        element.selectionStart = start + 2;
        element.selectionEnd = start + 2;
      });
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const start = element.selectionStart;
      const lineStart = code.lastIndexOf("\n", start - 1) + 1;
      const indent = code.slice(lineStart).match(/^(\s*)/)?.[1] ?? "";
      const extraIndent = /[:{(]\s*$/.test(code.slice(lineStart, start)) ? "    " : "";
      const nextValue = `${code.slice(0, start)}\n${indent}${extraIndent}${code.slice(element.selectionEnd)}`;
      const nextPosition = start + 1 + indent.length + extraIndent.length;
      setCode(nextValue);
      requestAnimationFrame(() => {
        element.selectionStart = nextPosition;
        element.selectionEnd = nextPosition;
      });
    }
  }, [code]);

  const editorTextStyle = {
    fontFamily: "'SF Mono', Consolas, 'Courier New', monospace",
    fontSize: FONT_SIZE,
    lineHeight: `${LINE_HEIGHT}px`,
    whiteSpace: wrapLines ? "pre-wrap" : "pre",
    wordBreak: wrapLines ? "break-word" : "normal",
    overflowWrap: wrapLines ? "break-word" : "normal",
    tabSize: 2,
    padding: "12px 10px",
  };

  return (
    <main style={styles.page}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #424242; border-radius: 3px; }
        * { -webkit-tap-highlight-color: transparent; box-sizing: border-box; }
        textarea::selection { background: rgba(38, 79, 120, 0.85) !important; }
        textarea::-moz-selection { background: rgba(38, 79, 120, 0.85) !important; }
      `}</style>

      <div
        ref={measureRef}
        aria-hidden="true"
        style={{
          position: "fixed",
          top: -9999,
          left: -9999,
          visibility: "hidden",
          fontFamily: "'SF Mono', Consolas, 'Courier New', monospace",
          fontSize: FONT_SIZE,
          lineHeight: `${LINE_HEIGHT}px`,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          overflowWrap: "break-word",
          padding: 0,
          margin: 0,
          border: 0,
        }}
      />

      {toast && (
        <div
          aria-live="polite"
          style={{
            ...styles.toast,
            borderColor: toast.kind === "error" ? "#5a1d1d" : "#163225",
            color: toast.kind === "error" ? "#ff9a9a" : "#8ef0b6",
          }}
        >
          {toast.message}
        </div>
      )}

      {sidebarOpen && <div onClick={() => setSidebarOpen(false)} style={styles.sidebarScrim} />}

      <section style={styles.shell}>
        <div style={styles.workspace}>
          <aside style={styles.activityBar}>
            <button
              type="button"
              onClick={() => setSidebarOpen((previous) => !previous)}
              style={{
                ...styles.activityButton,
                borderLeft: sidebarOpen ? "2px solid #ffffff" : "2px solid transparent",
                opacity: sidebarOpen ? 1 : 0.55,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 14 14" fill={sidebarOpen ? "#ffffff" : "#858585"}>
                <circle cx="7" cy="2" r="1.5" />
                <circle cx="7" cy="7" r="1.5" />
                <circle cx="7" cy="12" r="1.5" />
              </svg>
            </button>
            <div style={styles.activitySpacer} />
          </aside>

          <aside
            style={{
              ...styles.sidebar,
              width: sidebarOpen ? 224 : 0,
            }}
          >
            <div style={styles.sidebarInner}>
              <div style={styles.sidebarHeader}>
                <span style={styles.sidebarHeaderText}>Explorer</span>
                <button type="button" onClick={() => setSidebarOpen(false)} style={styles.sidebarClose}>
                  x
                </button>
              </div>

              <div style={styles.sidebarSection}>
                <div style={styles.sidebarRow}>
                  <span style={styles.sidebarLabel}>Line Wrap</span>
                  <button type="button" onClick={toggleWrapLines} style={styles.toggle}>
                    {wrapLines ? "On" : "Off"}
                  </button>
                </div>
              </div>

              <div style={styles.sidebarCopy}>
                <div style={styles.sidebarTitle}>How to post</div>
                <p style={styles.sidebarParagraph}>
                  Only printed output is posted to the wall. The editor checks for a
                  complete program shape in Java, C++, and C# before it accepts the run.
                </p>
                <p style={styles.sidebarParagraph}>
                  Python and JavaScript can post from a direct print line. Java needs a
                  class and `main`, C++ needs `int main()`, and C# needs `Main()` plus
                  `Console.WriteLine(...)`.
                </p>
                <p style={styles.sidebarParagraph}>
                  String variables are supported, and Python triple-quoted strings can be
                  posted as multiline output.
                </p>
              </div>

              <div style={styles.sidebarExamples}>
                <div style={styles.examplesHeader}>Supported Languages</div>
                {SUPPORTED_LANGUAGES.map((language) => (
                  <button
                    key={language.key}
                    type="button"
                    onClick={() => loadSnippet(language.key)}
                    style={styles.exampleButton}
                  >
                    <div style={styles.exampleTop}>
                      <div style={styles.exampleNameGroup}>
                        <LanguageIcon language={language.key} size={16} />
                        <span style={styles.exampleName}>{language.name}</span>
                      </div>
                      <span style={{ ...styles.exampleExt, color: language.accent }}>{language.extension}</span>
                    </div>
                    <div style={styles.exampleCode}>{language.sample}</div>
                  </button>
                ))}
              </div>
            </div>
          </aside>

          <section style={styles.editorColumn}>
            <div style={styles.tabBar}>
              <div style={styles.singleTab}>
                <LanguageIcon language={detectedLanguage.key} size={16} />
                <span>{detectedLanguage.fileName}</span>
              </div>

              <button type="button" onClick={handleRun} disabled={isSubmitting} style={styles.runButton}>
                {isSubmitting ? (
                  <>
                    <span style={styles.spinner} />
                    Running...
                  </>
                ) : (
                  "Run"
                )}
              </button>
            </div>

            <div style={styles.breadcrumb}>
              <span style={styles.projectLabel}>project</span>
              <span>{">"}</span>
              <span style={styles.currentFile}>{detectedLanguage.fileName}</span>
              <span style={styles.detectedLanguage}>detected: {detectedLanguage.name}</span>
            </div>

            <div style={styles.editorBody}>
              <div ref={lineNumberRef} style={styles.lineNumbers}>
                {sourceLines.map((_, index) => (
                  <div
                    key={index}
                    style={{
                      ...styles.lineNumber,
                      height: wrapLines && lineHeights[index] ? lineHeights[index] : LINE_HEIGHT,
                      lineHeight: `${LINE_HEIGHT}px`,
                    }}
                  >
                    {index + 1}
                  </div>
                ))}
              </div>

              <div ref={editorWrapRef} style={styles.editorWrap}>
                {code === "" && (
                  <div style={styles.placeholder}>
                    Start typing. The language icon and filename update automatically.
                  </div>
                )}

                <pre
                  ref={highlightedRef}
                  aria-hidden="true"
                  style={{
                    ...editorTextStyle,
                    ...styles.highlightLayer,
                    overflowY: "auto",
                    overflowX: wrapLines ? "hidden" : "auto",
                  }}
                  dangerouslySetInnerHTML={{ __html: highlightedCode }}
                />

                <textarea
                  ref={textareaRef}
                  aria-label="CCS Freedom Terminal code editor"
                  autoCapitalize="off"
                  autoCorrect="off"
                  autoComplete="off"
                  spellCheck={false}
                  value={code}
                  onChange={(event) => {
                    setCode(event.target.value);
                    if (errorLine) setErrorLine(null);
                  }}
                  onKeyDown={handleKeyDown}
                  onScroll={syncScroll}
                  style={{
                    ...editorTextStyle,
                    ...styles.textarea,
                    overflowY: "auto",
                    overflowX: wrapLines ? "hidden" : "auto",
                    borderColor: errorLine ? "#8a3030" : "transparent",
                  }}
                />

                {errorLine && <div style={styles.errorBadge}>Line {errorLine}</div>}
              </div>
            </div>

            <div style={styles.statusBar}>
              <div style={styles.statusGroup}>
                <span>main</span>
                <span style={{ ...styles.languageChip, background: detectedLanguage.accent }}>{detectedLanguage.name}</span>
              </div>

              <div style={styles.statusGroup}>
                <span>{lineCount} lines</span>
                <span>{wrapLines ? "Wrap" : "No Wrap"}</span>
                <span>UTF-8</span>
              </div>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}

const styles = {
  page: {
    minHeight: "100dvh",
    background: VS.bg,
    color: VS.fg,
    overflow: "hidden",
  },
  shell: {
    height: "100dvh",
    overflow: "hidden",
  },
  workspace: {
    display: "flex",
    height: "100%",
    overflow: "hidden",
  },
  activityBar: {
    width: "44px",
    background: VS.activityBar,
    borderRight: `1px solid ${VS.border}`,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "6px 0",
    flexShrink: 0,
    zIndex: 12,
  },
  activityButton: {
    width: "40px",
    height: "40px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "transparent",
    borderTop: "none",
    borderRight: "none",
    borderBottom: "none",
    cursor: "pointer",
  },
  activitySpacer: {
    flex: 1,
  },
  sidebarScrim: {
    position: "fixed",
    inset: 0,
    background: "rgba(0, 0, 0, 0.35)",
    zIndex: 20,
  },
  sidebar: {
    background: VS.sidebar,
    borderRight: `1px solid ${VS.border}`,
    overflow: "hidden",
    transition: "width 160ms ease",
    flexShrink: 0,
    zIndex: 21,
  },
  sidebarInner: {
    width: "224px",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    overflowY: "auto",
  },
  sidebarHeader: {
    padding: "10px 12px",
    borderBottom: `1px solid ${VS.border}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sidebarHeaderText: {
    fontSize: "10px",
    color: "#bbbbbb",
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    fontFamily: "-apple-system, sans-serif",
    fontWeight: 600,
  },
  sidebarClose: {
    border: "none",
    background: "transparent",
    color: "#666666",
    fontSize: "16px",
    cursor: "pointer",
  },
  sidebarSection: {
    padding: "12px 14px",
    borderBottom: `1px solid ${VS.border}`,
  },
  sidebarRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
  },
  sidebarLabel: {
    fontSize: "12px",
    color: "#cccccc",
    fontFamily: "-apple-system, sans-serif",
  },
  toggle: {
    minWidth: "64px",
    minHeight: "30px",
    borderRadius: "999px",
    border: "1px solid #4a4a4a",
    background: "#1a1a1a",
    color: "#ffffff",
    cursor: "pointer",
    fontSize: "12px",
  },
  sidebarCopy: {
    padding: "14px",
    borderBottom: `1px solid ${VS.border}`,
  },
  sidebarTitle: {
    fontSize: "13px",
    color: "#ffffff",
    fontWeight: 600,
    marginBottom: "8px",
    fontFamily: "-apple-system, sans-serif",
  },
  sidebarParagraph: {
    margin: 0,
    fontSize: "12px",
    lineHeight: 1.65,
    color: "#cccccc",
    fontFamily: "-apple-system, sans-serif",
  },
  sidebarExamples: {
    padding: "12px 10px 18px",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  examplesHeader: {
    padding: "0 4px 4px",
    fontSize: "10px",
    color: "#666666",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    fontFamily: "-apple-system, sans-serif",
    fontWeight: 600,
  },
  exampleButton: {
    width: "100%",
    border: "1px solid #333333",
    borderRadius: "8px",
    background: "#1a1a1a",
    padding: "10px",
    textAlign: "left",
    cursor: "pointer",
  },
  exampleTop: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    marginBottom: "8px",
  },
  exampleNameGroup: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  exampleName: {
    fontSize: "12px",
    color: "#f2f2f2",
    fontWeight: 600,
    fontFamily: "-apple-system, sans-serif",
  },
  exampleExt: {
    fontSize: "11px",
    textTransform: "uppercase",
    fontFamily: "-apple-system, sans-serif",
    fontWeight: 700,
  },
  exampleCode: {
    fontSize: "11px",
    color: VS.string,
    fontFamily: "'SF Mono', Consolas, 'Courier New', monospace",
    lineHeight: 1.5,
    whiteSpace: "pre-wrap",
  },
  editorColumn: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    minWidth: 0,
  },
  tabBar: {
    background: VS.tabBar,
    borderBottom: `1px solid ${VS.border}`,
    padding: "0 12px",
    minHeight: "48px",
    display: "flex",
    alignItems: "stretch",
    justifyContent: "space-between",
    gap: "12px",
    flexShrink: 0,
  },
  singleTab: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "0 12px",
    background: VS.tabActive,
    borderTop: "1px solid #007acc",
    borderLeft: `1px solid ${VS.border}`,
    borderRight: `1px solid ${VS.border}`,
    color: "#ffffff",
    fontSize: "12px",
    fontFamily: "-apple-system, sans-serif",
    whiteSpace: "nowrap",
  },
  runButton: {
    alignSelf: "center",
    minHeight: "34px",
    minWidth: "112px",
    padding: "8px 16px",
    borderRadius: "6px",
    border: "1px solid #2a8e49",
    background: "#146c2e",
    color: "#ffffff",
    cursor: "pointer",
    fontSize: "12px",
    fontWeight: 600,
    fontFamily: "-apple-system, sans-serif",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
  },
  spinner: {
    display: "inline-block",
    width: "10px",
    height: "10px",
    border: "2px solid #ffffff",
    borderTopColor: "transparent",
    borderRadius: "50%",
    animation: "spin 0.6s linear infinite",
  },
  breadcrumb: {
    padding: "6px 12px",
    background: VS.bg,
    borderBottom: `1px solid ${VS.border}`,
    display: "flex",
    alignItems: "center",
    gap: "6px",
    fontSize: "11px",
    color: "#777777",
    fontFamily: "-apple-system, sans-serif",
    flexShrink: 0,
    flexWrap: "wrap",
  },
  projectLabel: {
    color: "#569cd6",
  },
  currentFile: {
    color: "#f3f3f3",
  },
  detectedLanguage: {
    marginLeft: "6px",
    color: "#4ec9b0",
    background: "rgba(78, 201, 176, 0.1)",
    padding: "1px 6px",
    borderRadius: "999px",
  },
  editorBody: {
    flex: 1,
    display: "flex",
    overflow: "hidden",
    background: VS.bg,
    minHeight: 0,
  },
  lineNumbers: {
    padding: "12px 0",
    minWidth: "46px",
    background: VS.bg,
    color: VS.lineNum,
    userSelect: "none",
    flexShrink: 0,
    overflowY: "hidden",
    overflowX: "hidden",
    fontSize: "12px",
    borderRight: "1px solid #2d2d2d",
    textAlign: "right",
  },
  lineNumber: {
    paddingRight: "8px",
    paddingLeft: "4px",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "flex-end",
  },
  editorWrap: {
    flex: 1,
    position: "relative",
    overflow: "hidden",
    minWidth: 0,
  },
  placeholder: {
    position: "absolute",
    top: "12px",
    left: "10px",
    color: "#555555",
    fontFamily: "'SF Mono', Consolas, 'Courier New', monospace",
    fontSize: `${FONT_SIZE}px`,
    lineHeight: `${LINE_HEIGHT}px`,
    pointerEvents: "none",
    zIndex: 3,
    fontStyle: "italic",
  },
  highlightLayer: {
    position: "absolute",
    inset: 0,
    margin: 0,
    color: VS.fg,
    pointerEvents: "none",
    zIndex: 1,
    background: "transparent",
  },
  textarea: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    margin: 0,
    resize: "none",
    background: "transparent",
    color: "transparent",
    WebkitTextFillColor: "transparent",
    caretColor: "#aeafad",
    border: "none",
    outline: "none",
    zIndex: 2,
    userSelect: "text",
  },
  errorBadge: {
    position: "absolute",
    top: "10px",
    right: "12px",
    zIndex: 4,
    padding: "4px 8px",
    borderRadius: "999px",
    background: "rgba(138, 48, 48, 0.22)",
    color: "#ffb3b3",
    border: "1px solid rgba(255, 107, 107, 0.35)",
    fontSize: "11px",
    fontFamily: "-apple-system, sans-serif",
  },
  statusBar: {
    background: VS.statusBar,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "12px",
    padding: "4px 12px",
    fontSize: "11px",
    color: "#ffffff",
    flexShrink: 0,
    fontFamily: "-apple-system, sans-serif",
    flexWrap: "wrap",
  },
  statusGroup: {
    display: "flex",
    gap: "10px",
    alignItems: "center",
  },
  languageChip: {
    padding: "1px 6px",
    borderRadius: "999px",
    color: "#ffffff",
    fontSize: "10px",
    fontWeight: 700,
  },
  toast: {
    position: "fixed",
    top: "16px",
    right: "16px",
    zIndex: 30,
    maxWidth: "min(92vw, 320px)",
    padding: "12px 16px",
    borderRadius: "6px",
    border: "1px solid",
    background: "#090909",
    boxShadow: "0 10px 24px rgba(0, 0, 0, 0.35)",
    fontSize: "14px",
    animation: "fadeUp 0.15s ease",
  },
};
