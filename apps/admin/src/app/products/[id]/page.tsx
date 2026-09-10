import { notFound } from 'next/navigation';

import { InventoryEditor } from '@/components/InventoryEditor';
import { MediaManager } from '@/components/MediaManager';
import { ProductForm } from '@/components/ProductForm';
import { ProductStatusControls } from '@/components/ProductStatusControls';
import { VariantEditor } from '@/components/VariantEditor';
import { productDocToFormState } from '@/lib/product-form';
import {
  getCategories,
  getProductForEdit,
  getVariantInventory,
  getWarehouses,
} from '@/server/catalogue';

/**
 * The product edit page.
 *
 * Everything a staff member does to one product lives here: edit its content and SEO, manage
 * its variants and media, and change its publication status. Read server-side as a staff
 * caller so a draft is editable; each control writes through the API and refreshes.
 */
export const dynamic = 'force-dynamic';

interface EditPageProps {
  readonly params: Promise<{ readonly id: string }>;
}

export default async function EditProductPage({ params }: EditPageProps) {
  const { id } = await params;
  const [result, categories, warehouses] = await Promise.all([
    getProductForEdit(id),
    getCategories(),
    getWarehouses(),
  ]);

  if (result === null) notFound();

  const { product, variants } = result;

  // Inventory is one document per variant, so read them together — the editor renders every
  // warehouse (at zero when the variant has no record yet).
  const inventories = await Promise.all(variants.map((variant) => getVariantInventory(variant.id)));

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-2xl text-text-primary">{product.name}</h1>
        <ProductStatusControls productId={product.id} status={product.status} />
      </div>

      <ProductForm
        productId={product.id}
        initial={productDocToFormState(product)}
        categories={categories.map((category) => ({
          id: category.id,
          slug: category.slug,
          name: category.name,
        }))}
      />

      <VariantEditor productId={product.id} variants={variants} />

      {variants.length > 0 ? (
        <section aria-labelledby="inventory-heading" className="flex flex-col gap-6">
          <h2 id="inventory-heading" className="font-display text-xl text-text-primary">
            Inventory
          </h2>
          {variants.map((variant, index) => (
            <InventoryEditor
              key={variant.id}
              productId={product.id}
              variantId={variant.id}
              variantName={variant.name}
              warehouses={warehouses}
              inventory={inventories[index] ?? null}
            />
          ))}
        </section>
      ) : null}

      <MediaManager productId={product.id} media={product.media} />
    </div>
  );
}
