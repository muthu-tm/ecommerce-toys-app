import type { Firestore } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { aWarehouse } from '@romp/contracts/fixtures';

import { paths } from '../paths';

import { SeedRefusedError, applySeedPlan, resetSeededCollections } from './apply';
import type { SeedPlan, SeedWrite } from './plan';

/**
 * The seed writer.
 *
 * Driven against an in-memory Firestore double rather than the emulator, because the
 * behaviour under test is the writer's own decisions — what it skips, what it refuses,
 * how it batches — and those should be assertable without a JVM. The double implements
 * exactly the four things `apply.ts` touches (`doc`, `batch`, `collection`,
 * `recursiveDelete`) and records every commit, so the batching assertion is real rather
 * than inferred.
 *
 * The complementary half is `infra/tests/seed.test.ts`, which runs the same writer
 * against the real Admin SDK and the real emulator. Neither test replaces the other:
 * this one proves the logic, that one proves the SDK usage.
 */

interface CommittedBatch {
  readonly paths: readonly string[];
}

interface FakeFirestore {
  /** Everything written, keyed by path. */
  readonly documents: Map<string, Record<string, unknown>>;
  /** One entry per `batch().commit()`, so the batching assertion is observed, not inferred. */
  readonly commits: CommittedBatch[];
  readonly deletedCollections: string[];
  /** Counts `get()` calls, so "reads only the conditional paths" is testable. */
  readonly readCount: () => number;
  readonly asFirestore: () => Firestore;
}

/**
 * A closure over the four members `apply.ts` touches.
 *
 * Object-literal factory rather than a class so there is no `this` to alias into the
 * per-reference closures the SDK's fluent shape requires.
 */
function fakeFirestore(): FakeFirestore {
  const documents = new Map<string, Record<string, unknown>>();
  const commits: CommittedBatch[] = [];
  const deletedCollections: string[] = [];
  let reads = 0;

  const doc = (path: string) => ({
    path,
    get: () => {
      reads += 1;
      const data = documents.get(path);
      return Promise.resolve({ exists: data !== undefined, data: () => data });
    },
    withConverter: (converter: { toFirestore: (data: unknown) => Record<string, unknown> }) => ({
      path,
      convert: (data: unknown) => converter.toFirestore(data),
    }),
  });

  const batch = () => {
    const staged: { path: string; data: Record<string, unknown> }[] = [];

    return {
      set(
        reference: { path: string; convert: (data: unknown) => Record<string, unknown> },
        data: unknown,
      ) {
        // Runs the converter, exactly as the real SDK does, so a document that fails
        // validation fails here rather than being silently accepted by the double.
        staged.push({ path: reference.path, data: reference.convert(data) });
      },
      commit() {
        for (const entry of staged) documents.set(entry.path, entry.data);
        commits.push({ paths: staged.map((entry) => entry.path) });
        return Promise.resolve();
      },
    };
  };

  const collection = (id: string) => ({ id });

  const recursiveDelete = (reference: { id: string }) => {
    deletedCollections.push(reference.id);
    for (const path of [...documents.keys()]) {
      if (path.startsWith(`${reference.id}/`)) documents.delete(path);
    }
    return Promise.resolve();
  };

  const surface = { doc, batch, collection, recursiveDelete };

  return {
    documents,
    commits,
    deletedCollections,
    readCount: () => reads,
    asFirestore: () => surface as unknown as Firestore,
  };
}

function warehouseWrite(code: string, mode: SeedWrite['mode'] = 'overwrite'): SeedWrite {
  return {
    path: paths.warehouse(code),
    converter: 'warehouses',
    mode,
    label: `warehouse ${code}`,
    data: { ...aWarehouse(), code: code as ReturnType<typeof aWarehouse>['code'] },
  };
}

function inventoryWrite(sku: string): SeedWrite {
  return {
    path: paths.inventory(sku),
    converter: 'inventory',
    mode: 'overwrite',
    label: `inventory ${sku}`,
    data: {
      productId: 'wooden-blocks',
      stock: { blr: 5 },
      onHandTotal: 5,
      reserved: 0,
      lowStockThreshold: 5,
      updatedAt: new Date('2026-03-01T09:30:00.000Z'),
    },
  };
}

const planOf = (writes: readonly SeedWrite[]): SeedPlan => ({
  storeId: 'romp',
  writes: [...writes],
});

