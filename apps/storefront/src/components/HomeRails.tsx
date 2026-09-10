import { ProductRail } from '@/components/ProductRail';
import { categoryRail, featuredProducts, getNavCategories } from '@/server/catalogue';

/**
 * The home page's data-dependent rails.
 *
 * Extracted from the page so they are exported and directly testable — an async server
 * component cannot be mounted synchronously, so a test calls it to resolve its element and
 * renders that. Keeping them in the page would make that awkward, and the page reads
 * better as a declarative shell with these two dropped into Suspense boundaries.
 */

const FEATURED_LIMIT = 8;
const RAIL_LIMIT = 6;

/** The featured rail — the newest products across the store, above the fold. */
export async function FeaturedRail({ title }: { readonly title: string }) {
  const products = await featuredProducts(FEATURED_LIMIT);

  return (
    <ProductRail
      title={title}
      products={products}
      seeAllHref="/c/all"
      headingId="featured-heading"
    />
  );
}

/**
 * One rail per navigation category that has products.
 *
 * Reads the nav categories, then a short rail for each. Empty categories render nothing
 * (the rail returns null), so a store mid-setup shows only the categories it has stocked
 * rather than a wall of empty headings — which is the state of every category on a freshly
 * seeded store until it is stocked.
 */
export async function NavCategoryRails() {
  const categories = await getNavCategories();
  const rails = await Promise.all(
    categories.map(async (category) => ({
      category,
      products: await categoryRail(category.slug, RAIL_LIMIT),
    })),
  );

  return (
    <div className="flex flex-col gap-16">
      {rails.map(({ category, products }) => (
        <ProductRail
          key={category.id}
          title={category.name}
          products={products}
          seeAllHref={`/c/${category.slug}`}
          headingId={`rail-${category.slug}`}
        />
      ))}
    </div>
  );
}
