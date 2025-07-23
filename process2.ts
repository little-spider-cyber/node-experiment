process.stdin.on("data", (data) => {
  process.stdout.write(`Process 2 received: ${data.toString()}`);
}); 