import { ProductList } from '@/components/ProductList';
import { listProducts } from '@/server/catalogue';

/**
 * The backoffice home: the product list.
 *
 * A server component reading as a staff caller, so it shows every product regardless of
 * status. Dynamic rather than cached — a staff member editing the catalogue expects to see
 * their change immediately, so there is no ISR here.
 */
export const dynamic = 'force-dynamic';

export default async function ProductsPage() {
  const products = await listProducts();
  return <ProductList products={products} />;
}
