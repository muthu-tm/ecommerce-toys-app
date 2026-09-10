import Link from 'next/link';

import type { ProductDoc } from '@romp/contracts';
import type { WithId } from '@romp/data';
import { ButtonLink, Badge, Card } from '@romp/ui';

import { statusLabel, statusTone } from '@/lib/product-view';
import { formatMoney, moneyFormat } from '@/lib/store';

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
      <div className="flex items-center justify-between">
        <h1 id="products-heading" className="font-display text-2xl text-text-primary">
          Products
        </h1>
        <ButtonLink href="/products/new">New product</ButtonLink>
      </div>

      {products.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="font-body text-text-muted">
            No products yet. Create one to start building the catalogue.
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {products.map((product) => (
            <li key={product.id}>
              <Link
                href={`/products/${product.id}`}
                className="flex items-center justify-between rounded-md border border-border bg-surface px-4 py-3 hover:border-border-strong"
              >
                <span className="flex flex-col">
                  <span className="font-body font-semibold text-text-primary">{product.name}</span>
                  <span className="font-body text-sm text-text-muted">{product.slug}</span>
                </span>
                <span className="flex items-center gap-4">
                  <span className="font-body text-sm text-text-primary">
                    {product.variantSummary.length > 0
                      ? formatMoney(product.priceFromMinor, moneyFormat)
                      : '—'}
                  </span>
                  <Badge tone={statusTone(product.status)}>{statusLabel(product.status)}</Badge>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