describe('applySeedPlan', () => {
  it('writes every document in the plan', async () => {
    const db = fakeFirestore();
    const result = await applySeedPlan(
      db.asFirestore(),
      planOf([warehouseWrite('blr'), warehouseWrite('del')]),
    );

    expect(result.updated).toBe(2);
    expect(db.documents.has(paths.warehouse('blr'))).toBe(true);
    expect(db.documents.has(paths.warehouse('del'))).toBe(true);
  });

  it('runs each document through its converter before writing', async () => {
    const db = fakeFirestore();
    await applySeedPlan(db.asFirestore(), planOf([warehouseWrite('blr')]));

    expect(db.documents.get(paths.warehouse('blr'))?.name).toBe('Bengaluru hub');
  });

  it('refuses a document that fails its schema', async () => {
    const db = fakeFirestore();
    const broken: SeedWrite = {
      ...warehouseWrite('blr'),
      data: { ...aWarehouse(), servicePincodePrefixes: [] },
    };

    await expect(applySeedPlan(db.asFirestore(), planOf([broken]))).rejects.toThrow(
      /failed validation on write/,
    );
  });

  it('refuses a plan that writes the same document twice', async () => {
    const db = fakeFirestore();

    await expect(
      applySeedPlan(db.asFirestore(), planOf([warehouseWrite('blr'), warehouseWrite('blr')])),
    ).rejects.toThrow(/same document more than once/);
  });

  it('refuses a converter name that does not exist', async () => {
    const db = fakeFirestore();
    const write: SeedWrite = { ...warehouseWrite('blr'), converter: 'nope' };

    await expect(applySeedPlan(db.asFirestore(), planOf([write]))).rejects.toThrow(
      /converter "nope", which does not exist/,
    );
  });

  it('refuses a path that is not a document', async () => {
    const db = fakeFirestore();
    const write: SeedWrite = { ...warehouseWrite('blr'), path: 'warehouses' };

    await expect(applySeedPlan(db.asFirestore(), planOf([write]))).rejects.toThrow(
      /even number of segments/,
    );
  });
});

describe('createIfAbsent', () => {
  it('writes when the document does not exist', async () => {
    const db = fakeFirestore();
    const result = await applySeedPlan(
      db.asFirestore(),
      planOf([warehouseWrite('blr', 'createIfAbsent')]),
    );

    expect(result.created).toBe(1);
    expect(result.skipped).toBe(0);
    expect(db.documents.has(paths.warehouse('blr'))).toBe(true);
  });

  it('leaves an existing document alone', async () => {
    // This is what stops a seed run from reverting a fee change somebody made in admin.
    const db = fakeFirestore();
    db.documents.set(paths.warehouse('blr'), { edited: 'by an operator' });

    const result = await applySeedPlan(
      db.asFirestore(),
      planOf([warehouseWrite('blr', 'createIfAbsent')]),
    );

    expect(result.skipped).toBe(1);
    expect(result.created).toBe(0);
    expect(db.documents.get(paths.warehouse('blr'))).toEqual({ edited: 'by an operator' });
  });

  it('reports what it skipped and why', async () => {
    const db = fakeFirestore();
    db.documents.set(paths.warehouse('blr'), { edited: 'by an operator' });
    const messages: string[] = [];

    await applySeedPlan(db.asFirestore(), planOf([warehouseWrite('blr', 'createIfAbsent')]), {
      onProgress: (message) => messages.push(message),
    });

    expect(messages.join('\n')).toContain('does not own');
  });

  it('reads only the conditional paths, not the whole plan', async () => {
    // Otherwise the read count scales with the catalogue rather than with the handful
    // of singleton documents the seed does not own.
    const db = fakeFirestore();
    await applySeedPlan(
      db.asFirestore(),
      planOf([
        warehouseWrite('blr'),
        warehouseWrite('del'),
        warehouseWrite('mum', 'createIfAbsent'),
      ]),
    );

    expect(db.readCount()).toBe(1);
  });
});

