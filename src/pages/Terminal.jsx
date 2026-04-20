import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../utils/supabaseClient.js";
import { analyzeSubmission } from "../utils/parser.js";

const HELP_STORAGE_KEY = "ccs-freedom-screen-terminal-help-dismissed";
const WRAP_STORAGE_KEY = "ccs-freedom-screen-terminal-wrap-lines";

function getInitialHelpState() {
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem(HELP_STORAGE_KEY) !== "1";
}

function getInitialWrapState() {
  if (typeof window === "undefined") {
    return true;
  }

  const stored = window.localStorage.getItem(WRAP_STORAGE_KEY);

  if (stored === "0") {
    return false;
  }

  if (stored === "1") {
    return true;
  }

  return window.innerWidth < 820;
}

export default function Terminal() {
  const [code, setCode] = useState("");
  const [showHelp, setShowHelp] = useState(getInitialHelpState);
  const [wrapLines, setWrapLines] = useState(getInitialWrapState);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState(null);
  const [errorLine, setErrorLine] = useState(null);
  const textareaRef = useRef(null);

  const displayCode = code;
  const displayLines = useMemo(() => displayCode.split(/\r?\n/), [displayCode]);

  useEffect(() => {
    if (!toast || typeof window === "undefined") {
      return undefined;
    }

    const timeout = window.setTimeout(() => setToast(null), 2600);

    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (showHelp || typeof window === "undefined") {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [showHelp]);

  const dismissHelp = () => {
    setShowHelp(false);

    if (typeof window !== "undefined") {
      window.localStorage.setItem(HELP_STORAGE_KEY, "1");
    }
  };

  const toggleWrapLines = () => {
    setWrapLines((previous) => {
      const next = !previous;

      if (typeof window !== "undefined") {
        window.localStorage.setItem(WRAP_STORAGE_KEY, next ? "1" : "0");
      }

      return next;
    });
  };

  const focusEditor = () => {
    textareaRef.current?.focus();
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
      focusEditor();
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

    const { error: extendedInsertError } = await supabase
      .from("messages")
      .insert([payload]);

    if (extendedInsertError) {
      const missingColumnError =
        extendedInsertError.message.includes("full_code") ||
        extendedInsertError.message.includes("language") ||
        extendedInsertError.message.includes("column");

      if (missingColumnError) {
        const { error: fallbackInsertError } = await supabase
          .from("messages")
          .insert([
            {
              text: analysis.parsed.output.trim(),
            },
          ]);

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
      focusEditor();
      return;
    }

    setCode("");
    setToast({
      kind: "success",
      message: "entry sent",
    });
    focusEditor();
  };

  return (
    <main style={styles.page}>
      {showHelp && (
        <section style={styles.modalBackdrop}>
          <div style={styles.modal}>
            <button
              aria-label="Close help"
              onClick={dismissHelp}
              style={styles.modalCloseButton}
              type="button"
            >
              x
            </button>
            <h2 style={styles.modalTitle}>how to post</h2>

            <p style={styles.modalBody}>
              This terminal turns code into a message. Only the output of a
              valid print statement will be posted.
            </p>

            <p style={styles.modalBody}>Supported languages:</p>

            <pre style={styles.modalCode}>
              {`Python:
print("hello wall")

JavaScript:
console.log("hello wall")

Java:
System.out.println("hello wall");

C++:
cout << "hello wall";`}
            </pre>

            <p style={styles.modalBody}>Invalid syntax will be rejected</p>

            <button
              onClick={dismissHelp}
              style={styles.modalButton}
              type="button"
            >
              done
            </button>
          </div>
        </section>
      )}

      {toast && (
        <div
          aria-live="polite"
          className="terminal-toast"
          style={{
            ...styles.toast,
            borderColor: toast.kind === "error" ? "#5a1d1d" : "#163225",
            color: toast.kind === "error" ? "#ff9a9a" : "#8ef0b6",
          }}
        >
          {toast.message}
        </div>
      )}

      <section style={styles.shell}>
        <header style={styles.header}>
          <span style={styles.headerTitle}>ccs freedom screen</span>
          <div style={styles.headerActions}>
            <button
              onClick={toggleWrapLines}
              style={styles.headerButton}
              type="button"
            >
              wrap:{wrapLines ? "on" : "off"}
            </button>
            <button
              onClick={() => setShowHelp(true)}
              style={styles.headerButton}
              type="button"
            >
              help
            </button>
          </div>
        </header>

        <form onSubmit={handleRun} style={styles.form}>
          <div
            style={{
              ...styles.editorShell,
              borderColor: errorLine ? "#5c1d1d" : "#1b1f1d",
              boxShadow: errorLine
                ? "0 0 0 1px rgba(255, 77, 77, 0.18)"
                : "0 0 0 1px rgba(0, 0, 0, 0.2)",
            }}
          >
            <div style={styles.editorTopbar}>
              <span style={styles.editorFilename}>
                entry.{inferExtension(code)}
              </span>
              <span style={styles.editorState}>
                {errorLine ? `line ${errorLine}` : "ready"}
              </span>
            </div>

            <div style={styles.editorBody}>
              {/* LEFT SIDE (line numbers + pipes) */}
              <div style={styles.gutter}>
                {displayLines.map((_, i) => (
                  <div key={i} style={styles.gutterLine}>
                    {String(i + 1).padStart(2, "0")} |
                  </div>
                ))}
              </div>

              {/* RIGHT SIDE (REAL textarea) */}
              <textarea
                ref={textareaRef}
                aria-label="CCS Freedom Screen code editor"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                wrap={wrapLines ? "soft" : "off"}
                style={styles.textarea}
                value={code}
                onChange={(event) => {
                  setCode(event.target.value);
                  if (errorLine) setErrorLine(null);
                }}
              />
            </div>
          </div>

          <div style={styles.actions}>
            <button
              disabled={isSubmitting}
              style={styles.runButton}
              type="submit"
            >
              {isSubmitting ? "running..." : "run"}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}

function inferExtension(code) {
  if (code.includes("System.out.println")) {
    return "java";
  }

  if (code.includes("cout <<") || code.includes("#include")) {
    return "cpp";
  }

  if (code.includes("console.log")) {
    return "js";
  }

  return "py";
}

const styles = {
  page: {
    minHeight: "100dvh",
    padding: "16px",
    background: "#050505",
    color: "#00ff88",
  },
  shell: {
    width: "min(100%, 1080px)",
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    flexWrap: "wrap",
  },
  headerTitle: {
    fontSize: "14px",
    color: "#82b89c",
    letterSpacing: "0.08em",
    textTransform: "lowercase",
  },
  headerActions: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
  },
  headerButton: {
    minHeight: "40px",
    minWidth: "88px",
    padding: "8px 12px",
    borderRadius: "4px",
    border: "1px solid #1d2a23",
    background: "#0a0a0a",
    color: "#9cc7b0",
    cursor: "pointer",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  editorShell: {
    border: "1px solid",
    borderRadius: "6px",
    overflow: "hidden",
    background: "#0b0b0b",
    touchAction: "manipulation", // smoother mobile typing
  },
  editorTopbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    padding: "8px 12px",
    borderBottom: "1px solid #151515",
    background: "#080808",
  },
  editorFilename: {
    fontSize: "13px",
    color: "#86a595",
  },
  editorState: {
    fontSize: "12px",
    color: "#5f7b6d",
  },
  codePreview: {
    position: "absolute",
    inset: 0,
    margin: 0,
    padding: "16px 16px 16px 56px",
    overflow: "auto",
    pointerEvents: "none",
    fontSize: "16px",
    lineHeight: 1.6,
    color: "#d0d7d3",
  },
  codeLine: {
    display: "grid",
    gridTemplateColumns: "32px 1fr",
    alignItems: "start",
  },
  lineNumber: {
    color: "#355143",
    userSelect: "none",
  },
  lineContent: {
    color: "#d0d7d3",
    overflowWrap: "anywhere",
  },
  editorBody: {
    display: "grid",
    gridTemplateColumns: "64px 1fr",
    minHeight: "min(76dvh, 780px)",
    background: "#0b0b0b",
  },

  gutter: {
    padding: "16px 8px",
    background: "#080808",
    color: "#355143",
    textAlign: "right",
    userSelect: "none",
    fontSize: "16px",
    lineHeight: "24px",
  },

  gutterLine: {
    height: "24px",
  },

  textarea: {
    width: "100%",
    height: "100%",
    padding: "16px",
    border: "none",
    outline: "none",
    resize: "none",
    background: "transparent",
    color: "#d0d7d3",
    caretColor: "#d0d7d3",
    fontSize: "16px",
    lineHeight: "24px",
    overflow: "auto",
    whiteSpace: "pre-wrap",
  },
  actions: {
    display: "flex",
    justifyContent: "flex-end",
  },
  runButton: {
    minHeight: "48px",
    minWidth: "112px",
    padding: "10px 16px",
    borderRadius: "4px",
    border: "1px solid #1d2a23",
    background: "#0a0a0a",
    color: "#00ff88",
    cursor: "pointer",
  },
  toast: {
    position: "fixed",
    top: "16px",
    right: "16px",
    zIndex: 30,
    maxWidth: "min(92vw, 320px)",
    padding: "12px 16px",
    borderRadius: "4px",
    border: "1px solid",
    background: "#090909",
    boxShadow: "0 10px 24px rgba(0, 0, 0, 0.35)",
    fontSize: "14px",
  },
  modalBackdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 40,
    display: "grid",
    placeItems: "center",
    padding: "16px",
    background: "rgba(0, 0, 0, 0.8)",
  },
  modal: {
    position: "relative",
    width: "min(100%, 460px)",
    padding: "24px",
    borderRadius: "6px",
    border: "1px solid #1d2a23",
    background: "#080808",
    color: "#9dc3b0",
  },
  modalCloseButton: {
    position: "absolute",
    top: "8px",
    right: "8px",
    width: "32px",
    height: "32px",
    borderRadius: "4px",
    border: "1px solid #1d2a23",
    background: "#0a0a0a",
    color: "#00ff88",
    cursor: "pointer",
  },
  modalTitle: {
    margin: 0,
    fontSize: "18px",
    color: "#d0d7d3",
  },
  modalBody: {
    margin: "12px 0",
    fontSize: "14px",
    lineHeight: 1.6,
    color: "#8ea898",
  },
  modalCode: {
    margin: 0,
    padding: "12px",
    border: "1px solid #151515",
    background: "#050505",
    color: "#c5d3cb",
    fontSize: "14px",
    overflow: "auto",
  },
  modalButton: {
    marginTop: "16px",
    minHeight: "44px",
    width: "100%",
    borderRadius: "4px",
    border: "1px solid #1d2a23",
    background: "#0a0a0a",
    color: "#00ff88",
    cursor: "pointer",
  },
};
