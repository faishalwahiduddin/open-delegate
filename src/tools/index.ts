import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DelegateContext } from "../context.js";
import { registerOdeAwait } from "./await.js";
import { registerOdeCancel } from "./cancel.js";
import { registerOdeDelegate } from "./delegate.js";
import { registerOdeDiagnostics } from "./diagnostics.js";
import { registerOdeResume } from "./resume.js";
import { registerOdeStatus } from "./status.js";
import { registerOdeTranscript } from "./transcript.js";

export function registerAllTools(server: McpServer, ctx: DelegateContext): void {
	registerOdeDelegate(server, ctx);
	registerOdeAwait(server, ctx);
	registerOdeStatus(server, ctx);
	registerOdeTranscript(server, ctx);
	registerOdeCancel(server, ctx);
	registerOdeResume(server, ctx);
	registerOdeDiagnostics(server, ctx);
}
