import Link from 'next/link';

import type { ProductDoc } from '@romp/contracts';
import type { WithId } from '@romp/data';
import { Badge, ButtonLink, Card, InitialTile, PageHeader } from '@romp/ui';

import { statusLabel, statusTone } from '@/lib/product-view';
import { formatMoney, mediaUrl, moneyFormat } from '@/lib/store';

/**
 * The backoffice product list.
 *
 * A server component: the data is read server-side as a staff caller, so drafts and archived
 * products appear here though they never reach the storefront. Each row links to the edit
 * page and shows the status badge and the "from" price. The empty state is a plain
 * affordance, not brand copy.
 */
export function ProductList({ products }: { readonly products: readonly WithId<ProductDoc>[] }) {
  return (
    <section aria-labelledby="products-heading" className="flex flex-col gap-6">
      <PageHeader
        title={<span id="products-heading">Products</span>}
        description={`${String(products.length)} in the catalogue`}
        actions={<ButtonLink href="/products/new">New product</ButtonLink>}
      />

      {products.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="font-body text-text-muted">
            No products yet. Create one to start building the catalogue.
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {products.map((product) => {
            const cover = product.media.find((item) => item.order === 0) ?? product.media[0] ?? null;
            const image = mediaUrl(cover?.path ?? null);
            return (
              <li key={product.id}>
                <Card interactive className="overflow-hidden">
                  <Link
                    href={`/products/${product.id}`}
                    className="flex items-center gap-4 p-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                  >
                    <span className="size-14 shrink-0 overflow-hidden rounded-md">
                      {image !== null ? (
                        <img src={image} alt="" className="size-14 object-cover" />
                      ) : (
                        <InitialTile name={product.name} size="sm" />
                      )}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-body font-semibold text-text-primary">
                        {product.name}
                      </span>
                      <span className="truncate font-body text-sm text-text-muted">
                        {product.slug}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-4">
                      <span className="font-body text-sm text-text-primary">
                        {product.variantSummary.length > 0
                          ? formatMoney(product.priceFromMinor, moneyFormat)
                          : '—'}
                      </span>
                      <Badge tone={statusTone(product.status)}>{statusLabel(product.status)}</Badge>
                    </span>
                  </Link>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
