jest.mock("../../lib/prisma", () => {
  const { prismaMock } = require("../mockPrisma");
  return { __esModule: true, default: prismaMock };
});
jest.mock("../../lib/redis");
jest.mock("../../lib/configCache", () => ({
  getConfig: jest.fn().mockResolvedValue(null),
}));

import getRedis from "../../lib/redis";
import { prismaMock, resetAllMocks } from "../mockPrisma";
import {
  getHomepageModules,
  getDailyArticle,
  getThinkingLattice,
} from "../../services/deepread/drHomepageService";

const mockGetRedis = getRedis as jest.MockedFunction<typeof getRedis>;

describe("drHomepageService — Redis 与边界分支", () => {
  beforeEach(() => {
    resetAllMocks();
    mockGetRedis.mockReset();
  });

  it("getHomepageModules 缓存未命中时应构建并回填缓存", async () => {
    const redis = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue("OK") };
    mockGetRedis.mockReturnValue(redis as never);
    prismaMock.drSpaceHomepageModule.findMany.mockResolvedValue([
      {
        moduleId: "m1",
        spaceId: "sp_001",
        moduleType: "standard",
        title: "标题",
        subtitle: "",
        description: "",
        layoutType: "grid",
        sourceType: "",
        sourceId: "",
        sortOrder: 0,
      },
    ]);
    prismaMock.drSpaceHomepageModuleResource.findMany.mockResolvedValue([]);

    const result = await getHomepageModules("sp_001");

    expect(result).toHaveLength(1);
    expect(redis.set).toHaveBeenCalledWith(
      "homepage:modules:sp_001",
      expect.any(String),
      "EX",
      300,
    );
  });

  it("getHomepageModules 缓存命中时不应查询数据库", async () => {
    const cached = JSON.stringify({
      orderedModules: [
        {
          moduleId: "m1",
          moduleType: "standard",
          title: "缓存标题",
          subtitle: "",
          description: "",
          layoutType: "grid",
          sourceType: "",
          sourceId: "",
        },
      ],
      resourcesByModule: { m1: [] },
    });
    const redis = { get: jest.fn().mockResolvedValue(cached), set: jest.fn() };
    mockGetRedis.mockReturnValue(redis as never);

    const result = await getHomepageModules("sp_001");

    expect(result[0].title).toBe("缓存标题");
    expect(prismaMock.drSpaceHomepageModule.findMany).not.toHaveBeenCalled();
  });

  it("getDailyArticle 精选文章已被删除时应返回“文章不存在”", async () => {
    mockGetRedis.mockReturnValue(null as never);
    prismaMock.drSpaceMember.findMany.mockResolvedValue([{ spaceId: "sp_001" }]);
    prismaMock.drDailyPickArticle.findFirst.mockResolvedValue({
      articleId: "gone",
      spaceId: "sp_001",
      enabled: true,
    });
    prismaMock.drArticle.findUnique.mockResolvedValue(null);

    const result = await getDailyArticle(1);

    expect(result.article).toBeNull();
    expect(result.reason).toMatch("文章不存在");
  });

  it("getThinkingLattice 请求非加入空间时应返回 null", async () => {
    mockGetRedis.mockReturnValue(null as never);
    prismaMock.drSpaceMember.findMany.mockResolvedValue([{ spaceId: "sp_001" }]);

    const result = await getThinkingLattice(1, "sp_other");

    expect(result).toBeNull();
  });
});
