/**
 * `@romp/store-config` — the white-label core.
 *
 * **ROMP is a configuration, not the product.** Brand, palette, typography, copy,
 * locale, currency, feature set, age bands, categories, warehouses and commerce
 * parameters all live in one validated file per store, and creating a store requires
 * zero changes under `apps/` or `packages/`.
 *
 * Three things make that a contract rather than a hope:
 *
 *  1. **The schema is exhaustive and fail-fast.** A missing or nonsensical value fails
 *     the build with the exact path, instead of rendering a half-branded store.
 *  2. **Contrast is gated.** A palette that fails WCAG AA cannot ship, so handing
 *     palette choices to whoever configures the next store does not hand them the
 *     accessibility problem too.
 *  3. **Tokens are emitted twice** — CSS custom properties and a Tailwind theme — so
 *     neither a utility class nor an inline style ever needs a literal, which is what
 *     makes the `no-hardcoded-brand` lint rule enforceable.
 *
 * The loader is Node-only and lives at `@romp/store-config/loader`. Apps consume the
 * *generated* artefacts, never the loader.
 */

export {
  CONTRAST_THRESHOLDS,
  contrastRatio,
  formatContrastRatio,
  isHexColor,
  meetsContrast,
  parseHexColor,
  relativeLuminance,
} from './color';
export type { ContrastRequirement, Rgb } from './color';

export {
  ContrastError,
  assertContrast,
  contrastPairs,
  findContrastFailures,
  formatContrastFailures,
} from './contrast';
export type { ContrastFailure, ContrastPair } from './contrast';

export {
  AgeBandConfigSchema,
  AgeBandsSchema,
  BrandSchema,
  CatalogueMediaSchema,
  CatalogueProductSchema,
  CatalogueSafetySchema,
  CatalogueSeedSchema,
  CatalogueVariantSchema,
  CategoriesSchema,
  CategorySeedSchema,
  CommerceConfigSchema,
  ContactConfigSchema,
  ContentSchema,
  EmptyStatesSchema,
  FEATURE_FLAG_NAMES,
  FeatureFlagsSchema,
  FontSchema,
  FontSourceSchema,
  FooterSchema,
  HomeContentSchema,
  LocaleConfigSchema,
  MotionIntensitySchema,
  NotificationTemplateSchema,
  NotificationTemplatesSchema,
  PoliciesSchema,
  ProductContentSchema,
  StoreConfigSchema,
  ThemeColorsSchema,
  ThemeFontsSchema,
  ThemeMotionSchema,
  ThemeRadiiSchema,
  ThemeSchema,
  ThemeShadowsSchema,
  WarehouseConfigSchema,
  WarehousesSchema,
  brandAssetPaths,
  buildWhatsappLink,
  buildWhatsappMessage,
  defineCatalogueSeed,
  defineStoreConfig,
  renderTemplate,
} from './schema';
export type {
  AgeBandConfig,
  Brand,
  CatalogueMedia,
  CatalogueProduct,
  CatalogueSafety,
  CatalogueSeed,
  CatalogueSeedInput,
  CatalogueVariant,
  CategorySeed,
  CommerceConfig,
  ContactConfig,
  Content,
  FeatureFlags,
  ProductContent,
  Font,
  LocaleConfig,
  MotionIntensity,
  StoreConfig,
  StoreConfigInput,
  Theme,
  ThemeColors,
  ThemeRadii,
  WarehouseConfig,
} from './schema';

export type { PublicStoreConfig } from './tokens';
export {
  TOKEN_PREFIX,
  fontCssVariable,
  fontStack,
  googleFontExportName,
  publicRuntimeConfig,
  renderFontsModule,
  renderTailwindThemeCss,
  renderThemeCss,
  themeCustomProperties,
} from './tokens';
