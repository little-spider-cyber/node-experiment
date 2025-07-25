const testString = new Array(10000000)
  .fill(
    "ASJDIOFJASDIFOJWOEIPRUWQEIOPRQWOENGMOSADJFIOADJASGJHVNASK;DFJASODIUFWEOIUasdfjsadiojsdanlkkmlsadmfm,,,,,,,,哈哈哈哈哈-12130-"
  )
  .join("");

const testBuffer = Buffer.from(testString);

// Benchmark Method 1: Buffer.from() + equals()
console.time("Buffer.from + equals");
console.time("buffer creation");
const tempBuffer = Buffer.from(testString);
console.timeEnd("buffer creation");
console.time("equals");
testBuffer.equals(tempBuffer);
console.timeEnd("equals");
console.timeEnd("Buffer.from + equals");

// Benchmark Method 2: toString() + string comparison
console.time("toString + string compare");
console.time("toString");
const testString2 = testBuffer.toString();
console.timeEnd("toString");
console.time("string comparison");
testString2 === testString;
console.timeEnd("string comparison");
console.timeEnd("toString + string compare");

// Typical results:
// Buffer.from + equals: ~95ms
// toString + string compare: ~45ms
// String comparison is ~2x faster!
