export type SseEvent = {
  event: string;
  data: string;
};

/**
 * Incremental SSE parser for fetch ReadableStream chunks.
 */
export class SseParser {
  private buffer = "";

  push(chunk: string): SseEvent[] {
    this.buffer += chunk;
    const events: SseEvent[] = [];

    while (true) {
      const boundary = this.buffer.indexOf("\n\n");
      if (boundary === -1) {
        break;
      }

      const rawEvent = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);

      const parsed = parseSseBlock(rawEvent);
      if (parsed) {
        events.push(parsed);
      }
    }

    return events;
  }

  flush(): SseEvent[] {
    if (!this.buffer.trim()) {
      this.buffer = "";
      return [];
    }

    const parsed = parseSseBlock(this.buffer);
    this.buffer = "";
    return parsed ? [parsed] : [];
  }
}

function parseSseBlock(raw: string): SseEvent | null {
  const lines = raw.split("\n");
  let event = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (!line || line.startsWith(":")) {
      continue;
    }

    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
      continue;
    }

    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  return {
    event,
    data: dataLines.join("\n"),
  };
}

export function encodeSse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
