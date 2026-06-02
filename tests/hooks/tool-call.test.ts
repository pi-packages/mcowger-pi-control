import { describe, expect, it, beforeAll, mock } from "bun:test"; // mock kept for ctx stubs
import { initBashParser } from "../../src/utils/bash-ast.js";
import { handleToolCall, pendingNudges } from "../../src/hooks/tool-call.js";
import type { ControlsResolvedConfig } from "../../src/config.js";
import type {
	BashToolCallEvent,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

beforeAll(async () => {
	await initBashParser((msg) => console.warn(msg));
});

// Minimal ExtensionContext stub.
function makeCtx(cwd: string): ExtensionContext {
	return {
		cwd,
		ui: {
			notify: mock(() => {}),
			confirm: mock(async () => true),
			setStatus: mock(() => {}),
			theme: {
				fg: (_color: string, text: string) => text,
				bold: (text: string) => text,
			},
		},
	} as any;
}

function bashEvent(command: string, id = "test-id"): BashToolCallEvent {
	return {
		type: "tool_call",
		toolCallId: id,
		toolName: "bash",
		input: { command },
	};
}

function toolEvent(
	toolName: string,
	id = "test-id",
	extraInput: Record<string, unknown> = {},
): any {
	return {
		type: "tool_call",
		toolCallId: id,
		toolName,
		input: { ...extraInput },
	};
}

// Config where:
//   /tmp  → open  (allow everything)
//   everything else → locked (deny everything)
const config: ControlsResolvedConfig = {
	policies: {
		open: { defaultAction: "allow", rules: [] },
		locked: { defaultAction: "deny", rules: [] },
	},
	locations: {
		"/tmp": "open",
	},
	defaultPolicy: "locked",
};

describe("tool-call handler — path arg location resolution", () => {
	// Bug regression: before the fix, `ls -la ~` used CWD for location resolution.
	// If CWD was under an allowed location, commands targeting restricted paths
	// were incorrectly allowed.
	it("denies ls -la ~ when home dir is not in any location (falls to locked defaultPolicy)", async () => {
		// CWD is /tmp (open), but ~ is the home dir which matches no location → locked.
		const result = await handleToolCall(
			bashEvent("ls -la ~"),
			makeCtx("/tmp"),
			config,
		);
		expect(result).toEqual({
			block: true,
			reason: expect.stringContaining("Access denied"),
		});
	});

	it("allows ls /tmp/foo when /tmp is open, even from a locked CWD", async () => {
		// CWD is /home/user (no location → locked), but the path arg is under /tmp (open).
		const result = await handleToolCall(
			bashEvent("ls /tmp/foo"),
			makeCtx("/home/user"),
			config,
		);
		expect(result).toBeUndefined();
	});

	it("denies when one path arg is locked even if another is open", async () => {
		// cp from /tmp (open) to ~ (locked) — most restrictive wins.
		const result = await handleToolCall(
			bashEvent("cp /tmp/foo ~"),
			makeCtx("/tmp"),
			config,
		);
		expect(result).toEqual({
			block: true,
			reason: expect.stringContaining("Access denied"),
		});
	});

	it("uses CWD when command has no path args or redirects", async () => {
		// No path args — CWD /tmp is open.
		const result = await handleToolCall(
			bashEvent("git status"),
			makeCtx("/tmp"),
			config,
		);
		expect(result).toBeUndefined();
	});

	it("uses CWD when command has no path args or redirects and CWD is locked", async () => {
		// No path args — CWD /home/user has no location → locked.
		const result = await handleToolCall(
			bashEvent("git status"),
			makeCtx("/home/user"),
			config,
		);
		expect(result).toEqual({
			block: true,
			reason: expect.stringContaining("Access denied"),
		});
	});
});

describe("nudge action", () => {
	const nudgeConfig: ControlsResolvedConfig = {
		policies: {
			nudged: {
				defaultAction: "allow",
				rules: [
					{
						action: "nudge",
						tool: "read",
						message: "use pluck_read instead",
					},
				],
			},
		},
		locations: { "/tmp": "nudged" },
		defaultPolicy: null,
	};

	it("allows the tool call (returns undefined) when action is nudge", async () => {
		const event = toolEvent("read", "nudge-call-1", {
			file_path: "/tmp/foo.ts",
		});
		const result = await handleToolCall(event, makeCtx("/tmp"), nudgeConfig);
		expect(result).toBeUndefined();
	});

	it("registers a pending nudge keyed by toolCallId", async () => {
		pendingNudges.clear();
		const event = toolEvent("read", "nudge-call-2", {
			file_path: "/tmp/bar.ts",
		});
		await handleToolCall(event, makeCtx("/tmp"), nudgeConfig);
		expect(pendingNudges.get("nudge-call-2")).toBe("use pluck_read instead");
	});

	it("does not register a pending nudge for allowed (non-nudge) tools", async () => {
		pendingNudges.clear();
		const event = toolEvent("grep", "nudge-call-3");
		await handleToolCall(event, makeCtx("/tmp"), nudgeConfig);
		expect(pendingNudges.has("nudge-call-3")).toBe(false);
	});
});
