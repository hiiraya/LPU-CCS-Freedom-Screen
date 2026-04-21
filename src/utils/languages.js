import pythonIcon from "../images/languages/python-svgrepo-com.svg";
import cppIcon from "../images/languages/cpp-svgrepo-com.svg";
import csharpIcon from "../images/languages/csharp-svgrepo-com.svg";
import javaIcon from "../images/languages/java-svgrepo-com.svg";
import javascriptIcon from "../images/languages/js-svgrepo-com.svg";

const LANGUAGE_DEFINITIONS = [
  {
    key: "python",
    name: "Python",
    aliases: ["python", "py"],
    fileName: "entry.py",
    extension: "py",
    signature: ">>>",
    accent: "#3776AB",
    icon: pythonIcon,
    sample: 'print("hello wall")',
  },
  {
    key: "javascript",
    name: "JavaScript",
    aliases: ["javascript", "js", "node", "nodejs"],
    fileName: "entry.js",
    extension: "js",
    signature: "js>",
    accent: "#F7DF1E",
    icon: javascriptIcon,
    sample: 'console.log("hello wall")',
  },
  {
    key: "java",
    name: "Java",
    aliases: ["java"],
    fileName: "Main.java",
    extension: "java",
    signature: "java>",
    accent: "#E76F00",
    icon: javaIcon,
    sample: 'System.out.println("hello wall");',
  },
  {
    key: "cpp",
    name: "C++",
    aliases: ["cpp", "c++", "cplusplus", "cc"],
    fileName: "main.cpp",
    extension: "cpp",
    signature: "c++>",
    accent: "#659AD2",
    icon: cppIcon,
    sample: 'cout << "hello wall";',
  },
  {
    key: "csharp",
    name: "C#",
    aliases: ["csharp", "c#", "cs", "c-sharp"],
    fileName: "Program.cs",
    extension: "cs",
    signature: "c#>",
    accent: "#9B4F96",
    icon: csharpIcon,
    sample: 'Console.WriteLine("hello wall");',
  },
];

const LANGUAGE_INDEX = new Map();

for (const language of LANGUAGE_DEFINITIONS) {
  LANGUAGE_INDEX.set(language.key, language);
  for (const alias of language.aliases) {
    LANGUAGE_INDEX.set(alias, language);
  }
  LANGUAGE_INDEX.set(language.name.toLowerCase(), language);
}

const FALLBACK_LANGUAGE = {
  key: "text",
  name: "Plain Text",
  fileName: "entry.txt",
  extension: "txt",
  signature: "txt>",
  accent: "#7A7A7A",
  icon: null,
  sample: "",
};

export const SUPPORTED_LANGUAGES = LANGUAGE_DEFINITIONS;

export function normalizeLanguage(language) {
  if (!language) return null;
  const normalized = String(language).trim().toLowerCase();
  return LANGUAGE_INDEX.get(normalized)?.key ?? null;
}

export function getLanguageConfig(language) {
  const normalized = normalizeLanguage(language);
  return LANGUAGE_INDEX.get(normalized) ?? FALLBACK_LANGUAGE;
}
