import { MappaError } from "$/errors";
import type { Transport } from "$/resources/transport";
import type {
	Entity,
	EntityTagsResult,
	ListEntitiesOptions,
	ListEntitiesResponse,
} from "$/types";

/**
 * Tag validation regex: 1-64 chars, alphanumeric with underscores and hyphens.
 */
const TAG_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Maximum number of tags per request.
 */
const MAX_TAGS_PER_REQUEST = 10;

/**
 * Validates a single tag.
 * @throws {MappaError} if validation fails
 */
function validateTag(tag: string): void {
	if (typeof tag !== "string") {
		throw new MappaError("Tags must be strings");
	}
	if (!TAG_REGEX.test(tag)) {
		throw new MappaError(
			`Invalid tag "${tag}": must be 1-64 characters, alphanumeric with underscores and hyphens only`,
		);
	}
}

/**
 * Validates an array of tags.
 * @throws {MappaError} if validation fails
 */
function validateTags(tags: string[]): void {
	if (!Array.isArray(tags)) {
		throw new MappaError("tags must be an array");
	}
	if (tags.length > MAX_TAGS_PER_REQUEST) {
		throw new MappaError(
			`Too many tags: maximum ${MAX_TAGS_PER_REQUEST} per request`,
		);
	}
	for (const tag of tags) {
		validateTag(tag);
	}
}

/**
 * Entities API resource.
 *
 * Responsibilities:
 * - List entities with optional tag filtering (`GET /v1/entities`)
 * - Get single entity details (`GET /v1/entities/:entityId`)
 * - Add tags to entities (`POST /v1/entities/:entityId/tags`)
 * - Remove tags from entities (`DELETE /v1/entities/:entityId/tags`)
 * - Replace all entity tags (`PUT /v1/entities/:entityId/tags`)
 *
 * Entities represent analyzed speakers identified by voice fingerprints.
 * Tags allow you to label entities (e.g., "interviewer", "sales-rep") for easier
 * filtering and identification across multiple reports.
 */
export class EntitiesResource {
	constructor(private readonly transport: Transport) {}

	/**
	 * Get a single entity by ID.
	 *
	 * Returns entity metadata including tags, creation time, and usage statistics.
	 *
	 * @param entityId - The entity ID to retrieve
	 * @param opts - Optional request options (requestId, signal)
	 * @returns Entity details with tags and metadata
	 *
	 * @example
	 * ```typescript
	 * const entity = await mappa.entities.get("entity_abc123");
	 * console.log(entity.tags); // ["interviewer", "john"]
	 * ```
	 */
	async get(
		entityId: string,
		opts?: { requestId?: string; signal?: AbortSignal },
	): Promise<Entity> {
		if (!entityId || typeof entityId !== "string") {
			throw new MappaError("entityId must be a non-empty string");
		}

		const res = await this.transport.request<Entity>({
			method: "GET",
			path: `/v1/entities/${encodeURIComponent(entityId)}`,
			requestId: opts?.requestId,
			signal: opts?.signal,
			retryable: true,
		});
		return res.data;
	}

	/**
	 * List entities with optional tag filtering.
	 *
	 * Supports cursor-based pagination. Use the returned `cursor` for fetching
	 * subsequent pages, or use {@link listAll} for automatic pagination.
	 *
	 * When `tags` is provided, only entities with ALL specified tags are returned (AND logic).
	 *
	 * @param opts - List options: tags filter, cursor, limit
	 * @returns Paginated list of entities
	 *
	 * @example
	 * ```typescript
	 * // List all entities
	 * const page1 = await mappa.entities.list({ limit: 20 });
	 *
	 * // Filter by tags (must have both "interviewer" AND "sales")
	 * const filtered = await mappa.entities.list({
	 *   tags: ["interviewer", "sales"],
	 *   limit: 50
	 * });
	 *
	 * // Pagination
	 * const page2 = await mappa.entities.list({
	 *   cursor: page1.cursor,
	 *   limit: 20
	 * });
	 * ```
	 */
	async list(
		opts?: ListEntitiesOptions & { requestId?: string; signal?: AbortSignal },
	): Promise<ListEntitiesResponse> {
		const query: Record<string, string> = {};

		if (opts?.tags) {
			validateTags(opts.tags);
			// Join tags with comma for API query parameter
			query.tags = opts.tags.join(",");
		}

		if (opts?.cursor) {
			query.cursor = opts.cursor;
		}

		if (opts?.limit !== undefined) {
			query.limit = String(opts.limit);
		}

		const res = await this.transport.request<ListEntitiesResponse>({
			method: "GET",
			path: "/v1/entities",
			query,
			requestId: opts?.requestId,
			signal: opts?.signal,
			retryable: true,
		});

		return res.data;
	}

