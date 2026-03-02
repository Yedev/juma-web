import { PrismaClient } from "@prisma/client";
import { prepareRegisteredTask } from "./taskRegistry";

function generateTaskId(): string {
  return `T${Date.now()}${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0")}`;
}

export type EnqueueByRegisteredNameResult =
  | {
      ok: true;
      data: {
        task_id: string;
        task_name: string;
        task_title: string;
        task_type: "server_script" | "remote_mac";
        execute_mode: "script" | "service";
        queue_position: number;
      };
    }
  | {
      ok: false;
      code: 404;
      message: string;
    };

export async function enqueueTaskByRegisteredName(
  prisma: PrismaClient,
  input: { taskName: string; taskParams: unknown }
): Promise<EnqueueByRegisteredNameResult> {
  const prepared = prepareRegisteredTask(input.taskName, input.taskParams);
  if (!prepared.ok) {
    return prepared;
  }

  const queueCount = await prisma.task.count({
    where: { status: "queued" },
  });

  const created = await prisma.task.create({
    data: {
      taskId: generateTaskId(),
      taskName: prepared.definition.taskName,
      taskType: prepared.payload.taskType,
      targetClientId: prepared.payload.taskType === "remote_mac" ? prepared.payload.targetClientId ?? null : null,
      taskParams: JSON.stringify(prepared.payload.taskParams),
      status: "queued",
      statusInfo: JSON.stringify({
        queue_position: queueCount + 1,
        task_type: prepared.payload.taskType,
        execute_mode: prepared.payload.executeMode,
        registered_task_name: prepared.definition.taskName,
      }),
      maxRetries: prepared.payload.maxRetries ?? 0,
    },
  });

  return {
    ok: true,
    data: {
      task_id: created.taskId,
      task_name: prepared.definition.taskName,
      task_title: prepared.definition.title,
      task_type: prepared.payload.taskType,
      execute_mode: prepared.payload.executeMode,
      queue_position: queueCount + 1,
    },
  };
}
