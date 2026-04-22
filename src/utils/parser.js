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

const MAX_INTERPRETED_LOOP_ITERATIONS = 240;

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
  let roundDepth = 0;
  let squareDepth = 0;
  let curlyDepth = 0;

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

    if (char === "(") {
      roundDepth += 1;
      current += char;
      continue;
    }

    if (char === ")") {
      roundDepth = Math.max(0, roundDepth - 1);
      current += char;
      continue;
    }

    if (char === "[") {
      squareDepth += 1;
      current += char;
      continue;
    }

    if (char === "]") {
      squareDepth = Math.max(0, squareDepth - 1);
      current += char;
      continue;
    }

    if (char === "{") {
      curlyDepth += 1;
      current += char;
      continue;
    }

    if (char === "}") {
      curlyDepth = Math.max(0, curlyDepth - 1);
      current += char;
      continue;
    }

    const isTopLevel = roundDepth === 0 && squareDepth === 0 && curlyDepth === 0;

    if (separatorKind === "plus" && isTopLevel && char === "+") {
      parts.push(current.trim());
      current = "";
      continue;
    }

    if (separatorKind === "shift" && isTopLevel && char === "<" && next === "<") {
      parts.push(current.trim());
      current = "";
      index += 1;
      continue;
    }

    if (separatorKind === "comma" && isTopLevel && char === ",") {
      parts.push(current.trim());
      current = "";
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

    if (/^[+-]?\d+(\.\d+)?$/.test(token)) {
      resolved.push(token);
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

function unwrapParentheses(expression) {
  let current = expression.trim();

  while (
    current.startsWith("(") &&
    current.endsWith(")") &&
    splitExpression(current.slice(1, -1), "comma").length <= 1
  ) {
    current = current.slice(1, -1).trim();
  }

  return current;
}

function countIndent(rawLine) {
  let size = 0;

  for (const char of rawLine) {
    if (char === " ") {
      size += 1;
      continue;
    }

    if (char === "\t") {
      size += 4;
      continue;
    }

    break;
  }

  return size;
}

function stripPythonInlineComment(line) {
  let state = null;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    const nextThree = line.slice(index, index + 3);

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

    if (char === '"' || char === "'") {
      state = char;
      continue;
    }

    if (char === "#") {
      return line.slice(0, index);
    }
  }

  return line;
}

function formatPythonValue(value) {
  if (value === null || value === undefined) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (Array.isArray(value)) return value.map((item) => formatPythonValue(item)).join(", ");
  return String(value);
}

function interpolatePythonString(content, variables, line) {
  const source = decodeEscapes(content);
  let output = "";

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (char === "{" && next === "{") {
      output += "{";
      index += 1;
      continue;
    }

    if (char === "}" && next === "}") {
      output += "}";
      index += 1;
      continue;
    }

    if (char === "{") {
      let depth = 1;
      let endIndex = index + 1;

      while (endIndex < source.length && depth > 0) {
        if (source[endIndex] === "{") depth += 1;
        if (source[endIndex] === "}") depth -= 1;
        endIndex += 1;
      }

      if (depth !== 0) {
        return {
          error: {
            line,
            message: "One of the Python formatted placeholders is not closed.",
          },
          value: null,
        };
      }

      const placeholder = source.slice(index + 1, endIndex - 1).trim();
      const resolved = resolvePythonValue(placeholder, variables, line);
      if (resolved.error) return resolved;

      output += formatPythonValue(resolved.value);
      index = endIndex - 1;
      continue;
    }

    output += char;
  }

  return { error: null, value: output };
}

