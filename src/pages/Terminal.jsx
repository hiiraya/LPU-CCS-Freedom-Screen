import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import LanguageIcon from "../components/LanguageIcon.jsx";
import beanIcon from "../images/bean.svg";
import { parseAnsiText, stripAnsiSequences } from "../utils/ansiText.js";
import { analyzeSubmission, detectLanguage, previewSubmissionOutput } from "../utils/parser.js";
import { setDocumentHead } from "../utils/documentHead.js";
import { getLanguageConfig, SUPPORTED_LANGUAGES } from "../utils/languages.js";
import { insertMessageWithFallback } from "../utils/messagesApi.js";

const WRAP_STORAGE_KEY = "ccs-freedom-screen-terminal-wrap-lines";
const LAST_SENT_STORAGE_KEY = "ccs-freedom-screen-last-sent";
const LINE_HEIGHT = 21;
const FONT_SIZE = 13;
const MESSAGE_CHAR_LIMIT = 200;
const MESSAGE_COOLDOWN_MS = 5000;
const TERMINAL_AUTO_CLOSE_MS = 3000;
const TERMINAL_TYPE_INTERVAL_MS = 18;
const TERMINAL_LINE_INTERVAL_MS = 140;

const IDE_COMMANDS = {
  python: "py entry.py",
  javascript: "node entry.js",
  java: "javac Main.java; if ($?) { java Main }",
  cpp: "g++ main.cpp -o entry; if ($?) { .\\entry.exe }",
  csharp: "dotnet run Program.cs",
};

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
  python: 'message = "REPLACE WITH YOUR MESSAGE"\nprint(message)',
  javascript: 'const message = "REPLACE WITH YOUR MESSAGE";\nconsole.log(message);',
  java: 'public class Main {\n  public static void main(String[] args) {\n    String message = "REPLACE WITH YOUR MESSAGE";\n    System.out.println(message);\n  }\n}',
  cpp: '#include <iostream>\nusing namespace std;\n\nint main() {\n  string message = "REPLACE WITH YOUR MESSAGE";\n  cout << message;\n  return 0;\n}',
  csharp: 'using System;\n\nclass Program {\n  static void Main() {\n    string message = "REPLACE WITH YOUR MESSAGE";\n    Console.WriteLine(message);\n  }\n}',
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

function renderAnsiText(text, keyPrefix, defaultColor = "inherit") {
  return parseAnsiText(text).map((segment, index) => (
    <span
      key={`${keyPrefix}-${index}`}
      style={{
        color: segment.style.color ?? defaultColor,
        backgroundColor: segment.style.backgroundColor ?? "transparent",
        fontWeight: segment.style.fontWeight ?? "inherit",
      }}
    >
      {segment.text}
    </span>
  ));
}

function renderFormattedTerminalText(text, keyPrefix = "terminal") {
  const parts = String(text ?? "").split(/(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*)/g);

  return parts.filter(Boolean).map((part, index) => {
    const key = `${keyPrefix}-${index}`;

    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={key} style={styles.terminalStrong}>
          {part.slice(2, -2)}
        </strong>
      );
    }

    if (part.startsWith("__") && part.endsWith("__")) {
      return (
        <span key={key} style={styles.terminalUnderline}>
          {part.slice(2, -2)}
        </span>
      );
    }

    if (part.startsWith("*") && part.endsWith("*")) {
      return (
        <em key={key} style={styles.terminalEmphasis}>
          {part.slice(1, -1)}
        </em>
      );
    }

    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={key} style={styles.terminalCode}>
          {part.slice(1, -1)}
        </code>
      );
    }

    return <span key={key}>{part}</span>;
  });
}

