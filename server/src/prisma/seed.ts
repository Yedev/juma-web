import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const defaultConfigs: { key: string; value: object }[] = [
  {
    key: "global_json",
    value: { version: "1.0", theme: "dark", features: { notifications: true, analytics: false } },
  },
  {
    key: "app_settings",
    value: { language: "zh-CN", timezone: "Asia/Shanghai", maxRetries: 3, timeout: 30000 },
  },
  {
    key: "ad_config",
    value: { enabled: true, provider: "admob", interstitialId: "ca-app-pub-xxx", bannerId: "ca-app-pub-yyy", frequency: 5 },
  },
];

const sampleTasks: { name: string; params: object; status: string; statusInfo: object }[] = [
  {
    name: "数据导出任务",
    params: { format: "csv", target: "orders" },
    status: "completed",
    statusInfo: { output_url: "https://cdn.example.com/exports/orders_20260227.csv", file_size: "2.4MB", rows: 15820 },
  },
  {
    name: "用户画像分析",
    params: { segment: "vip_users" },
    status: "running",
    statusInfo: { current_step: "3/5 聚合用户行为数据", progress: 60 },
  },
  {
    name: "推送通知批量发送",
    params: { channel: "push", audience: "all" },
    status: "error",
    statusInfo: { error: "APNS 证书已过期，请更新推送证书后重试", error_code: "CERT_EXPIRED", failed_at_step: "2/4 连接 APNS 服务" },
  },
  {
    name: "日志清理",
    params: { retain_days: 30 },
    status: "queued",
    statusInfo: { queue_position: 3 },
  },
  {
    name: "报表生成",
    params: { type: "monthly", month: "2026-02" },
    status: "queued",
    statusInfo: { queue_position: 4 },
  },
  {
    name: "图片压缩批处理",
    params: { quality: 80, format: "webp" },
    status: "completed",
    statusInfo: { output_url: "https://cdn.example.com/compressed/batch_001.zip", file_size: "128MB", count: 342 },
  },
  {
    name: "数据库备份",
    params: { target: "production" },
    status: "running",
    statusInfo: { current_step: "1/3 导出数据表", progress: 25 },
  },
  {
    name: "缓存预热",
    params: { scope: "hot_products" },
    status: "error",
    statusInfo: { error: "Redis 连接超时，目标节点 redis-cluster-03 无响应", error_code: "CONN_TIMEOUT", failed_at_step: "1/2 连接 Redis 集群" },
  },
];