describe('the live-reservation guard', () => {
  it('refuses to run when inventory has reserved stock', async () => {
    // Writing `reserved: 0` under a live order releases units without releasing the
    // order holding them, so two customers could buy the same unit.
    const db = fakeFirestore();
    db.documents.set(paths.inventory('WB-240'), { reserved: 2 });

    await expect(
      applySeedPlan(db.asFirestore(), planOf([inventoryWrite('WB-240')])),
    ).rejects.toThrow(SeedRefusedError);
  });

  it('names the documents that are holding stock', async () => {
    const db = fakeFirestore();
    db.documents.set(paths.inventory('WB-240'), { reserved: 2 });

    await expect(
      applySeedPlan(db.asFirestore(), planOf([inventoryWrite('WB-240')])),
    ).rejects.toThrow(/inventory\/WB-240/);
  });

  it('aborts the whole run rather than skipping the affected documents', async () => {
    // A half-seeded catalogue where products exist but their inventory does not is
    // worse than no change: the storefront shows items that cannot be bought.
    const db = fakeFirestore();
    db.documents.set(paths.inventory('WB-240'), { reserved: 2 });

    await expect(
      applySeedPlan(
        db.asFirestore(),
        planOf([warehouseWrite('blr'), inventoryWrite('WB-240'), inventoryWrite('WB-480')]),
      ),
    ).rejects.toThrow(SeedRefusedError);

    expect(db.commits).toHaveLength(0);
    expect(db.documents.has(paths.warehouse('blr'))).toBe(false);
  });

  it('proceeds when reserved is zero', async () => {
    const db = fakeFirestore();
    db.documents.set(paths.inventory('WB-240'), { reserved: 0 });

    await expect(
      applySeedPlan(db.asFirestore(), planOf([inventoryWrite('WB-240')])),
    ).resolves.toBeDefined();
  });

  it('proceeds when the inventory document does not exist yet', async () => {
    const db = fakeFirestore();

    await expect(
      applySeedPlan(db.asFirestore(), planOf([inventoryWrite('WB-240')])),
    ).resolves.toBeDefined();
  });

  it('ignores a non-numeric reserved value rather than crashing', async () => {
    // Read defensively: a document that is malformed for an unrelated reason must not
    // stop the guard from doing its job.
    const db = fakeFirestore();
    db.documents.set(paths.inventory('WB-240'), { reserved: 'lots' });

    await expect(
      applySeedPlan(db.asFirestore(), planOf([inventoryWrite('WB-240')])),
    ).resolves.toBeDefined();
  });

  it('skips the check entirely when the plan touches no inventory', async () => {
    const db = fakeFirestore();
    await applySeedPlan(db.asFirestore(), planOf([warehouseWrite('blr')]));

    expect(db.readCount()).toBe(0);
  });
});

describe('batching', () => {
  it('splits a plan larger than the batch limit', async () => {
    // Firestore caps a batch at 500 operations. The chunk size is 400, leaving room for
    // the existence reads `createIfAbsent` needs.
    const db = fakeFirestore();
    const writes = Array.from({ length: 401 }, (_unused, index) =>
      warehouseWrite(`wh${String(index)}`),
    );

    const result = await applySeedPlan(db.asFirestore(), planOf(writes));

    expect(result.updated).toBe(401);
    expect(db.commits).toHaveLength(2);
    expect(db.commits[0]?.paths).toHaveLength(400);
    expect(db.commits[1]?.paths).toHaveLength(1);
  });

  it('commits nothing when every write is skipped', async () => {
    const db = fakeFirestore();
    db.documents.set(paths.warehouse('blr'), { existing: true });

    await applySeedPlan(db.asFirestore(), planOf([warehouseWrite('blr', 'createIfAbsent')]));

    expect(db.commits).toHaveLength(0);
  });

  it('reports progress per committed batch', async () => {
    const db = fakeFirestore();
    const messages: string[] = [];

    await applySeedPlan(db.asFirestore(), planOf([warehouseWrite('blr')]), {
      onProgress: (message) => messages.push(message),
    });

    expect(messages.some((message) => message.includes('wrote 1 documents'))).toBe(true);
  });

  it('works with no progress callback', async () => {
    const db = fakeFirestore();

    await expect(
      applySeedPlan(db.asFirestore(), planOf([warehouseWrite('blr')])),
    ).resolves.toBeDefined();
  });
});

describe('resetSeededCollections', () => {
  it('clears only the collections the seed owns', async () => {
    const db = fakeFirestore();
    const cleared = await resetSeededCollections(db.asFirestore());

    expect(cleared).toBe(5);
    // Orders, users and reviews are not the seed's to delete.
    expect(db.deletedCollections).toEqual([
      'products',
      'categories',
      'warehouses',
      'inventory',
      'inventoryLedger',
    ]);
    expect(db.deletedCollections).not.toContain('orders');
    expect(db.deletedCollections).not.toContain('users');
  });

  it('removes documents in those collections', async () => {
    const db = fakeFirestore();
    db.documents.set(paths.product('wooden-blocks'), { name: 'Blocks' });
    db.documents.set(paths.order('order-1'), { humanId: 'RMP-1001' });

    await resetSeededCollections(db.asFirestore());

    expect(db.documents.has(paths.product('wooden-blocks'))).toBe(false);
    expect(db.documents.has(paths.order('order-1'))).toBe(true);
  });

  it('reports each collection it clears', async () => {
    const db = fakeFirestore();
    const messages: string[] = [];

    await resetSeededCollections(db.asFirestore(), {
      onProgress: (message) => messages.push(message),
    });

    expect(messages).toContain('cleared products');
  });

  it('works with no progress callback', async () => {
    const db = fakeFirestore();

    await expect(resetSeededCollections(db.asFirestore())).resolves.toBe(5);
  });
});
