const PRINT_PATTERNS = [
  {
    language: "Python",
    pattern: /print\s*\(\s*(["'])(.*?)\1\s*\)/,
    variablePattern: /print\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/,
  },
  {
    language: "JavaScript",
    pattern: /console\.log\s*\(\s*(["'])(.*?)\1\s*\)/,
    variablePattern: /console\.log\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/,
  },
  {
    language: "Java",
    pattern: /System\.out\.println\s*\(\s*(["'])(.*?)\1\s*\)/,
    variablePattern: /System\.out\.println\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/,
  },
  {
    language: "C++",
    pattern: /cout\s*<<\s*(["'])(.*?)\1/,
    variablePattern: /cout\s*<<\s*([A-Za-z_][A-Za-z0-9_]*)/,
  },
];

const VARIABLE_PATTERNS = [
  {
    language: "Python",
    pattern: /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(["'])(.*?)\2/,
  },
  {
    language: "JavaScript",
    pattern: /^\s*(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(["'])(.*?)\2/,
  },
  {
    language: "Java",
    pattern: /^\s*String\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(["'])(.*?)\2/,
  },
  {
    language: "C++",
    pattern: /^\s*(?:string|std::string|auto)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(["'])(.*?)\2/,
  },
];

const LANGUAGE_HINTS = [
  {
    language: "Java",
    matches: (code) => code.includes("System.out.println") || code.includes("public static void main"),
  },
  {
    language: "C++",
    matches: (code) => code.includes("#include <iostream>") || code.includes("cout <<"),
  },
  {
    language: "JavaScript",
    matches: (code) => code.includes("console.log") || code.includes("const "),
  },
  {
    language: "Python",
    matches: (code) => code.includes("print(") || code.includes("def "),
  },
];

function findLikelyErrorLine(lines) {
  const suspiciousTokens = ["print", "console.log", "System.out.println", "cout", "println"];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (suspiciousTokens.some((token) => line.includes(token))) {
      return index + 1;
    }
  }

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].trim()) {
      return index + 1;
    }
  }

  return 1;
}

export function detectLanguage(code) {
  for (const hint of LANGUAGE_HINTS) {
    if (hint.matches(code)) {
      return hint.language;
    }
  }

  return "Unknown";
}

export function analyzeSubmission(input) {
  const lines = input.split(/\r?\n/);
  const variableValues = new Map();

  for (const line of lines) {
    for (const candidate of VARIABLE_PATTERNS) {
      const match = line.match(candidate.pattern);

      if (match) {
        variableValues.set(match[1], match[3]);
      }
    }
  }

  for (const line of lines) {
    for (const candidate of PRINT_PATTERNS) {
      const match = line.match(candidate.pattern);

      if (match) {
        return {
          parsed: {
            language: candidate.language,
            output: match[2],
          },
          syntaxError: null,
        };
      }

      const variableMatch = line.match(candidate.variablePattern);

      if (variableMatch) {
        const resolvedValue = variableValues.get(variableMatch[1]);

        if (resolvedValue) {
          return {
            parsed: {
              language: candidate.language,
              output: resolvedValue,
            },
            syntaxError: null,
          };
        }
      }
    }
  }

  const detectedLanguage = detectLanguage(input);
  const likelyErrorLine = findLikelyErrorLine(lines);

  return {
    parsed: null,
    syntaxError: {
      line: likelyErrorLine,
      message:
        detectedLanguage === "Unknown"
          ? 'Use a supported print line such as `print("hello")`, `console.log("hello")`, `System.out.println("hello")`, or `cout << "hello";`.'
          : `The ${detectedLanguage} print line looks incomplete. Make sure the message is wrapped in quotes.`,
    },
  };
}

export function parsePrint(input) {
  return analyzeSubmission(input).parsed?.output ?? null;
}