	/**
	 * Async iterator that automatically paginates through all entities.
	 *
	 * Useful for processing large entity sets without manual pagination management.
	 *
	 * @param opts - List options: tags filter, limit per page
	 * @yields Individual entities
	 *
	 * @example
	 * ```typescript
	 * // Process all entities with "interviewer" tag
	 * for await (const entity of mappa.entities.listAll({ tags: ["interviewer"] })) {
	 *   console.log(`${entity.id}: ${entity.tags.join(", ")}`);
	 * }
	 * ```
	 */
	async *listAll(
		opts?: Omit<ListEntitiesOptions, "cursor"> & {
			requestId?: string;
			signal?: AbortSignal;
		},
	): AsyncIterable<Entity> {
		let cursor: string | undefined;
		let hasMore = true;

		while (hasMore) {
			const page = await this.list({ ...opts, cursor });
			for (const entity of page.entities) {
				yield entity;
			}
			cursor = page.cursor;
			hasMore = page.hasMore;
		}
	}

	/**
	 * Get all entities with a specific tag.
	 *
	 * Convenience wrapper around {@link list} for single-tag filtering.
	 *
	 * @param tag - The tag to filter by
	 * @param opts - Optional pagination and request options
	 * @returns Paginated list of entities with the specified tag
	 *
	 * @example
	 * ```typescript
	 * const interviewers = await mappa.entities.getByTag("interviewer");
	 * ```
	 */
	async getByTag(
		tag: string,
		opts?: Omit<ListEntitiesOptions, "tags"> & {
			requestId?: string;
			signal?: AbortSignal;
		},
	): Promise<ListEntitiesResponse> {
		validateTag(tag);
		return this.list({ ...opts, tags: [tag] });
	}

	/**
	 * Add tags to an entity.
	 *
	 * Idempotent: existing tags are preserved, duplicates are ignored.
	 *
	 * @param entityId - The entity ID to tag
	 * @param tags - Array of tags to add (1-10 tags, each 1-64 chars)
	 * @param opts - Optional request options
	 * @returns Updated tags for the entity
	 *
	 * @example
	 * ```typescript
	 * await mappa.entities.addTags("entity_abc123", ["interviewer", "john"]);
	 * ```
	 */
	async addTags(
		entityId: string,
		tags: string[],
		opts?: { requestId?: string; signal?: AbortSignal },
	): Promise<EntityTagsResult> {
		if (!entityId || typeof entityId !== "string") {
			throw new MappaError("entityId must be a non-empty string");
		}
		if (tags.length === 0) {
			throw new MappaError("At least one tag is required");
		}
		validateTags(tags);

		const res = await this.transport.request<EntityTagsResult>({
			method: "POST",
			path: `/v1/entities/${encodeURIComponent(entityId)}/tags`,
			body: { tags },
			requestId: opts?.requestId,
			signal: opts?.signal,
			retryable: true,
		});
		return res.data;
	}

	/**
	 * Remove tags from an entity.
	 *
	 * Idempotent: missing tags are silently ignored.
	 *
	 * @param entityId - The entity ID to update
	 * @param tags - Array of tags to remove
	 * @param opts - Optional request options
	 * @returns Updated tags for the entity
	 *
	 * @example
	 * ```typescript
	 * await mappa.entities.removeTags("entity_abc123", ["interviewer"]);
	 * ```
	 */
	async removeTags(
		entityId: string,
		tags: string[],
		opts?: { requestId?: string; signal?: AbortSignal },
	): Promise<EntityTagsResult> {
		if (!entityId || typeof entityId !== "string") {
			throw new MappaError("entityId must be a non-empty string");
		}
		if (tags.length === 0) {
			throw new MappaError("At least one tag is required");
		}
		validateTags(tags);

		const res = await this.transport.request<EntityTagsResult>({
			method: "DELETE",
			path: `/v1/entities/${encodeURIComponent(entityId)}/tags`,
			body: { tags },
			requestId: opts?.requestId,
			signal: opts?.signal,
			retryable: true,
		});
		return res.data;
	}

	/**
	 * Replace all tags on an entity.
	 *
	 * Sets the complete tag list, removing any tags not in the provided array.
	 * Pass an empty array to remove all tags.
	 *
	 * @param entityId - The entity ID to update
	 * @param tags - New complete tag list (0-10 tags)
	 * @param opts - Optional request options
	 * @returns Updated tags for the entity
	 *
	 * @example
	 * ```typescript
	 * // Replace all tags
	 * await mappa.entities.setTags("entity_abc123", ["sales-rep", "john"]);
	 *
	 * // Remove all tags
	 * await mappa.entities.setTags("entity_abc123", []);
	 * ```
	 */
	async setTags(
		entityId: string,
		tags: string[],
		opts?: { requestId?: string; signal?: AbortSignal },
	): Promise<EntityTagsResult> {
		if (!entityId || typeof entityId !== "string") {
			throw new MappaError("entityId must be a non-empty string");
		}
		validateTags(tags);

		const res = await this.transport.request<EntityTagsResult>({
			method: "PUT",
			path: `/v1/entities/${encodeURIComponent(entityId)}/tags`,
			body: { tags },
			requestId: opts?.requestId,
			signal: opts?.signal,
			retryable: true,
		});
		return res.data;
	}
}
