/** Terminal prompts. Hidden input needs a TTY; without one the caller must pass the value through the environment. */
import { createInterface } from "node:readline";

export function promptHidden(question: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) return Promise.reject(new Error(`${question.trim()} needs an interactive terminal; set the value in the environment instead`));
  return new Promise((resolve, reject) => {
    process.stderr.write(question);
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const done = (err?: Error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      process.stderr.write("\n");
      if (err) reject(err); else resolve(value);
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") return done();
        if (ch === "\u0003") return done(new Error("cancelled"));
        if (ch === "\u007f" || ch === "\b") { value = value.slice(0, -1); continue; }
        if (ch >= " ") value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

export function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return Promise.resolve(false);
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => rl.question(`${question} [y/N] `, (a) => { rl.close(); resolve(/^y(es)?$/i.test(a.trim())); }));
}
