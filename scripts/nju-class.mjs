#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const IMPORT_FIELDS = new Set(["course", "teacher", "review"]);
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_STORE_PATH = resolve(SCRIPT_DIR, "../src/data/imported.json");

function fail(message) {
  throw new Error(message);
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseImportEntries(value) {
  if (!Array.isArray(value)) fail("Import file must contain a JSON array");

  return value.map((raw, index) => {
    if (!isObject(raw)) fail(`Entry ${index + 1} must be an object`);

    const keys = Object.keys(raw);
    if (
      keys.length !== IMPORT_FIELDS.size ||
      keys.some((key) => !IMPORT_FIELDS.has(key)) ||
      [...IMPORT_FIELDS].some((key) => !(key in raw))
    ) {
      fail(`Entry ${index + 1} may contain only course, teacher, and review`);
    }

    const { course, teacher, review } = raw;
    if (course !== null && typeof course !== "string") {
      fail(`Entry ${index + 1} course must be a string or null`);
    }
    if (teacher !== null && typeof teacher !== "string") {
      fail(`Entry ${index + 1} teacher must be a string or null`);
    }
    if (!course?.trim() && !teacher?.trim()) {
      fail(`Entry ${index + 1} must have a course or teacher`);
    }
    if (typeof review !== "string" || !review.trim()) {
      fail(`Entry ${index + 1} review must be a non-empty string`);
    }

    return { course, teacher, review };
  });
}

function parseStoredEntries(value) {
  if (!Array.isArray(value)) fail("Stored imported data must be a JSON array");

  return value.map((raw, index) => {
    if (!isObject(raw)) fail(`Stored entry ${index + 1} must be an object`);
    const { course, teacher, review, sources } = raw;
    if (course !== null && typeof course !== "string") {
      fail(`Stored entry ${index + 1} course must be a string or null`);
    }
    if (teacher !== null && typeof teacher !== "string") {
      fail(`Stored entry ${index + 1} teacher must be a string or null`);
    }
    if (typeof review !== "string" || !review.trim()) {
      fail(`Stored entry ${index + 1} review must be a non-empty string`);
    }
    if (
      !Array.isArray(sources) ||
      sources.length === 0 ||
      sources.some((source) => typeof source !== "string" || !source.trim())
    ) {
      fail(`Stored entry ${index + 1} sources must be a non-empty string array`);
    }
    return { course, teacher, review, sources: [...sources] };
  });
}

export function mergeSourceSnapshot(existing, incoming, source) {
  const normalizedSource = source.trim();
  if (!normalizedSource) fail("--source must be non-empty");

  const retained = existing.filter(
    (entry) => !entry.sources.includes(normalizedSource),
  );
  const replacement = incoming.map((entry) => ({
    ...entry,
    sources: [normalizedSource],
  }));
  return [...retained, ...replacement];
}

async function readJson(path, { missing = undefined } = {}) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT" && missing !== undefined) return missing;
    if (error instanceof SyntaxError) fail(`Invalid JSON in ${path}: ${error.message}`);
    throw error;
  }
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

function usage() {
  return [
    "Usage:",
    "  npm run cli -- import <file> --source <name> [--apply]",
    "",
    "Without --apply, the command validates and previews only.",
  ].join("\n");
}

function parseArgs(argv) {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    return { help: true };
  }
  if (argv[0] !== "import") fail(`Unknown command: ${argv[0]}\n\n${usage()}`);

  let file;
  let source;
  let apply = false;
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      apply = true;
    } else if (arg === "--source") {
      source = argv[index + 1];
      index += 1;
    } else if (arg.startsWith("--source=")) {
      source = arg.slice("--source=".length);
    } else if (arg.startsWith("-")) {
      fail(`Unknown option: ${arg}`);
    } else if (!file) {
      file = arg;
    } else {
      fail(`Unexpected argument: ${arg}`);
    }
  }

  if (!file) fail(`Import file is required\n\n${usage()}`);
  if (!source?.trim()) fail(`--source is required\n\n${usage()}`);
  return { help: false, file: resolve(file), source: source.trim(), apply };
}

export async function runImport({ file, source, apply, storePath = DEFAULT_STORE_PATH }) {
  const incoming = parseImportEntries(await readJson(file));
  const existing = parseStoredEntries(await readJson(storePath, { missing: [] }));
  const currentSourceCount = existing.filter((entry) =>
    entry.sources.includes(source),
  ).length;
  const merged = mergeSourceSnapshot(existing, incoming, source);

  console.log(`Source: ${source}`);
  console.log(`Current source records: ${currentSourceCount}`);
  console.log(`Incoming records: ${incoming.length}`);
  console.log(`Other imported records retained: ${existing.length - currentSourceCount}`);
  console.log(`Stored records after import: ${merged.length}`);

  if (!apply) {
    console.log("Preview only; rerun with --apply to write the snapshot.");
    return { applied: false, merged };
  }

  await writeJsonAtomic(storePath, merged);
  console.log(`Updated ${storePath}`);
  return { applied: true, merged };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return 0;
  }
  await runImport(args);
  return 0;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Import failed: ${error.message}`);
    process.exitCode = 1;
  });
}
