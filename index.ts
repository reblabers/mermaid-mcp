import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { join } from "path";
import { promises as fs } from "fs";
import { run } from "@mermaid-js/mermaid-cli";
import os from "os";

const server = new McpServer({
  name: "mermaid",
  version: "1.0.1"
});

async function render(
  inputPath: string,
  outputPath: `${string}.md` | `${string}.markdown` | `${string}.svg` | `${string}.png` | `${string}.pdf`,
  outputFormat?: "svg" | "png" | "pdf",
) {
  // 標準出力と標準エラー出力を一時的に保存
  const originalStdout = process.stdout.write;
  const originalStderr = process.stderr.write;

  try {
    // 出力を無効化
    process.stdout.write = (() => true) as any;
    process.stderr.write = (() => true) as any;

    // Mermaid CLIを使用して図を生成
    await run(inputPath, outputPath, {
      puppeteerConfig: {
        args: ['--no-sandbox'],
        headless: "new",
      } as any,
      outputFormat: outputFormat,
      quiet: true,
    });
  } finally {
    // 標準出力と標準エラー出力を元に戻す
    process.stdout.write = originalStdout;
    process.stderr.write = originalStderr;
  }
}

async function generateDiagram(
  diagram: string,
  format: "svg" | "png" | "pdf",
  isMarkdown: boolean,
  timestamp: number,
): Promise<Buffer<ArrayBufferLike>> {
  // 一時ファイルのパスを生成
  const inputPath = join(os.tmpdir(), `input-${timestamp}.mmd`);
  const outputPath = `${join(os.tmpdir(), `output-${timestamp}`)}.${format}` as const;

  // 入力ファイルに図の定義を書き込む
  let content = diagram;
  if (isMarkdown) {
    content = diagram.includes('```mermaid')
      ? diagram.split('```mermaid')[1].split('```')[0].trim()
      : diagram;
  }
  await fs.writeFile(inputPath, content, 'utf8');

  await render(inputPath, outputPath, format);

  // 生成されたファイルを読み込む
  const output = await fs.readFile(outputPath);

  // 一時ファイルを削除
  await Promise.all([
    fs.unlink(inputPath).catch(() => { }),
    fs.unlink(outputPath).catch(() => { })
  ]);

  return output;
}

// Add a Mermaid diagram generation tool
server.tool("render_mermaid",
  `\
Generate a Mermaid diagram from a diagram definition. \
The diagram definition can be in Mermaid format or Markdown format. \
If the diagram definition is in Markdown format, the diagram definition is extracted from the first \`\`\`mermaid\`\`\` block in the input.\
`.trim(),
  {
    diagram: z.string().describe("Diagram definition in Mermaid format"),
    format: z.enum(["svg", "png", "pdf"]).default("png").describe("Output format"),
    isMarkdown: z.boolean().default(false).describe("Whether the diagram definition is in Markdown format")
  },
  async ({ diagram, format, isMarkdown }) => {
    try {
      const timestamp = new Date().getTime();
      const output = await generateDiagram(diagram, format, isMarkdown, timestamp);

      if (format === 'png') {
        return {
          content: [{
            type: "image",
            mimeType: 'image/png',
            data: output.toString('base64'),
          }]
        };
      } else if (format === 'pdf') {
        return {
          content: [{
            type: "resource",
            resource: {
              uri: `${timestamp}.pdf`,
              mimeType: 'application/pdf',
              blob: output.toString('base64'),
            },
          }]
        };
      } else {
        return {
          content: [{
            type: "text",
            text: output.toString('utf8'),
          }]
        };
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '不明なエラー';
      throw new Error(`図の生成中にエラーが発生しました: ${errorMessage}`);
    }
  }
);

// dry-run tool
server.tool("dryrun_mermaid",
    `\
Validates a Mermaid diagram definition without generating a diagram. \
The diagram definition can be in Mermaid format or Markdown format. \
If the diagram definition is in Markdown format, the diagram definition is extracted from the first \`\`\`mermaid\`\`\` block in the input.\
`.trim(),
    {
        diagram: z.string().describe("Diagram definition in Mermaid format"),
        format: z.enum(["svg", "png", "pdf"]).default("svg").describe("Output format"),
        isMarkdown: z.boolean().default(false).describe("Whether the diagram definition is in Markdown format")
    },
    async ({ diagram, format, isMarkdown }) => {
        try {
            const timestamp = new Date().getTime();
            await generateDiagram(diagram, format, isMarkdown, timestamp);
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({status: "ok"}),
                }]
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Occurred an error';
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({status: "failed", message: errorMessage}),
                }]
            };
        }
    }
);

const transport = new StdioServerTransport();
await server.connect(transport);
