import prisma from "../../lib/prisma";

export async function exportData(userId: number) {
  const backup = await prisma.drSyncBackup.findUnique({
    where: { userId },
  });
  return backup ? backup.data : null;
}

export async function importData(userId: number, data: string) {
  return prisma.drSyncBackup.upsert({
    where: { userId },
    update: { data },
    create: { userId, data },
  });
}