async function main() {
  const existing = await prisma.adminUser.findUnique({
    where: { username: "juma" },
  });

  if (!existing) {
    const hashedPassword = await bcrypt.hash("juma2026", 10);
    await prisma.adminUser.create({
      data: { username: "juma", password: hashedPassword },
    });
    console.log("Seed: created default admin user (juma)");
  } else {
    console.log("Seed: admin user already exists, skipping");
  }

  for (const cfg of defaultConfigs) {
    const exists = await prisma.appConfig.findUnique({
      where: { configKey: cfg.key },
    });
    if (!exists) {
      await prisma.appConfig.create({
        data: { configKey: cfg.key, configValue: JSON.stringify(cfg.value, null, 2) },
      });
      console.log(`Seed: created config '${cfg.key}'`);
    } else {
      console.log(`Seed: config '${cfg.key}' already exists, skipping`);
    }
  }

  const taskCount = await prisma.task.count();
  if (taskCount === 0) {
    for (let i = 0; i < sampleTasks.length; i++) {
      const t = sampleTasks[i];
      const taskId = `T${Date.now() - (sampleTasks.length - i) * 60000}${String(i).padStart(3, "0")}`;
      await prisma.task.create({
        data: {
          taskId,
          taskName: t.name,
          taskParams: JSON.stringify(t.params),
          status: t.status,
          statusInfo: JSON.stringify(t.statusInfo),
        },
      });
    }
    console.log(`Seed: created ${sampleTasks.length} sample tasks`);
  } else {
    console.log("Seed: tasks already exist, skipping");
  }

  // ── DeepRead seed data ──

  // Test user
  const drUserExists = await prisma.drUser.findUnique({ where: { phone: "13800138000" } });
  if (!drUserExists) {
    await prisma.drUser.create({
      data: { phone: "13800138000", nickname: "测试用户" },
    });
    console.log("Seed: created DR test user (13800138000)");
  }

  // Space
  const spaceExists = await prisma.drSpace.findUnique({ where: { inviteCode: "DEEP2026" } });
  if (!spaceExists) {
    const space = await prisma.drSpace.create({
      data: {
        spaceId: "S1000001",
        name: "DeepRead 精选",
        description: "精选优质长文，深度阅读体验",
        inviteCode: "DEEP2026",
      },
    });

    // Add test user as member
    const testUser = await prisma.drUser.findUnique({ where: { phone: "13800138000" } });
    if (testUser) {
      await prisma.drSpaceMember.create({
        data: { spaceId: space.spaceId, userId: testUser.id, role: "admin" },
      });
    }

    // Channels
    const ch1 = await prisma.drChannel.create({
      data: { channelId: "CH1000001", spaceId: space.spaceId, name: "科技前沿", sortOrder: 1 },
    });
    const ch2 = await prisma.drChannel.create({
      data: { channelId: "CH1000002", spaceId: space.spaceId, name: "深度评论", sortOrder: 2 },
    });

    // Articles
    const articles = [
      {
        articleId: "A1000001",
        channelId: ch1.channelId,
        title: "人工智能如何重塑未来教育",
        summary: "探讨 AI 技术在教育领域的应用前景与挑战",
        author: "张明",
        contentHtml: `<h2>引言</h2><p>人工智能正在以前所未有的速度改变着教育行业。从个性化学习路径到智能评估系统，AI 技术正在重新定义我们对教育的理解。</p><h2>个性化学习</h2><p>传统的一刀切教育模式正在被 AI 驱动的个性化学习所取代。通过分析学生的学习行为数据，AI 系统能够为每位学生制定最适合的学习计划。</p><h2>智能评估</h2><p>AI 不仅能够自动批改作业和考试，还能分析学生的知识薄弱点，提供针对性的改进建议。这大大减轻了教师的负担，同时提高了评估的准确性。</p><h2>未来展望</h2><p>随着技术的不断进步，我们可以预见 AI 将在教育中扮演越来越重要的角色。但我们也需要注意，技术应该服务于教育的本质——培养具有创造力和批判性思维的人才。</p>`,
      },
      {
        articleId: "A1000002",
        channelId: ch1.channelId,
        title: "量子计算的突破与商业化前景",
        summary: "解析量子计算最新进展及其对各行业的潜在影响",
        author: "李华",
        contentHtml: `<h2>量子优势的实现</h2><p>2025年，多家科技公司宣布在特定任务上实现了量子优势。这意味着量子计算机在某些计算任务上已经超越了最强大的经典计算机。</p><h2>商业应用场景</h2><p>量子计算在药物研发、金融建模、物流优化等领域展现出巨大的潜力。制药公司已开始利用量子模拟来加速新药发现过程。</p><h2>技术挑战</h2><p>尽管取得了显著进展，量子计算仍面临诸多挑战：量子退相干、纠错码的复杂性、以及极低的工作温度要求等。</p><h2>投资趋势</h2><p>全球对量子计算的投资在过去两年增长了300%，政府和企业纷纷加大研发力度，争夺这一战略性技术的领先地位。</p>`,
      },
      {
        articleId: "A1000003",
        channelId: ch2.channelId,
        title: "数字化转型中的组织变革",
        summary: "企业如何在数字化浪潮中完成组织架构的根本性变革",
        author: "王芳",
        contentHtml: `<h2>数字化不仅仅是技术升级</h2><p>许多企业将数字化转型简单理解为引入新技术，但真正的转型需要从组织文化、业务流程、人才结构等多个维度进行根本性变革。</p><h2>敏捷组织的构建</h2><p>传统的层级式组织架构已无法适应快速变化的数字经济。越来越多的企业开始采用扁平化、网络化的组织结构，建立跨职能团队。</p><h2>数据驱动的决策文化</h2><p>数字化组织的核心特征之一是数据驱动的决策文化。这要求企业建立完善的数据治理体系，培养全员的数据素养。</p><h2>变革管理的艺术</h2><p>组织变革最大的挑战往往不在技术层面，而在于人的因素。如何有效管理变革阻力，激发员工的创新热情，是每位领导者都需要面对的课题。</p>`,
      },
      {
        articleId: "A1000004",
        channelId: ch2.channelId,
        title: "可持续发展与商业创新的融合",
        summary: "探索ESG理念如何驱动新一轮商业创新浪潮",
        author: "赵强",
        contentHtml: `<h2>ESG 不再是选择题</h2><p>环境（E）、社会（S）和治理（G）已成为衡量企业价值的重要维度。投资者、消费者和监管机构都在推动企业更加重视可持续发展。</p><h2>绿色技术创新</h2><p>从碳捕获到生物降解材料，绿色技术创新正在创造巨大的商业机会。那些在可持续技术领域领先的企业将在未来竞争中占据优势。</p><h2>循环经济模式</h2><p>线性的"生产-消费-丢弃"模式正在被循环经济所替代。产品即服务（PaaS）、再制造和再利用等商业模式正在重塑多个行业。</p><h2>社会影响力投资</h2><p>越来越多的投资者开始关注社会影响力回报，推动了社会企业和影响力投资的快速发展。</p>`,
      },
    ];

    for (const a of articles) {
      await prisma.drArticle.create({
        data: {
          ...a,
          spaceId: space.spaceId,
        },
      });
    }

    console.log("Seed: created DR space, 2 channels, 4 articles");
  } else {
    console.log("Seed: DR space already exists, skipping");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