export default function Terminal() {
  const [code, setCode] = useState("");
  const [wrapLines, setWrapLines] = useState(getInitialWrapState);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showTutorialDialog, setShowTutorialDialog] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorLine, setErrorLine] = useState(null);
  const [lineHeights, setLineHeights] = useState([]);
  const [terminalSession, setTerminalSession] = useState(null);
  const [typedCommand, setTypedCommand] = useState("");
  const [visibleTerminalLines, setVisibleTerminalLines] = useState(0);

  const textareaRef = useRef(null);
  const highlightedRef = useRef(null);
  const lineNumberRef = useRef(null);
  const editorWrapRef = useRef(null);
  const measureRef = useRef(null);

  const detectedLanguage = useMemo(() => getLanguageConfig(detectLanguage(code)), [code]);
  const previewOutput = useMemo(() => previewSubmissionOutput(code), [code]);
  const previewLength = useMemo(() => stripAnsiSequences(previewOutput ?? "").trim().length, [previewOutput]);
  const sourceLines = useMemo(() => code.split("\n"), [code]);
  const lineCount = sourceLines.length;
  const highlightedCode = useMemo(
    () => tokenize(`${code}${code.endsWith("\n") ? "" : "\n"}`, detectedLanguage.key),
    [code, detectedLanguage.key]
  );

  useEffect(() => {
    setDocumentHead("CCS Freedom IDE", beanIcon);
  }, []);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!showTutorialDialog || typeof window === "undefined") return undefined;

    const handleKeyDown = (event) => {
      if (event.key === "Escape") setShowTutorialDialog(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showTutorialDialog]);

  useEffect(() => {
    if (!terminalSession || typeof window === "undefined") return undefined;

    let typeInterval = null;
    let lineInterval = null;
    let closeTimeout = null;

    setTypedCommand("");
    setVisibleTerminalLines(0);

    let commandIndex = 0;
    typeInterval = window.setInterval(() => {
      commandIndex += 1;
      setTypedCommand(terminalSession.command.slice(0, commandIndex));
      if (commandIndex >= terminalSession.command.length) {
        window.clearInterval(typeInterval);
        let lineIndex = 0;
        lineInterval = window.setInterval(() => {
          lineIndex += 1;
          setVisibleTerminalLines(lineIndex);
          if (lineIndex >= terminalSession.lines.length) {
            window.clearInterval(lineInterval);
            if (terminalSession.variant === "success") {
              closeTimeout = window.setTimeout(() => {
                setTerminalSession(null);
              }, TERMINAL_AUTO_CLOSE_MS);
            }
          }
        }, TERMINAL_LINE_INTERVAL_MS);
      }
    }, TERMINAL_TYPE_INTERVAL_MS);

    return () => {
      if (typeInterval) window.clearInterval(typeInterval);
      if (lineInterval) window.clearInterval(lineInterval);
      if (closeTimeout) window.clearTimeout(closeTimeout);
    };
  }, [terminalSession]);

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
    const nextValue = LANGUAGE_SNIPPETS[languageKey] ?? "";
    setCode(nextValue);
    setErrorLine(null);
    setSidebarOpen(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const openIdeTerminal = useCallback((languageKey, variant, lines) => {
    const config = getLanguageConfig(languageKey);
    const command = `PS C:\\Users\\Administrator> ${IDE_COMMANDS[languageKey] ?? `run ${config.fileName}`}`;
    setTerminalSession({
      id: Date.now(),
      languageKey,
      variant,
      command,
      lines,
    });
  }, []);

  const handleRun = useCallback(async (event) => {
    event?.preventDefault();

    const analysis = analyzeSubmission(code);

    if (!analysis.parsed) {
      setErrorLine(analysis.syntaxError?.line ?? 1);
      openIdeTerminal(detectedLanguage.key, "error", [
        `**IDE validation failed** at line ${analysis.syntaxError?.line ?? 1}.`,
        analysis.syntaxError?.message ?? "Invalid print syntax.",
      ]);
      textareaRef.current?.focus();
      return;
    }

    const visibleOutput = analysis.parsed.output.trim();
    const visibleTextLength = stripAnsiSequences(visibleOutput).trim().length;

    if (!visibleTextLength) {
      setErrorLine(null);
      openIdeTerminal(analysis.parsed.language, "error", [
        "**Nothing to send yet.**",
        "Your program needs to print at least one visible character before it can post to the wall.",
      ]);
      textareaRef.current?.focus();
      return;
    }

    if (visibleTextLength > MESSAGE_CHAR_LIMIT) {
      setErrorLine(null);
      openIdeTerminal(analysis.parsed.language, "error", [
        `**Output length:** ${visibleTextLength}/${MESSAGE_CHAR_LIMIT}`,
        `Max ${MESSAGE_CHAR_LIMIT} characters per wall entry.`,
      ]);
      textareaRef.current?.focus();
      return;
    }

    const lastSent = Number(window.localStorage.getItem(LAST_SENT_STORAGE_KEY) ?? 0);
    const remainingCooldown = MESSAGE_COOLDOWN_MS - (Date.now() - lastSent);
    if (remainingCooldown > 0) {
      openIdeTerminal(analysis.parsed.language, "error", [
        "**Cooldown active.**",
        `Wait ${Math.ceil(remainingCooldown / 1000)}s before sending another entry.`,
      ]);
      textareaRef.current?.focus();
      return;
    }

    setIsSubmitting(true);
    setErrorLine(null);
    const payload = {
      text: visibleOutput,
      full_code: code,
      language: analysis.parsed.language,
    };

    const { error: insertError, insertedKeys } = await insertMessageWithFallback(payload);

    setIsSubmitting(false);

    if (insertError) {
      openIdeTerminal(analysis.parsed.language, "error", [
        "**Supabase rejected the entry.**",
        insertError.message,
      ]);
      textareaRef.current?.focus();
      return;
    }

    window.localStorage.setItem(LAST_SENT_STORAGE_KEY, String(Date.now()));
    const successLines = [
      visibleOutput,
      "**Entry sent to wall.**",
    ];

    if (!insertedKeys.includes("language")) {
      successLines.push("*Entry accepted with fallback schema support.*");
    } else {
      successLines.push("*IDE terminal will close automatically in 3 seconds.*");
    }

    openIdeTerminal(analysis.parsed.language, "success", successLines);
    // Don't focus textarea after successful submission to prevent keyboard on mobile
  }, [code, detectedLanguage.key, openIdeTerminal]);

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
        @keyframes blinkCursor { 50% { opacity: 0; } }
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

      {sidebarOpen && <div onClick={() => setSidebarOpen(false)} style={styles.sidebarScrim} />}

      {showTutorialDialog && (
        <div style={styles.tutorialOverlay} onClick={() => setShowTutorialDialog(false)}>
          <section style={styles.tutorialDialog} onClick={(event) => event.stopPropagation()}>
            <div style={styles.tutorialHeader}>
              <div>
                <div style={styles.tutorialEyebrow}>How To Use The Terminal IDE</div>
                <h2 style={styles.tutorialTitle}>Write code, print your message, then run it.</h2>
              </div>
              <button type="button" onClick={() => setShowTutorialDialog(false)} style={styles.tutorialClose}>
                x
              </button>
            </div>

            <div style={styles.tutorialBody}>
              <p style={styles.tutorialParagraph}>
                This editor posts only what your program prints. The code itself is saved too,
                but the wall entry comes from the terminal output.
              </p>

              <div style={styles.tutorialSteps}>
                <div style={styles.tutorialStep}>
                  <span style={styles.tutorialStepNumber}>1</span>
                  <div>
                    <div style={styles.tutorialStepTitle}>Pick a language</div>
                    <div style={styles.tutorialStepCopy}>Python, JavaScript, Java, C++, and C# are supported.</div>
                  </div>
                </div>
                <div style={styles.tutorialStep}>
                  <span style={styles.tutorialStepNumber}>2</span>
                  <div>
                    <div style={styles.tutorialStepTitle}>Print your message</div>
                    <div style={styles.tutorialStepCopy}>Use `print(...)`, `console.log(...)`, `cout`, or `Console.WriteLine(...)`.</div>
                  </div>
                </div>
                <div style={styles.tutorialStep}>
                  <span style={styles.tutorialStepNumber}>3</span>
                  <div>
                    <div style={styles.tutorialStepTitle}>Click Run</div>
                    <div style={styles.tutorialStepCopy}>If the output is valid, the message is sent to the wall.</div>
                  </div>
                </div>
              </div>

              <div style={styles.tutorialExamples}>
                <div style={styles.tutorialExampleTitle}>Quick examples</div>
                <code style={styles.tutorialCode}>print("hello wall")</code>
                <code style={styles.tutorialCode}>console.log("hello wall")</code>
                <code style={styles.tutorialCode}>System.out.println("hello wall");</code>
              </div>

              <p style={styles.tutorialHint}>
                Java needs a class with `main`, C++ needs `int main()`, and C# needs `Main()`.
              </p>
            </div>

            <div style={styles.tutorialActions}>
              <button
                type="button"
                style={styles.tutorialGhostButton}
                onClick={() => {
                  loadSnippet("python");
                  setShowTutorialDialog(false);
                }}
              >
                Load Python Example
              </button>
              <button type="button" style={styles.tutorialPrimaryButton} onClick={() => setShowTutorialDialog(false)}>
                Start Coding
              </button>
            </div>
          </section>
        </div>
      )}

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
                  Python now supports string variables, f-strings, triple-quoted multiline
                  text, and simple `for ... in range(...)` loops in the wall preview.
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
                  aria-label="CCS Freedom IDE code editor"
                  autoCapitalize="off"
                  autoCorrect="off"
                  autoComplete="off"
                  spellCheck={false}
                  inputMode="text"
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

            {terminalSession && (
              <section style={styles.ideTerminal}>
                <div style={styles.ideTerminalHeader}>
                  <div style={styles.ideTerminalTitleRow}>
                    <span style={styles.ideTerminalTitle}>TERMINAL</span>
                    <span
                      style={{
                        ...styles.ideTerminalBadge,
                        color: terminalSession.variant === "error" ? "#ffb3b3" : "#8ef0b6",
                        borderColor: terminalSession.variant === "error" ? "rgba(255,107,107,0.3)" : "rgba(88, 214, 141, 0.3)",
                      }}
                    >
                      {terminalSession.variant === "error" ? "error" : "success"}
                    </span>
                  </div>
                  <button type="button" onClick={() => setTerminalSession(null)} style={styles.ideTerminalClose}>
                    x
                  </button>
                </div>

                <div style={styles.ideTerminalBody}>
                  <div style={styles.ideTerminalPrompt}>
                    <span>{typedCommand}</span>
                    {typedCommand.length < terminalSession.command.length && <span style={styles.ideTerminalCursor} />}
                  </div>

                  {typedCommand.length === terminalSession.command.length &&
                    terminalSession.lines.slice(0, visibleTerminalLines).map((line, index) => (
                      <div
                        key={`${terminalSession.id}-${index}`}
                        style={{
                          ...styles.ideTerminalLine,
                          color:
                            terminalSession.variant === "error" && index > 0
                              ? "#ff9a9a"
                              : terminalSession.variant === "success" && index === 0
                                ? "#d4d4d4"
                                : terminalSession.variant === "success"
                                  ? "#8ef0b6"
                                  : "#c7ccd1",
                        }}
                      >
                        {terminalSession.variant === "success" && terminalSession.languageKey === "python"
                          ? renderAnsiText(
                            line,
                            `${terminalSession.id}-${index}`,
                            index === 0 ? "#d4d4d4" : "#8ef0b6"
                          )
                          : renderFormattedTerminalText(line, `${terminalSession.id}-${index}`)}
                      </div>
                    ))}
                </div>
              </section>
            )}

            <div style={styles.statusBar}>
              <div style={styles.statusGroup}>
                <span>main</span>
                <span style={{ ...styles.languageChip, background: detectedLanguage.accent }}>{detectedLanguage.name}</span>
              </div>

              <div style={styles.statusGroup}>
                <span>{lineCount} lines</span>
                <span
                  style={{
                    color:
                      previewOutput === null
                        ? "#c3d8e5"
                        : previewLength > MESSAGE_CHAR_LIMIT
                          ? "#ffd1d1"
                          : previewLength === 0
                            ? "#ffe29c"
                            : "#ffffff",
                  }}
                >
                  entry {previewOutput === null ? "--" : previewLength}/{MESSAGE_CHAR_LIMIT}
                </span>
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
  tutorialOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(5, 8, 12, 0.76)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px",
    zIndex: 40,
  },
  tutorialDialog: {
    width: "min(640px, 100%)",
    maxHeight: "min(88dvh, 760px)",
    overflowY: "auto",
    border: "1px solid #2d323a",
    borderRadius: "16px",
    background: "#181a1f",
    boxShadow: "0 28px 80px rgba(0, 0, 0, 0.45)",
  },
  tutorialHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "16px",
    padding: "20px 22px 14px",
    borderBottom: `1px solid ${VS.border}`,
  },
  tutorialEyebrow: {
    fontSize: "11px",
    color: "#7ca6ff",
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    fontFamily: "-apple-system, sans-serif",
    fontWeight: 700,
    marginBottom: "8px",
  },
  tutorialTitle: {
    margin: 0,
    color: "#f3f6fb",
    fontSize: "24px",
    lineHeight: 1.2,
    fontFamily: "-apple-system, sans-serif",
    fontWeight: 700,
  },
  tutorialClose: {
    border: "none",
    background: "transparent",
    color: "#828891",
    cursor: "pointer",
    fontSize: "18px",
    lineHeight: 1,
    padding: "4px",
  },
  tutorialBody: {
    padding: "18px 22px",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
  },
  tutorialParagraph: {
    margin: 0,
    color: "#c8cdd5",
    fontSize: "14px",
    lineHeight: 1.65,
    fontFamily: "-apple-system, sans-serif",
  },
  tutorialSteps: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  tutorialStep: {
    display: "flex",
    gap: "12px",
    alignItems: "flex-start",
    padding: "12px 14px",
    borderRadius: "12px",
    background: "#121419",
    border: "1px solid #292d34",
  },
  tutorialStepNumber: {
    minWidth: "28px",
    height: "28px",
    borderRadius: "999px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#22365d",
    color: "#d9e5ff",
    fontSize: "12px",
    fontWeight: 700,
    fontFamily: "-apple-system, sans-serif",
  },
  tutorialStepTitle: {
    color: "#f4f7fb",
    fontSize: "14px",
    fontWeight: 600,
    fontFamily: "-apple-system, sans-serif",
    marginBottom: "4px",
  },
  tutorialStepCopy: {
    color: "#adb5bf",
    fontSize: "13px",
    lineHeight: 1.55,
    fontFamily: "-apple-system, sans-serif",
  },
  tutorialExamples: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "14px",
    borderRadius: "12px",
    background: "#111111",
    border: "1px solid #2a2a2a",
  },
  tutorialExampleTitle: {
    color: "#e3e7ed",
    fontSize: "13px",
    fontWeight: 600,
    fontFamily: "-apple-system, sans-serif",
  },
  tutorialCode: {
    color: "#8ef0b6",
    fontSize: "12px",
    lineHeight: 1.5,
    fontFamily: "'SF Mono', Consolas, 'Courier New', monospace",
  },
  tutorialHint: {
    margin: 0,
    color: "#98a1ac",
    fontSize: "12px",
    lineHeight: 1.6,
    fontFamily: "-apple-system, sans-serif",
  },
  tutorialActions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "10px",
    padding: "0 22px 22px",
    flexWrap: "wrap",
  },
  tutorialGhostButton: {
    minHeight: "38px",
    padding: "8px 14px",
    borderRadius: "8px",
    border: "1px solid #394150",
    background: "#20242c",
    color: "#d7dde7",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 600,
    fontFamily: "-apple-system, sans-serif",
  },
  tutorialPrimaryButton: {
    minHeight: "38px",
    padding: "8px 16px",
    borderRadius: "8px",
    border: "1px solid #2a8e49",
    background: "#146c2e",
    color: "#ffffff",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 700,
    fontFamily: "-apple-system, sans-serif",
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
  ideTerminal: {
    background: "#181818",
    borderTop: "1px solid #2c2c2c",
    animation: "fadeUp 0.16s ease",
    flexShrink: 0,
  },
  ideTerminalHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "6px 12px",
    borderBottom: "1px solid #262626",
    fontFamily: "-apple-system, sans-serif",
  },
  ideTerminalTitleRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  ideTerminalTitle: {
    fontSize: "10px",
    letterSpacing: "0.1em",
    color: "#a0a0a0",
    textTransform: "uppercase",
    fontWeight: 700,
  },
  ideTerminalBadge: {
    padding: "2px 6px",
    borderRadius: "999px",
    border: "1px solid",
    fontSize: "10px",
    textTransform: "uppercase",
  },
  ideTerminalClose: {
    border: "none",
    background: "transparent",
    color: "#858585",
    cursor: "pointer",
    fontSize: "16px",
    lineHeight: 1,
  },
  ideTerminalBody: {
    padding: "10px 12px 12px",
    fontFamily: "'SF Mono', Consolas, 'Courier New', monospace",
    fontSize: "12px",
    lineHeight: 1.6,
    color: "#d4d4d4",
    maxHeight: "180px",
    overflowY: "auto",
    background: "#111111",
  },
  ideTerminalPrompt: {
    display: "flex",
    alignItems: "center",
    minHeight: "20px",
    color: "#d4d4d4",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  ideTerminalCursor: {
    display: "inline-block",
    width: "7px",
    height: "15px",
    marginLeft: "2px",
    background: "#d4d4d4",
    animation: "blinkCursor 1s step-end infinite",
  },
  ideTerminalLine: {
    marginTop: "4px",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  terminalStrong: {
    fontWeight: 700,
    color: "inherit",
  },
  terminalEmphasis: {
    fontStyle: "italic",
    color: "#8fd7ff",
  },
  terminalUnderline: {
    textDecoration: "underline",
    textUnderlineOffset: "2px",
    color: "inherit",
  },
  terminalCode: {
    fontFamily: "'SF Mono', Consolas, 'Courier New', monospace",
    fontSize: "0.95em",
    background: "rgba(255, 255, 255, 0.08)",
    border: "1px solid rgba(255, 255, 255, 0.08)",
    borderRadius: "4px",
    padding: "1px 5px",
    color: "#f4d58d",
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
};
