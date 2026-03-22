import { PrismaClient } from "@prisma/client";
import cron from "node-cron";

const prisma = new PrismaClient();

async function runCleanup() {
  try {
    console.log("[InviteCodeCleaner] 开始执行过期邀请码清理任务...");
    
    // 1. 查找所有已过期或被禁用的邀请码
    const expiredCodes = await prisma.drInviteCode.findMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date() } },
          { disabled: true }
        ]
      },
      select: { codeId: true }
    });

    const codeIds = expiredCodes.map(c => c.codeId);

    if (codeIds.length === 0) {
      console.log("[InviteCodeCleaner] 没有需要清理的过期/禁用邀请码。");
      return;
    }

    // 2. 批量删除使用了这些邀请码的成员记录（取消他们的空间访问权限）
    const deleteResult = await prisma.drSpaceMember.deleteMany({
      where: {
        inviteCodeId: { in: codeIds }
      }
    });

    if (deleteResult.count > 0) {
      console.log(`[InviteCodeCleaner] 清理完成，已移除了 ${deleteResult.count} 个因邀请码过期而失效的成员。`);
    } else {
      console.log(`[InviteCodeCleaner] 检查完成，这些过期邀请码目前没有关联的有效成员需要移除。`);
    }

  } catch (error) {
    console.error("[InviteCodeCleaner] 清理任务执行失败:", error);
  }
}

export function startInviteCodeCleanupTask() {
  console.log("[InviteCodeCleaner] 每天清理过期邀请码成员的定时任务已挂载。");
  
  // 每天凌晨 3:00 执行清理任务 ("0 3 * * *")
  cron.schedule("0 3 * * *", () => {
    void runCleanup();
  });
}
