export function restraintLog(message: string, maxLength: number = 100): void {
  if (message.length <= maxLength) {
    console.log(message);
  } else {
    const truncatedMessage = message.slice(0, maxLength);
    console.log(
      `${truncatedMessage}... (truncated to ${maxLength} characters)`
    );
  }
}
