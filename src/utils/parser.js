import { getLanguageConfig } from "./languages.js";

const LANGUAGE_SCORES = [
  {
    key: "csharp",
    patterns: [
      [/\bConsole\.WriteLine\s*\(/g, 8],
      [/\busing\s+System\s*;/g, 4],
      [/\bstatic\s+void\s+Main\s*\(/g, 6],
      [/\bnamespace\s+[A-Za-z_]\w*/g, 2],
    ],
  },
  {
    key: "java",
    patterns: [
      [/\bSystem\.out\.println\s*\(/g, 8],
      [/\bpublic\s+static\s+void\s+main\s*\(/g, 6],
      [/\bclass\s+[A-Za-z_]\w*/g, 2],
      [/\bimport\s+java\./g, 3],
    ],
  },
  {
    key: "cpp",
    patterns: [
      [/#include\s*<iostream>/g, 6],
      [/\bstd::cout\b/g, 5],
      [/\bcout\s*<</g, 5],
      [/\bint\s+main\s*\(/g, 6],
      [/\busing\s+namespace\s+std\s*;/g, 3],
    ],
  },
  {
    key: "javascript",
    patterns: [
      [/\bconsole\.log\s*\(/g, 8],
      [/\b(?:const|let|var)\b/g, 2],
      [/\bfunction\b/g, 2],
      [/=>/g, 1],
    ],
  },
  {
    key: "python",
    patterns: [
      [/\bprint\s*\(/g, 8],
      [/^\s*def\s+\w+\s*\(/gm, 2],
      [/^\s*import\s+\w+/gm, 2],
      [/^\s*from\s+\w+\s+import\s+/gm, 2],
      [/\belif\b/g, 1],
    ],
  },
];

function lineNumberAt(code, index) {
  return code.slice(0, index).split("\n").length;
}

function decodeEscapes(value) {
  return value
    .replace(/\\r/g, "\r")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, "\\");
}

function extractLiteral(token) {
  const trimmed = token.trim();

  const tripleQuoteMatch = trimmed.match(/^(?:[furbFURB]{0,2})?("""|''')([\s\S]*?)\1$/);
  if (tripleQuoteMatch) {
    return decodeEscapes(tripleQuoteMatch[2]);
  }

  const verbatimCsharpMatch = trimmed.match(/^@"([\s\S]*)"$/);
  if (verbatimCsharpMatch) {
    return verbatimCsharpMatch[1].replace(/""/g, '"');
  }

  const quotedMatch = trimmed.match(/^(?:[furbFURB]{0,2})?(["'])([\s\S]*?)\1$/);
  if (quotedMatch) {
    return decodeEscapes(quotedMatch[2]);
  }

  const templateMatch = trimmed.match(/^`([\s\S]*)`$/);
  if (templateMatch && !templateMatch[1].includes("${")) {
    return decodeEscapes(templateMatch[1]);
  }

  return null;
}

function splitExpression(expression, separatorKind) {
  const parts = [];
  let current = "";
  let state = null;

  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index];
    const next = expression[index + 1];
    const nextThree = expression.slice(index, index + 3);

    if (state === "tripleDouble") {
      current += char;
      if (nextThree === '"""') {
        current += expression[index + 1] + expression[index + 2];
        index += 2;
        state = null;
      }
      continue;
    }

    if (state === "tripleSingle") {
      current += char;
      if (nextThree === "'''") {
        current += expression[index + 1] + expression[index + 2];
        index += 2;
        state = null;
      }
      continue;
    }

    if (state) {
      current += char;
      if (char === "\\" && next) {
        current += next;
        index += 1;
      } else if (char === state) {
        state = null;
      }
      continue;
    }

    if (nextThree === '"""') {
      current += nextThree;
      index += 2;
      state = "tripleDouble";
      continue;
    }

    if (nextThree === "'''") {
      current += nextThree;
      index += 2;
      state = "tripleSingle";
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      state = char;
      current += char;
      continue;
    }

    if (separatorKind === "plus" && char === "+") {
      parts.push(current.trim());
      current = "";
      continue;
    }

    if (separatorKind === "shift" && char === "<" && next === "<") {
      parts.push(current.trim());
      current = "";
      index += 1;
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts.filter(Boolean);
}

function resolveExpression(expression, separatorKind, variables) {
  const tokens = splitExpression(expression, separatorKind);
  if (tokens.length === 0) return null;

  const resolved = [];

  for (const token of tokens) {
    if (token === "endl" || token === "std::endl") {
      resolved.push("\n");
      continue;
    }

    const literal = extractLiteral(token);
    if (literal !== null) {
      resolved.push(literal);
      continue;
    }

    const normalized = token.replace(/^\(([\s\S]*)\)$/, "$1").trim();
    if (variables.has(normalized)) {
      resolved.push(variables.get(normalized));
      continue;
    }

    return null;
  }

  return resolved.join("");
}

function findMatchingParen(code, openParenIndex) {
  let depth = 1;
  let state = null;

  for (let index = openParenIndex + 1; index < code.length; index += 1) {
    const char = code[index];
    const next = code[index + 1];
    const nextThree = code.slice(index, index + 3);

    if (state === "lineComment") {
      if (char === "\n") state = null;
      continue;
    }

    if (state === "blockComment") {
      if (char === "*" && next === "/") {
        state = null;
        index += 1;
      }
      continue;
    }

    if (state === "tripleDouble") {
      if (nextThree === '"""') {
        state = null;
        index += 2;
      }
      continue;
    }

    if (state === "tripleSingle") {
      if (nextThree === "'''") {
        state = null;
        index += 2;
      }
      continue;
    }

    if (state) {
      if (char === "\\" && next) {
        index += 1;
      } else if (char === state) {
        state = null;
      }
      continue;
    }

    if (char === "/" && next === "/") {
      state = "lineComment";
      index += 1;
      continue;
    }

    if (char === "/" && next === "*") {
      state = "blockComment";
      index += 1;
      continue;
    }

    if (nextThree === '"""') {
      state = "tripleDouble";
      index += 2;
      continue;
    }

    if (nextThree === "'''") {
      state = "tripleSingle";
      index += 2;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      state = char;
      continue;
    }

    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (depth === 0) return index;
  }

  return -1;
}

function nextMeaningfulCharacter(code, startIndex) {
  let index = startIndex;

  while (index < code.length) {
    const char = code[index];
    const next = code[index + 1];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (char === "/" && next === "/") {
      index += 2;
      while (index < code.length && code[index] !== "\n") index += 1;
      continue;
    }

    if (char === "/" && next === "*") {
      index += 2;
      while (index < code.length && !(code[index] === "*" && code[index + 1] === "/")) index += 1;
      index += 2;
      continue;
    }

    return { char, index };
  }

  return null;
}

function findCallSites(code, pattern) {
  const sites = [];
  const matcher = new RegExp(pattern.source, pattern.flags);
  let match;

  while ((match = matcher.exec(code)) !== null) {
    const openParenIndex = match.index + match[0].length - 1;
    const closeParenIndex = findMatchingParen(code, openParenIndex);

    if (closeParenIndex === -1) {
      return {
        sites: [],
        errorLine: lineNumberAt(code, match.index),
      };
    }

    sites.push({
      args: code.slice(openParenIndex + 1, closeParenIndex),
      line: lineNumberAt(code, match.index),
      closeParenIndex,
    });

    matcher.lastIndex = closeParenIndex + 1;
  }

  return { sites, errorLine: null };
}

function collectVariables(code, regex) {
  const variables = new Map();
  const matcher = new RegExp(regex.source, regex.flags);
  let match;

  while ((match = matcher.exec(code)) !== null) {
    const value = extractLiteral(match[2]);
    if (value !== null) {
      variables.set(match[1], value);
    }
  }

  return variables;
}

function checkBalancedStructure(code) {
  const stack = [];
  let state = null;
  let line = 1;

  for (let index = 0; index < code.length; index += 1) {
    const char = code[index];
    const next = code[index + 1];
    const nextThree = code.slice(index, index + 3);

    if (char === "\n") line += 1;

    if (state === "lineComment") {
      if (char === "\n") state = null;
      continue;
    }

    if (state === "blockComment") {
      if (char === "*" && next === "/") {
        state = null;
        index += 1;
      }
      continue;
    }

    if (state === "tripleDouble") {
      if (nextThree === '"""') {
        state = null;
        index += 2;
      }
      continue;
    }

    if (state === "tripleSingle") {
      if (nextThree === "'''") {
        state = null;
        index += 2;
      }
      continue;
    }

    if (state) {
      if (char === "\\" && next) {
        index += 1;
      } else if (char === state) {
        state = null;
      }
      continue;
    }

    if (char === "/" && next === "/") {
      state = "lineComment";
      index += 1;
      continue;
    }

    if (char === "/" && next === "*") {
      state = "blockComment";
      index += 1;
      continue;
    }

    if (nextThree === '"""') {
      state = "tripleDouble";
      index += 2;
      continue;
    }

    if (nextThree === "'''") {
      state = "tripleSingle";
      index += 2;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      state = char;
      continue;
    }

    if (char === "(" || char === "[" || char === "{") {
      stack.push({ char, line });
      continue;
    }

    if (char === ")" || char === "]" || char === "}") {
      const previous = stack.pop();
      const isMatch =
        (char === ")" && previous?.char === "(") ||
        (char === "]" && previous?.char === "[") ||
        (char === "}" && previous?.char === "{");

      if (!isMatch) {
        return {
          line,
          message: "There is an unmatched closing bracket or brace.",
        };
      }
    }
  }

  if (state && state !== "lineComment") {
    return {
      line,
      message: "A string or comment looks unfinished.",
    };
  }

  if (stack.length > 0) {
    return {
      line: stack[stack.length - 1].line,
      message: "A bracket, parenthesis, or brace is not closed.",
    };
  }

  return null;
}

function findSemicolonIssue(code, patterns, message) {
  const lines = code.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].replace(/\/\/.*$/, "").trim();
    if (!trimmed) continue;
    if (trimmed.endsWith(";") || trimmed.endsWith("{") || trimmed.endsWith("}")) continue;

    if (patterns.some((pattern) => pattern.test(trimmed))) {
      return { line: index + 1, message };
    }
  }

  return null;
}

function parsePython(code) {
  const structuralError = checkBalancedStructure(code);
  if (structuralError) return { parsed: null, syntaxError: structuralError };

  const variables = collectVariables(
    code,
    /(?:^|\n)\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'))/g
  );

  const { sites, errorLine } = findCallSites(code, /print\s*\(/g);
  if (errorLine) {
    return {
      parsed: null,
      syntaxError: {
        line: errorLine,
        message: "The Python print call is not closed properly.",
      },
    };
  }

  if (sites.length === 0) {
    return {
      parsed: null,
      syntaxError: {
        line: 1,
        message: 'Add a `print(...)` call. Python can post single-line strings, variables, or triple-quoted multiline text.',
      },
    };
  }

  const outputs = [];

  for (const site of sites) {
    const resolved = resolveExpression(site.args, "plus", variables);
    if (resolved === null) {
      return {
        parsed: null,
        syntaxError: {
          line: site.line,
          message: "Python print output must be a quoted string, a string variable, or string concatenation.",
        },
      };
    }
    outputs.push(resolved);
  }

  return {
    parsed: {
      language: "python",
      output: outputs.join("\n"),
    },
    syntaxError: null,
  };
}

function parseJavaScript(code) {
  const structuralError = checkBalancedStructure(code);
  if (structuralError) return { parsed: null, syntaxError: structuralError };

  const consoleMatches = code.match(/\bconsole\.log\s*\(/g);
  if (!consoleMatches || consoleMatches.length === 0) {
    return {
      parsed: null,
      syntaxError: {
        line: 1,
        message: 'Add a `console.log(...)` call so the terminal has output to post.',
      },
    };
  }

  const logs = [];

  try {
    const runner = new Function("console", code);
    runner({
      log: (...values) => {
        logs.push(
          values
            .map((value) => {
              if (typeof value === "string") return value;
              try {
                return JSON.stringify(value, null, 2);
              } catch {
                return String(value);
              }
            })
            .join(" ")
        );
      },
    });
  } catch (error) {
    const stack = String(error?.stack ?? "");
    const lineMatch = stack.match(/<anonymous>:(\d+):\d+/);
    const line = lineMatch ? Math.max(1, Number(lineMatch[1]) - 2) : 1;

    return {
      parsed: null,
      syntaxError: {
        line,
        message: error?.message ?? "JavaScript syntax error.",
      },
    };
  }

  return {
    parsed: {
      language: "javascript",
      output: logs.join("\n"),
    },
    syntaxError: null,
  };
}

function parseJava(code) {
  const structuralError = checkBalancedStructure(code);
  if (structuralError) return { parsed: null, syntaxError: structuralError };

  if (!/\bclass\s+[A-Za-z_][A-Za-z0-9_]*\b/.test(code)) {
    return {
      parsed: null,
      syntaxError: {
        line: 1,
        message: "Java code needs a class declaration before it can run here.",
      },
    };
  }

  if (!/\bpublic\s+static\s+void\s+main\s*\(\s*String\s*\[\]\s*[A-Za-z_][A-Za-z0-9_]*\s*\)/.test(code)) {
    return {
      parsed: null,
      syntaxError: {
        line: 1,
        message: "Java code needs a `public static void main(String[] args)` entry point.",
      },
    };
  }

  const semicolonIssue = findSemicolonIssue(
    code,
    [
      /\bSystem\.out\.println\s*\(/,
      /^\s*String\s+[A-Za-z_][A-Za-z0-9_]*\s*=/,
      /^\s*(?:int|long|double|float|boolean|char)\s+[A-Za-z_][A-Za-z0-9_]*\s*=/,
      /^\s*return\b/,
      /^\s*import\s+/,
      /^\s*package\s+/,
    ],
    "Java statements like this need a semicolon."
  );
  if (semicolonIssue) return { parsed: null, syntaxError: semicolonIssue };

  const variables = collectVariables(
    code,
    /(?:^|\n)\s*String\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*("(?:[^"\\]|\\.)*")\s*;/g
  );

  const { sites, errorLine } = findCallSites(code, /System\.out\.println\s*\(/g);
  if (errorLine) {
    return {
      parsed: null,
      syntaxError: {
        line: errorLine,
        message: "The Java print call is not closed properly.",
      },
    };
  }

  if (sites.length === 0) {
    return {
      parsed: null,
      syntaxError: {
        line: 1,
        message: "Java code needs at least one `System.out.println(...)` call.",
      },
    };
  }

  const outputs = [];

  for (const site of sites) {
    const terminator = nextMeaningfulCharacter(code, site.closeParenIndex + 1);
    if (!terminator || terminator.char !== ";") {
      return {
        parsed: null,
        syntaxError: {
          line: site.line,
          message: "Java print statements must end with a semicolon.",
        },
      };
    }

    const resolved = resolveExpression(site.args, "plus", variables);
    if (resolved === null) {
      return {
        parsed: null,
        syntaxError: {
          line: site.line,
          message: "Java print output must be a quoted string, a string variable, or string concatenation.",
        },
      };
    }
    outputs.push(resolved);
  }

  return {
    parsed: {
      language: "java",
      output: outputs.join("\n"),
    },
    syntaxError: null,
  };
}

function parseCSharp(code) {
  const structuralError = checkBalancedStructure(code);
  if (structuralError) return { parsed: null, syntaxError: structuralError };

  if (!/\bclass\s+[A-Za-z_][A-Za-z0-9_]*\b/.test(code)) {
    return {
      parsed: null,
      syntaxError: {
        line: 1,
        message: "C# code needs a class declaration before it can run here.",
      },
    };
  }

  if (!/\bstatic\s+void\s+Main\s*\(/.test(code)) {
    return {
      parsed: null,
      syntaxError: {
        line: 1,
        message: "C# code needs a `static void Main()` entry point.",
      },
    };
  }

  const semicolonIssue = findSemicolonIssue(
    code,
    [
      /\bConsole\.WriteLine\s*\(/,
      /^\s*string\s+[A-Za-z_][A-Za-z0-9_]*\s*=/i,
      /^\s*(?:int|long|double|float|bool|char|var)\s+[A-Za-z_][A-Za-z0-9_]*\s*=/,
      /^\s*return\b/,
      /^\s*using\s+/,
    ],
    "C# statements like this need a semicolon."
  );
  if (semicolonIssue) return { parsed: null, syntaxError: semicolonIssue };

  const variables = collectVariables(
    code,
    /(?:^|\n)\s*string\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*("(?:[^"\\]|\\.)*"|@"[\s\S]*?")\s*;/gi
  );

  const { sites, errorLine } = findCallSites(code, /Console\.WriteLine\s*\(/g);
  if (errorLine) {
    return {
      parsed: null,
      syntaxError: {
        line: errorLine,
        message: "The C# print call is not closed properly.",
      },
    };
  }

  if (sites.length === 0) {
    return {
      parsed: null,
      syntaxError: {
        line: 1,
        message: "C# code needs at least one `Console.WriteLine(...)` call.",
      },
    };
  }

  const outputs = [];

  for (const site of sites) {
    const terminator = nextMeaningfulCharacter(code, site.closeParenIndex + 1);
    if (!terminator || terminator.char !== ";") {
      return {
        parsed: null,
        syntaxError: {
          line: site.line,
          message: "C# print statements must end with a semicolon.",
        },
      };
    }

    const resolved = resolveExpression(site.args, "plus", variables);
    if (resolved === null) {
      return {
        parsed: null,
        syntaxError: {
          line: site.line,
          message: "C# print output must be a quoted string, a string variable, or string concatenation.",
        },
      };
    }
    outputs.push(resolved);
  }

  return {
    parsed: {
      language: "csharp",
      output: outputs.join("\n"),
    },
    syntaxError: null,
  };
}

function parseCpp(code) {
  const structuralError = checkBalancedStructure(code);
  if (structuralError) return { parsed: null, syntaxError: structuralError };

  if (!/\bint\s+main\s*\([^)]*\)/.test(code)) {
    return {
      parsed: null,
      syntaxError: {
        line: 1,
        message: "C++ code needs an `int main()` function.",
      },
    };
  }

  if (!/#include\s*<iostream>/.test(code)) {
    return {
      parsed: null,
      syntaxError: {
        line: 1,
        message: "C++ output here expects `#include <iostream>`.",
      },
    };
  }

  const semicolonIssue = findSemicolonIssue(
    code,
    [
      /\b(?:std::)?cout\s*<</,
      /^\s*(?:std::string|string|auto|const\s+char\s*\*)\s+[A-Za-z_][A-Za-z0-9_]*\s*=/,
      /^\s*using\s+namespace\s+std\b/,
      /^\s*return\b/,
    ],
    "C++ statements like this need a semicolon."
  );
  if (semicolonIssue) return { parsed: null, syntaxError: semicolonIssue };

  const variables = collectVariables(
    code,
    /(?:^|\n)\s*(?:std::string|string|auto|const\s+char\s*\*)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*;/g
  );

  const outputs = [];
  const lines = code.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].replace(/\/\/.*$/, "").trim();
    if (!trimmed) continue;
    if (!/(?:std::)?cout\s*<</.test(trimmed)) continue;

    if (!trimmed.endsWith(";")) {
      return {
        parsed: null,
        syntaxError: {
          line: index + 1,
          message: "C++ print statements must end with a semicolon.",
        },
      };
    }

    const match = trimmed.match(/(?:std::)?cout\s*(<<[\s\S]+)\s*;/);
    if (!match) {
      return {
        parsed: null,
        syntaxError: {
          line: index + 1,
          message: "The C++ output line could not be parsed.",
        },
      };
    }

    const resolved = resolveExpression(match[1], "shift", variables);
    if (resolved === null) {
      return {
        parsed: null,
        syntaxError: {
          line: index + 1,
          message: "C++ output must use quoted strings, string variables, or `endl`.",
        },
      };
    }

    outputs.push(resolved);
  }

  if (outputs.length === 0) {
    return {
      parsed: null,
      syntaxError: {
        line: 1,
        message: "C++ code needs at least one `cout << ...;` line.",
      },
    };
  }

  return {
    parsed: {
      language: "cpp",
      output: outputs.join(""),
    },
    syntaxError: null,
  };
}

const ANALYZERS = {
  python: parsePython,
  javascript: parseJavaScript,
  java: parseJava,
  cpp: parseCpp,
  csharp: parseCSharp,
};

export function detectLanguage(code) {
  const normalizedCode = code.replace(/\r\n/g, "\n");
  const scored = LANGUAGE_SCORES.map((language) => {
    const score = language.patterns.reduce(
      (total, [pattern, weight]) => total + ((normalizedCode.match(pattern) ?? []).length * weight),
      0
    );
    return [language.key, score];
  }).sort((left, right) => right[1] - left[1]);

  return scored[0] && scored[0][1] > 0 ? scored[0][0] : "python";
}

export function analyzeSubmission(input) {
  const code = input.replace(/\r\n/g, "\n");

  if (!code.trim()) {
    return {
      parsed: null,
      syntaxError: {
        line: 1,
        message: "Write a supported program first, then run it.",
      },
    };
  }

  const detectedLanguage = detectLanguage(code);
  const analyzer = ANALYZERS[detectedLanguage];
  const result = analyzer(code);

  if (result.parsed || !result.syntaxError) {
    return result;
  }

  const languageName = getLanguageConfig(detectedLanguage).name;
  return {
    parsed: null,
    syntaxError: {
      line: result.syntaxError.line ?? 1,
      message: result.syntaxError.message || `${languageName} syntax looks incomplete.`,
    },
  };
}

export function parsePrint(input) {
  return analyzeSubmission(input).parsed?.output ?? null;
}
