import { z } from 'zod';

import { BrandSchema } from './brand';
import { CommerceConfigSchema } from './commerce';
import { ContactConfigSchema } from './contact';
import { ContentSchema } from './content';
import { FeatureFlagsSchema } from './features';
import { LocaleConfigSchema } from './locale';
import { ThemeSchema } from './theme';
import { WarehousesSchema } from './warehouses';

/**
 * A complete store configuration.
 *
 * One file per store defines everything that distinguishes it: brand, palette,
 * typography, copy, locale, tax, feature set, commerce parameters, warehouses,
 * categories and age bands. Creating a store requires **zero changes under `apps/` or
 * `packages/`** — the contract `docs/WHITE_LABEL.md` defines and CI verifies.
 */
export const StoreConfigSchema = z.object({
  brand: BrandSchema,
  theme: ThemeSchema,
  locale: LocaleConfigSchema,
  content: ContentSchema,
  contact: ContactConfigSchema,
  features: FeatureFlagsSchema,
  commerce: CommerceConfigSchema,
  warehouses: WarehousesSchema,
});

export type StoreConfig = z.infer<typeof StoreConfigSchema>;
/** The shape an author writes, before defaults and transforms are applied. */
export type StoreConfigInput = z.input<typeof StoreConfigSchema>;

/**
 * Declares a store configuration.
 *
 * Deliberately **does not validate**. It exists for editor completion and inference
 * while authoring, and the file is a module that Next's build graph imports — throwing
 * here would fail a page render at an arbitrary moment rather than failing the build
 * at a predictable one. Validation is the loader's job, called once from the generator
 * and from the config test.
 */
export function defineStoreConfig(config: StoreConfigInput): StoreConfigInput {
  return config;
}

export { BrandSchema, brandAssetPaths } from './brand';
export type { Brand } from './brand';
export {
  CatalogueMediaSchema,
  CatalogueProductSchema,
  CatalogueSafetySchema,
  CatalogueSeedSchema,
  CatalogueVariantSchema,
  defineCatalogueSeed,
} from './catalogue';
export type {
  CatalogueMedia,
  CatalogueProduct,
  CatalogueSafety,
  CatalogueSeed,
  CatalogueSeedInput,
  CatalogueVariant,
} from './catalogue';
export { CommerceConfigSchema } from './commerce';
export type { CommerceConfig } from './commerce';
export { ContactConfigSchema, buildWhatsappLink, buildWhatsappMessage } from './contact';
export type { ContactConfig } from './contact';
export {
  AgeBandConfigSchema,
  AgeBandsSchema,
  CategoriesSchema,
  CategorySeedSchema,
  ContentSchema,
  EmptyStatesSchema,
  FooterSchema,
  HomeContentSchema,
  NotificationTemplateSchema,
  NotificationTemplatesSchema,
  PoliciesSchema,
  ProductContentSchema,
  ReviewsContentSchema,
  renderTemplate,
} from './content';
export type {
  AgeBandConfig,
  CategorySeed,
  Content,
  ProductContent,
  ReviewsContent,
} from './content';
export { FEATURE_FLAG_NAMES, FeatureFlagsSchema } from './features';
export type { FeatureFlags } from './features';
export { LocaleConfigSchema } from './locale';
export type { LocaleConfig } from './locale';
export {
  DefaultThemeModeSchema,
  FontSchema,
  FontSourceSchema,
  MotionIntensitySchema,
  ThemeColorsSchema,
  ThemeFontsSchema,
  ThemeModesSchema,
  ThemeMotionSchema,
  ThemeRadiiSchema,
  ThemeSchema,
  ThemeShadowsSchema,
} from './theme';
export type {
  DefaultThemeMode,
  Font,
  MotionIntensity,
  Theme,
  ThemeColors,
  ThemeModes,
  ThemeRadii,
} from './theme';
export { WarehouseConfigSchema, WarehousesSchema } from './warehouses';
export type { WarehouseConfig } from './warehouses';
