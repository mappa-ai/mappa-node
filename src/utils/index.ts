import { init } from "@paralleldrive/cuid2";

const createId = init({
	length: 32,
});

export function assertNever(x: never): never {
	throw new Error(`Unexpected object: ${String(x)}`);
}

export function isObject(x: unknown): x is Record<string, unknown> {
	return typeof x === "object" && x !== null;
}

export function getHeader(headers: Headers, name: string): string | undefined {
	const v = headers.get(name);
	return v === null ? undefined : v;
}

export function jitter(ms: number): number {
	// +/- 20%
	const r = 0.8 + Math.random() * 0.4;
	return Math.floor(ms * r);
}

export function backoffMs(
	attempt: number,
	baseMs: number,
	maxMs: number,
): number {
	// exponential: base * 2^(attempt-1)
	const ms = baseMs * 2 ** Math.max(0, attempt - 1);
	return Math.min(ms, maxMs);
}

export function nowMs(): number {
	return Date.now();
}

export function hasAbortSignal(signal?: AbortSignal): boolean {
	return !!signal && typeof signal.aborted === "boolean";
}

export function makeAbortError(): Error {
	const e = new Error("The operation was aborted");
	e.name = "AbortError";
	return e;
}

export function randomId(prefix = "req"): string {
	return `${prefix}_${createId()}`;
}
