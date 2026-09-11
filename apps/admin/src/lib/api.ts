'use client';

import type {
  AdminOrderMutationResponse,
  CancelOrderRequest,
  CreateCategoryRequest,
  CreateCategoryResponse,
  CreateProductRequest,
  CreateProductResponse,
  CreateVariantRequest,
  CreateVariantResponse,
  FulfilmentRequest,
  InventoryAdjustRequest,
  InventoryResponse,
  IssueRefundRequest,
  IssueRefundResponse,
  ModerationQueueResponse,
  ProductStatus,
  ReviewRejectRequest,
  RegisterMediaRequest,
  RegisterMediaResponse,
  ReorderCategoriesRequest,
  UpdateCategoryRequest,
  UpdateProductRequest,
  UpdateVariantRequest,
} from '@romp/contracts';

import { operatorToken } from './auth';

/**
 * The typed client for the backoffice API.
 *
 * Every catalogue write the admin makes goes through the API, which is the one place a
 * mutation happens and where the audit lives. This attaches the operator's bearer token and
 * maps a non-2xx response to a thrown `ApiError` carrying the problem+json `code` and
 * `detail`, so a form can show the server's own message. Coverage-excluded: it is fetch glue
 * over the network; the request bodies it sends are built and tested in `product-form.ts`.
 *
 * `NEXT_PUBLIC_API_BASE_URL` is the API origin, deployment configuration per environment.
 */

const apiBase = (): string => (process.env.NEXT_PUBLIC_API_BASE_URL ?? '').replace(/\/+$/u, '');

/** A structured API failure, carrying the problem+json code for the UI to branch on. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, detail: string) {
    super(detail);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await operatorToken();
  if (token === null) {
    throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in as a staff member to make changes.');
  }

  const response = await fetch(`${apiBase()}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as {
      code?: string;
      detail?: string;
    };
    throw new ApiError(
      response.status,
      problem.code ?? 'INTERNAL',
      problem.detail ?? 'The request failed.',
    );
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

/** A request whose success response carries no body (204). Kept separate to avoid a `void` type arg. */
async function requestNoContent(method: string, path: string, body?: unknown): Promise<void> {
  await request<unknown>(method, path, body);
}

export const adminApi = {
  createProduct: (body: CreateProductRequest) =>
    request<CreateProductResponse>('POST', '/v1/admin/products', body),
  updateProduct: (id: string, body: UpdateProductRequest) =>
    requestNoContent('PATCH', `/v1/admin/products/${id}`, body),
  setStatus: (id: string, status: ProductStatus) =>
    requestNoContent('POST', `/v1/admin/products/${id}/status`, { status }),
  createVariant: (id: string, body: CreateVariantRequest) =>
    request<CreateVariantResponse>('POST', `/v1/admin/products/${id}/variants`, body),
  updateVariant: (id: string, variantId: string, body: UpdateVariantRequest) =>
    requestNoContent('PATCH', `/v1/admin/products/${id}/variants/${variantId}`, body),
  registerMedia: (id: string, body: RegisterMediaRequest) =>
    request<RegisterMediaResponse>('POST', `/v1/admin/products/${id}/media`, body),
  adjustInventory: (id: string, variantId: string, body: InventoryAdjustRequest) =>
    request<InventoryResponse>(
      'POST',
      `/v1/admin/products/${id}/variants/${variantId}/inventory`,
      body,
    ),
  createCategory: (body: CreateCategoryRequest) =>
    request<CreateCategoryResponse>('POST', '/v1/admin/categories', body),
  updateCategory: (id: string, body: UpdateCategoryRequest) =>
    requestNoContent('PATCH', `/v1/admin/categories/${id}`, body),
  reorderCategories: (body: ReorderCategoriesRequest) =>
    requestNoContent('POST', '/v1/admin/categories/reorder', body),
  deleteCategory: (id: string) => requestNoContent('DELETE', `/v1/admin/categories/${id}`),
  advanceFulfilment: (id: string, body: FulfilmentRequest) =>
    request<AdminOrderMutationResponse>('POST', `/v1/admin/orders/${id}/fulfilment`, body),
  cancelOrder: (id: string, body: CancelOrderRequest) =>
    request<AdminOrderMutationResponse>('POST', `/v1/admin/orders/${id}/cancel`, body),
  issueRefund: (body: IssueRefundRequest) =>
    request<IssueRefundResponse>('POST', '/v1/admin/refunds', body),
  listReviewQueue: () => request<ModerationQueueResponse>('GET', '/v1/admin/reviews'),
  publishReview: (id: string) => requestNoContent('POST', `/v1/admin/reviews/${id}/publish`),
  rejectReview: (id: string, body: ReviewRejectRequest) =>
    requestNoContent('POST', `/v1/admin/reviews/${id}/reject`, body),
};
