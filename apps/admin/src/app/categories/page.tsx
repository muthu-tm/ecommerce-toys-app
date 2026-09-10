import { CategoryManager } from '@/components/CategoryManager';
import { getCategories } from '@/server/catalogue';

/**
 * The backoffice category management page.
 *
 * A server component reading the category tree as a staff caller. Dynamic rather than cached —
 * a staff member editing the tree expects to see their change immediately — the same as the
 * product list.
 */
export const dynamic = 'force-dynamic';

export default async function CategoriesPage() {
  const categories = await getCategories();
  return <CategoryManager categories={categories} />;
}
