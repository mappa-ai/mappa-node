/**
 * Attempts to execute an asynchronous function up to a specified number of retries.
 * If the function fails, it will retry until the maximum number of attempts is reached.
 * Throws the last encountered error if all attempts fail.
 */
export async function withRetry<T>(
	fn: () => Promise<T>,
	retries = 3,
): Promise<T> {
	let lastError: unknown;
	for (let attempt = 0; attempt < retries; attempt++) {
		try {
			return await fn();
		} catch (err) {
			console.warn(`Attempt ${attempt + 1} failed. Retrying...`);
			lastError = err;
		}
	}
	throw lastError;
}