function resolvePythonString(token, variables, line) {
  const trimmed = token.trim();
  const tripleMatch = trimmed.match(/^([A-Za-z]{0,2})("""|''')([\s\S]*?)\2$/);

  if (tripleMatch) {
    if (tripleMatch[1].toLowerCase().includes("f")) {
      return interpolatePythonString(tripleMatch[3], variables, line);
    }

    return {
      error: null,
      value: decodeEscapes(tripleMatch[3]),
    };
  }

  const singleMatch = trimmed.match(/^([A-Za-z]{0,2})(["'])([\s\S]*?)\2$/);
  if (singleMatch) {
    if (singleMatch[1].toLowerCase().includes("f")) {
      return interpolatePythonString(singleMatch[3], variables, line);
    }

    return {
      error: null,
      value: decodeEscapes(singleMatch[3]),
    };
  }

  return {
    error: null,
    value: null,
  };
}

function resolvePythonValue(expression, variables, line) {
  const trimmed = unwrapParentheses(expression);

  if (!trimmed) {
    return {
      error: {
        line,
        message: "This Python expression is empty.",
      },
      value: null,
    };
  }

  const stringResult = resolvePythonString(trimmed, variables, line);
  if (stringResult.error || stringResult.value !== null) {
    return stringResult;
  }

  if (/^[+-]?\d+(\.\d+)?$/.test(trimmed)) {
    return {
      error: null,
      value: Number(trimmed),
    };
  }

  if (trimmed === "True") return { error: null, value: true };
  if (trimmed === "False") return { error: null, value: false };
  if (trimmed === "None") return { error: null, value: null };

  if (variables.has(trimmed)) {
    return {
      error: null,
      value: variables.get(trimmed),
    };
  }

  const castMatch = trimmed.match(/^(str|int|float)\(([\s\S]*)\)$/);
  if (castMatch) {
    const resolved = resolvePythonValue(castMatch[2], variables, line);
    if (resolved.error) return resolved;

    if (castMatch[1] === "str") {
      return {
        error: null,
        value: formatPythonValue(resolved.value),
      };
    }

    const nextNumber = Number(resolved.value);
    if (!Number.isFinite(nextNumber)) {
      return {
        error: {
          line,
          message: `Python ${castMatch[1]}(...) needs a numeric value here.`,
        },
        value: null,
      };
    }

    return {
      error: null,
      value: castMatch[1] === "int" ? Math.trunc(nextNumber) : nextNumber,
    };
  }

  if (
    (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
    (trimmed.startsWith("(") && trimmed.endsWith(")") && splitExpression(trimmed.slice(1, -1), "comma").length > 1)
  ) {
    const inner = trimmed.slice(1, -1);
    const members = inner.trim() ? splitExpression(inner, "comma") : [];
    const resolvedMembers = [];

    for (const member of members) {
      const resolved = resolvePythonValue(member, variables, line);
      if (resolved.error) return resolved;
      resolvedMembers.push(resolved.value);
    }

    return {
      error: null,
      value: resolvedMembers,
    };
  }

  const plusTokens = splitExpression(trimmed, "plus");
  if (plusTokens.length > 1) {
    const values = [];

    for (const token of plusTokens) {
      const resolved = resolvePythonValue(token, variables, line);
      if (resolved.error) return resolved;
      values.push(resolved.value);
    }

    if (values.every((value) => typeof value === "number")) {
      return {
        error: null,
        value: values.reduce((total, value) => total + value, 0),
      };
    }

    return {
      error: null,
      value: values.map((value) => formatPythonValue(value)).join(""),
    };
  }

  return {
    error: {
      line,
      message: "Python output must use strings, simple values, variables, f-strings, or supported loops.",
    },
    value: null,
  };
}

function resolvePythonPrintArguments(argsText, variables, line) {
  const tokens = argsText.trim() ? splitExpression(argsText, "comma") : [];

  if (tokens.length === 0) {
    return {
      error: {
        line,
        message: "This print statement is empty. Add text or a value inside `print(...)` first.",
      },
      value: null,
    };
  }

  const parts = [];

  for (const token of tokens) {
    const resolved = resolvePythonValue(token, variables, line);
    if (resolved.error) return resolved;
    parts.push(formatPythonValue(resolved.value));
  }

  return {
    error: null,
    value: parts.join(" "),
  };
}

function resolvePythonRange(argsText, variables, line) {
  const tokens = argsText.trim() ? splitExpression(argsText, "comma") : [];

  if (tokens.length === 0 || tokens.length > 3) {
    return {
      error: {
        line,
        message: "Python range(...) supports 1 to 3 numeric arguments here.",
      },
      value: null,
    };
  }

  const numbers = [];

  for (const token of tokens) {
    const resolved = resolvePythonValue(token, variables, line);
    if (resolved.error) return resolved;

    if (typeof resolved.value !== "number" || Number.isNaN(resolved.value)) {
      return {
        error: {
          line,
          message: "Python range(...) needs numeric values.",
        },
        value: null,
      };
    }

    numbers.push(resolved.value);
  }

  const start = numbers.length === 1 ? 0 : numbers[0];
  const stop = numbers.length === 1 ? numbers[0] : numbers[1];
  const step = numbers.length === 3 ? numbers[2] : 1;

  if (step === 0) {
    return {
      error: {
        line,
        message: "Python range(...) cannot use a step of 0.",
      },
      value: null,
    };
  }

  const items = [];
  let current = start;

  while ((step > 0 && current < stop) || (step < 0 && current > stop)) {
    items.push(current);
    if (items.length > MAX_INTERPRETED_LOOP_ITERATIONS) {
      return {
        error: {
          line,
          message: `Loops are limited to ${MAX_INTERPRETED_LOOP_ITERATIONS} iterations in the wall preview.`,
        },
        value: null,
      };
    }
    current += step;
  }

  return {
    error: null,
    value: items,
  };
}

function findNextPythonBlock(lines, startIndex) {
  for (let index = startIndex; index < lines.length; index += 1) {
    const content = stripPythonInlineComment(lines[index]).trim();
    if (!content) continue;

    return {
      indent: countIndent(lines[index]),
      index,
    };
  }

  return null;
}

function findPythonBlockEnd(lines, startIndex, indentLevel) {
  let index = startIndex;

  while (index < lines.length) {
    const content = stripPythonInlineComment(lines[index]).trim();
    if (!content) {
      index += 1;
      continue;
    }

    if (countIndent(lines[index]) < indentLevel) {
      break;
    }

    index += 1;
  }

  return index;
}

function executePythonBlock(lines, startIndex, indentLevel, variables) {
  const output = [];
  let index = startIndex;

  while (index < lines.length) {
    const rawLine = lines[index];
    const content = stripPythonInlineComment(rawLine).trim();

    if (!content) {
      index += 1;
      continue;
    }

    const currentIndent = countIndent(rawLine);

    if (currentIndent < indentLevel) break;

    if (currentIndent > indentLevel) {
      return {
        error: {
          line: index + 1,
          message: "This Python block is indented more than expected.",
        },
        nextIndex: index,
        output,
      };
    }

    const loopMatch = content.match(/^for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+range\(([\s\S]*)\)\s*:\s*$/);
    const sequenceLoopMatch = content.match(/^for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([\s\S]+)\s*:\s*$/);
    const printMatch = content.match(/^print\s*\(([\s\S]*)\)\s*$/);
    const assignMatch = content.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]+)$/);

    if (loopMatch || sequenceLoopMatch) {
      const variableName = loopMatch?.[1] ?? sequenceLoopMatch[1];
      const iterableResult = loopMatch
        ? resolvePythonRange(loopMatch[2], variables, index + 1)
        : resolvePythonValue(sequenceLoopMatch[2], variables, index + 1);

      if (iterableResult.error) {
        return {
          error: iterableResult.error,
          nextIndex: index,
          output,
        };
      }

      if (!Array.isArray(iterableResult.value)) {
        return {
          error: {
            line: index + 1,
            message: "Python `for ... in ...` needs a `range(...)`, list, or tuple here.",
          },
          nextIndex: index,
          output,
        };
      }

      const nextBlock = findNextPythonBlock(lines, index + 1);
      if (!nextBlock || nextBlock.indent <= indentLevel) {
        return {
          error: {
            line: index + 1,
            message: "Python loops need an indented block underneath them.",
          },
          nextIndex: index,
          output,
        };
      }

      const blockEnd = findPythonBlockEnd(lines, nextBlock.index, nextBlock.indent);

      for (const item of iterableResult.value) {
        variables.set(variableName, item);
        const result = executePythonBlock(lines, nextBlock.index, nextBlock.indent, variables);

        if (result.error) {
          return {
            error: result.error,
            nextIndex: result.nextIndex,
            output,
          };
        }

        output.push(...result.output);
      }

      index = blockEnd;
      continue;
    }

    if (printMatch) {
      const printResult = resolvePythonPrintArguments(printMatch[1], variables, index + 1);

      if (printResult.error) {
        return {
          error: printResult.error,
          nextIndex: index,
          output,
        };
      }

      output.push(printResult.value);
      index += 1;
      continue;
    }

    if (assignMatch) {
      const assignmentResult = resolvePythonValue(assignMatch[2], variables, index + 1);

      if (assignmentResult.error) {
        return {
          error: assignmentResult.error,
          nextIndex: index,
          output,
        };
      }

      variables.set(assignMatch[1], assignmentResult.value);
      index += 1;
      continue;
    }

    if (content === "pass") {
      index += 1;
      continue;
    }

    return {
      error: {
        line: index + 1,
        message: "This Python statement is not supported in the wall preview yet.",
      },
      nextIndex: index,
      output,
    };
  }

  return {
    error: null,
    nextIndex: index,
    output,
  };
}

function executeStaticPythonProgram(code) {
  const structuralError = checkBalancedStructure(code);
  if (structuralError) {
    return {
      output: null,
      syntaxError: structuralError,
    };
  }

  const variables = collectVariables(
    code,
    /(?:^|\n)\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'))/g
  );

  const { sites, errorLine } = findCallSites(code, /print\s*\(/g);
  if (errorLine) {
    return {
      output: null,
      syntaxError: {
        line: errorLine,
        message: "The Python print call is not closed properly.",
      },
    };
  }

  if (sites.length === 0) {
    return {
      output: null,
      syntaxError: {
        line: 1,
        message: 'Add a `print(...)` call. Python supports strings, f-strings, and simple `for ... in range(...)` loops here.',
      },
    };
  }

  const outputs = [];

  for (const site of sites) {
    const resolved = resolveExpression(site.args, "plus", variables);
    if (resolved === null) {
      return {
        output: null,
        syntaxError: {
          line: site.line,
          message: "Python print output must be a quoted string, a string variable, or string concatenation.",
        },
      };
    }

    outputs.push(resolved);
  }

  const output = outputs.join("\n");
  if (!output.trim()) {
    return {
      output: null,
      syntaxError: {
        line: sites[0]?.line ?? 1,
        message: "The program ran, but it did not print any visible text to send.",
      },
    };
  }

  return {
    output,
    syntaxError: null,
  };
}

function executePythonProgram(code) {
  const structuralError = checkBalancedStructure(code);
  if (structuralError) {
    return {
      output: null,
      syntaxError: structuralError,
    };
  }

  if (!/\bprint\s*\(/.test(code)) {
    return {
      output: null,
      syntaxError: {
        line: 1,
        message: 'Add a `print(...)` call. Python supports strings, f-strings, and simple `for ... in range(...)` loops here.',
      },
    };
  }

  const lines = code.split("\n");
  const result = executePythonBlock(lines, 0, 0, new Map());

  if (result.error) {
    if (code.includes('"""') || code.includes("'''")) {
      return executeStaticPythonProgram(code);
    }

    return {
      output: null,
      syntaxError: result.error,
    };
  }

  const output = result.output.join("\n");
  if (!output.trim()) {
    return {
      output: null,
      syntaxError: {
        line: 1,
        message: "The program ran, but it did not print any visible text to send.",
      },
    };
  }

  return {
    output,
    syntaxError: null,
  };
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
  const executed = executePythonProgram(code);
  if (executed.syntaxError) {
    return {
      parsed: null,
      syntaxError: executed.syntaxError,
    };
  }

  return {
    parsed: {
      language: "python",
      output: executed.output,
    },
    syntaxError: null,
  };
}

