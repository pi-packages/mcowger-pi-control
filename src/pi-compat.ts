/**
 * Dual-compat layer: works with both oh-my-pi and upstream pi.
 *
 * oh-my-pi uses @oh-my-pi/* packages and getAgentDir() returns ~/.omp/agent.
 * Upstream pi uses @earendil-works/* packages and getAgentDir() returns ~/.pi/agent.
 */

let _getAgentDir: (() => string) | undefined;

try {
	const m = await import("@oh-my-pi/pi-coding-agent");
	_getAgentDir = m.getAgentDir;
} catch {
	const m = await import("@earendil-works/pi-coding-agent");
	_getAgentDir = m.getAgentDir;
}

// biome-ignore lint/style/noNonNullAssertion: one of the two imports always succeeds
export const getAgentDir = _getAgentDir!;
