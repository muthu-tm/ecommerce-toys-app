import { ProductForm } from '@/components/ProductForm';
import { getCategories } from '@/server/catalogue';

/**
 * The create-product page.
 *
 * A new product starts as a draft with no variants or media — the form captures the content
 * and SEO, and the edit page it navigates to on success is where variants and images are
 * added. Categories are read server-side for the form's selector.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'New product' };

export default async function NewProductPage() {
  const categories = await getCategories();
  return (
    <section className="flex flex-col gap-6">
      <h1 className="font-display text-2xl text-text-primary">New product</h1>
      <ProductForm
        categories={categories.map((category) => ({
          id: category.id,
          slug: category.slug,
          name: category.name,
        }))}
      />
    </section>
  );
}
