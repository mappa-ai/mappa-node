function isObject(v: unknown): v is Record<string, unknown> {
	return v !== null && typeof v === "object";
}

/**
 * Async signature verification using WebCrypto (works in modern Node and browsers).
 * Signature scheme placeholder:
 *   headers["mappa-signature"] = "t=1700000000,v1=<hex_hmac_sha256>"
 * Signed payload: `${t}.${rawBody}`
 */

export class WebhooksResource {
	async verifySignature(params: {
		payload: string; // raw body
		headers: Record<string, string | string[] | undefined>;
		secret: string;
		toleranceSec?: number;
	}): Promise<{ ok: true }> {
		const tolerance = params.toleranceSec ?? 300;

		const sigHeader = headerValue(params.headers, "mappa-signature");
		if (!sigHeader) throw new Error("Missing mappa-signature header");

		const parts = parseSig(sigHeader);
		const ts = Number(parts.t);
		if (!Number.isFinite(ts)) throw new Error("Invalid signature timestamp");

		const nowSec = Math.floor(Date.now() / 1000);
		if (Math.abs(nowSec - ts) > tolerance)
			throw new Error("Signature timestamp outside tolerance");

		const signed = `${parts.t}.${params.payload}`;
		const expected = await hmacHex(params.secret, signed);

		if (!timingSafeEqualHex(expected, parts.v1))
			throw new Error("Invalid signature");

		return { ok: true };
	}

	parseEvent<T = unknown>(
		payload: string,
	): { id: string; type: string; createdAt: string; data: T } {
		const raw: unknown = JSON.parse(payload);
		if (!isObject(raw))
			throw new Error("Invalid webhook payload: not an object");
		const obj = raw;

		const id = obj.id;
		const type = obj.type;
		const createdAt = obj.createdAt;

		if (typeof id !== "string")
			throw new Error("Invalid webhook payload: id must be a string");
		if (typeof type !== "string")
			throw new Error("Invalid webhook payload: type must be a string");
		if (typeof createdAt !== "string")
			throw new Error("Invalid webhook payload: createdAt must be a string");

		return {
			id,
			type,
			createdAt,
			data: "data" in obj ? (obj.data as T) : (undefined as unknown as T),
		};
	}
}

function headerValue(
	headers: Record<string, string | string[] | undefined>,
	name: string,
): string | undefined {
	const key = Object.keys(headers).find(
		(k) => k.toLowerCase() === name.toLowerCase(),
	);
	const v = key ? headers[key] : undefined;
	if (!v) return undefined;
	return Array.isArray(v) ? v[0] : v;
}

function parseSig(h: string): { t: string; v1: string } {
	const out: Record<string, string> = {};
	for (const part of h.split(",")) {
		const [k, v] = part.split("=");
		if (k && v) out[k.trim()] = v.trim();
	}
	if (!out.t || !out.v1) throw new Error("Invalid signature format");
	return { t: out.t, v1: out.v1 };
}

async function hmacHex(secret: string, message: string): Promise<string> {
	const enc = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		enc.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
	return bufToHex(sig);
}

function bufToHex(buf: ArrayBuffer): string {
	const b = new Uint8Array(buf);
	let s = "";
	for (const x of b) s += x.toString(16).padStart(2, "0");
	return s;
}

function timingSafeEqualHex(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let r = 0;
	for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return r === 0;
}
