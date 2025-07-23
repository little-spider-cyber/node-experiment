import { spawn } from "child_process";

const process1 = spawn("bun", ["run", "process1.ts"]);
const process2 = spawn("bun", ["run", "process2.ts"]);

if (process1.stdout && process2.stdin) {
  process1.stdout.pipe(process2.stdin);
}

process2.stdout?.on("data", (data) => {
  console.log(`Output from process 2: ${data}`);
});

process1.stderr?.on("data", (data) => {
  console.error(`Error from process 1: ${data}`);
});

process2.stderr?.on("data", (data) => {
  console.error(`Error from process 2: ${data}`);
});

process1.on("close", (code) => {
  console.log(`Process 1 exited with code ${code}`);
});

process2.on("close", (code) => {
  console.log(`Process 2 exited with code ${code}`);
});
