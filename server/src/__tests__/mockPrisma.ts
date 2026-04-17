/**
 * Shared Prisma mock. Import this in every test file.
 *
 * IMPORTANT: jest.mock() calls are hoisted by Jest only when they appear
 * directly in the test file. Since each test file imports from a different
 * relative path, we export a helper that each test file must call at the top level.
 */

function createModelMock() {
  return {
    findUnique: jest.fn().mockResolvedValue(null),
    findFirst: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({}),
    createMany: jest.fn().mockResolvedValue({ count: 0 }),
    update: jest.fn().mockResolvedValue({}),
    upsert: jest.fn().mockResolvedValue({}),
    delete: jest.fn().mockResolvedValue({}),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    count: jest.fn().mockResolvedValue(0),
    groupBy: jest.fn().mockResolvedValue([]),
  };
}

export const prismaMock = {
  drUser: createModelMock(),
  drSmsCode: createModelMock(),
  drSpace: createModelMock(),
  drSpaceMember: createModelMock(),
  drInviteCode: createModelMock(),
  drChannel: createModelMock(),
  drArticle: createModelMock(),
  drHighlight: createModelMock(),
  drCollection: createModelMock(),
  drCollectionArticle: createModelMock(),
  drSpaceCollection: createModelMock(),
  drSpaceCollectionArticle: createModelMock(),
  drSpaceHomepageModule: createModelMock(),
  drSpaceHomepageModuleResource: createModelMock(),
  drDailyPickArticle: createModelMock(),
  drDailyPickLattice: createModelMock(),
  drEditorHighlight: createModelMock(),
  drAiProvider: createModelMock(),
  drAiModel: createModelMock(),
  drAiQuota: createModelMock(),
  drAiUsage: createModelMock(),
  drSyncBackup: createModelMock(),
  drReadingStats: createModelMock(),
  appConfig: createModelMock(),
  $transaction: jest.fn().mockImplementation(async (ops: unknown[]) => {
    if (Array.isArray(ops)) for (const op of ops) await op;
  }),
  $executeRaw: jest.fn().mockResolvedValue(0),
  $executeRawUnsafe: jest.fn().mockResolvedValue(0),
};

export function resetAllMocks() {
  for (const value of Object.values(prismaMock)) {
    if (typeof value === "object" && value !== null) {
      for (const fn of Object.values(value)) {
        if (jest.isMockFunction(fn)) fn.mockClear();
      }
    } else if (jest.isMockFunction(value)) {
      value.mockClear();
    }
  }
}