function previewPython(code) {
  return executePythonProgram(code).output;
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

  if (!logs.join("\n").trim()) {
    return {
      parsed: null,
      syntaxError: {
        line: 1,
        message: "The program ran, but it did not print any visible text to send.",
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

function previewJavaScript(code) {
  const variables = collectVariables(
    code,
    /(?:^|\n)\s*(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)\s*;?/g
  );
  const { sites } = findCallSites(code, /console\.log\s*\(/g);
  if (sites.length === 0) return null;
  const outputs = [];
  for (const site of sites) {
    const resolved = resolveExpression(site.args, "plus", variables);
    if (resolved === null) return null;
    outputs.push(resolved);
  }
  return outputs.join("\n");
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

  if (!outputs.join("\n").trim()) {
    return {
      parsed: null,
      syntaxError: {
        line: sites[0]?.line ?? 1,
        message: "The program ran, but it did not print any visible text to send.",
      },
    };
  }

  return {
    parsed: {
      language: "java",
      output: outputs.join("\n"),
    },
    syntaxError: null,
  };
}

function previewJava(code) {
  const variables = collectVariables(
    code,
    /(?:^|\n)\s*String\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*("(?:[^"\\]|\\.)*")\s*;?/g
  );
  const { sites } = findCallSites(code, /System\.out\.println\s*\(/g);
  if (sites.length === 0) return null;
  const outputs = [];
  for (const site of sites) {
    const resolved = resolveExpression(site.args, "plus", variables);
    if (resolved === null) return null;
    outputs.push(resolved);
  }
  return outputs.join("\n");
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

  if (!outputs.join("\n").trim()) {
    return {
      parsed: null,
      syntaxError: {
        line: sites[0]?.line ?? 1,
        message: "The program ran, but it did not print any visible text to send.",
      },
    };
  }

  return {
    parsed: {
      language: "csharp",
      output: outputs.join("\n"),
    },
    syntaxError: null,
  };
}

function previewCSharp(code) {
  const variables = collectVariables(
    code,
    /(?:^|\n)\s*string\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*("(?:[^"\\]|\\.)*"|@"[\s\S]*?")\s*;?/gi
  );
  const { sites } = findCallSites(code, /Console\.WriteLine\s*\(/g);
  if (sites.length === 0) return null;
  const outputs = [];
  for (const site of sites) {
    const resolved = resolveExpression(site.args, "plus", variables);
    if (resolved === null) return null;
    outputs.push(resolved);
  }
  return outputs.join("\n");
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

  if (!outputs.join("").trim()) {
    return {
      parsed: null,
      syntaxError: {
        line: 1,
        message: "The program ran, but it did not print any visible text to send.",
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

function previewCpp(code) {
  const variables = collectVariables(
    code,
    /(?:^|\n)\s*(?:std::string|string|auto|const\s+char\s*\*)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*;?/g
  );
  const lines = code.split("\n");
  const outputs = [];

  for (const line of lines) {
    const trimmed = line.replace(/\/\/.*$/, "").trim();
    if (!/(?:std::)?cout\s*<</.test(trimmed)) continue;
    const match = trimmed.match(/(?:std::)?cout\s*(<<[\s\S]+?)\s*;?$/);
    if (!match) return null;
    const resolved = resolveExpression(match[1], "shift", variables);
    if (resolved === null) return null;
    outputs.push(resolved);
  }

  return outputs.length > 0 ? outputs.join("") : null;
}

const ANALYZERS = {
  python: parsePython,
  javascript: parseJavaScript,
  java: parseJava,
  cpp: parseCpp,
  csharp: parseCSharp,
};

const PREVIEWERS = {
  python: previewPython,
  javascript: previewJavaScript,
  java: previewJava,
  cpp: previewCpp,
  csharp: previewCSharp,
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

export function previewSubmissionOutput(input) {
  const code = input.replace(/\r\n/g, "\n");
  if (!code.trim()) return "";
  const previewer = PREVIEWERS[detectLanguage(code)];
  return previewer ? previewer(code) : null;
}
