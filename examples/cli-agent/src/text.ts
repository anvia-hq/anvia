export function wrapText(text: string, width: number) {
  const lines: string[] = [];

  for (const rawLine of text.split("\n")) {
    let line = rawLine;
    while (line.length > width) {
      lines.push(line.slice(0, width));
      line = line.slice(width);
    }
    lines.push(line);
  }

  return lines;
}
