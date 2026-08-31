export class IncrementalJsonObjectParser {
  private buffer = "";
  private cursor = 0;
  private objectStarts: number[] = [];
  private inString = false;
  private escaping = false;

  push(chunk: string): unknown[] {
    this.buffer += chunk;
    const parsed: unknown[] = [];

    for (; this.cursor < this.buffer.length; this.cursor += 1) {
      const character = this.buffer[this.cursor];
      if (this.inString) {
        if (this.escaping) {
          this.escaping = false;
        } else if (character === "\\") {
          this.escaping = true;
        } else if (character === '"') {
          this.inString = false;
        }
        continue;
      }

      if (character === '"') {
        this.inString = true;
        continue;
      }
      if (character === "{") {
        this.objectStarts.push(this.cursor);
        continue;
      }
      if (character !== "}" || this.objectStarts.length === 0) continue;

      const start = this.objectStarts.pop()!;
      try {
        parsed.push(JSON.parse(this.buffer.slice(start, this.cursor + 1)) as unknown);
      } catch {
        // A containing object can still be valid even if a nested candidate was not.
      }
    }

    return parsed;
  }
}
