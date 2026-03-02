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
        task_type: "server_task" | "client_task";
        execution_name?: string;
        queue_position: number;
      };
    }
  | {
      ok: false;
      code: 400 | 404;
      message: string;
    };

export async function enqueueTaskByRegisteredName(
  prisma: PrismaClient,
  input: { taskName: string; taskPayload: unknown; executionName?: unknown }
): Promise<EnqueueByRegisteredNameResult> {
  const prepared = prepareRegisteredTask(input.taskName, input.taskPayload, input.executionName);
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
      targetClientId: prepared.payload.taskType === "client_task" ? prepared.payload.targetClientId ?? null : null,
      taskParams: JSON.stringify({
        task_payload: prepared.payload.taskPayload,
        required_tags: prepared.payload.requiredTags ?? [],
        execution_name: prepared.payload.executionName,
      }),
      status: "queued",
      statusInfo: JSON.stringify({
        queue_position: queueCount + 1,
        task_type: prepared.payload.taskType,
        registered_task_name: prepared.definition.taskName,
        execution_name: prepared.payload.executionName,
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
      execution_name: prepared.payload.executionName,
      queue_position: queueCount + 1,
    },
  };
}
