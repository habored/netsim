import fs from "fs";
import path from "path";

// Ce script doit être lancé depuis la racine du projet : node src/js/tests/test-runner.js
const testsDir = "./src/js/tests";
const tests = fs
    .readdirSync(testsDir)
    .filter(f => f.endsWith(".test.js") && f !== "test-runner.js")
    .map(f => `./${f}`);

for (const file of tests) {
    console.log("\x1b[36m%s\x1b[0m", `\nRunning: ${file}`);
    await import(file);
}