import type { ApiResponse, TaskStatus } from "@/types"

type BackendTask = {
  task_id?: string
  status?: string
  progress?: number
  total_files?: number
  processed_files?: number
  queue_position?: number | null
  filename?: string
  target_language?: string
  error_message?: string | null
  created_at?: string
  completed_at?: string | null
}

type DownloadUrlPayload =
  | string
  | {
      download_url?: string
      data?: {
        download_url?: string
      }
    }

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8001"
const API_BASE_URL = normalizeBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL || DEFAULT_API_BASE_URL)

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "")
}

function buildUrl(baseUrl: string, path: string): string {
  return `${baseUrl}${path}`
}

function mapStatus(status?: string): TaskStatus["status"] {
  switch (status) {
    case "pending":
      return "pending"
    case "preparing":
    case "translating":
    case "finalizing":
    case "processing":
      return "processing"
    case "completed":
      return "completed"
    case "failed":
      return "failed"
    case "cancelled":
      return "cancelled"
    default:
      return "pending"
  }
}

function getTaskMessage(task: BackendTask): string {
  if (task.status === "failed") {
    return task.error_message || "任务处理失败"
  }

  if (task.status === "completed") {
    return "任务处理完成"
  }

  if (task.status === "preparing") {
    return "正在准备文件"
  }

  if (task.status === "translating") {
    return "正在翻译文件"
  }

  if (task.status === "finalizing") {
    return "正在打包结果"
  }

  return "任务等待处理中"
}

function normalizeTask(task: BackendTask): TaskStatus {
  return {
    task_key: task.task_id,
    status: mapStatus(task.status),
    progress: Math.round((task.progress || 0) * 100) / 100,
    message: getTaskMessage(task),
    total_files: task.total_files || 0,
    processed_files: task.processed_files || 0,
    queue_position: task.queue_position ?? undefined,
    filename: task.filename,
    target_language: task.target_language,
    created_at: task.created_at,
    completed_at: task.completed_at || null,
    error_message: task.error_message || null,
  }
}

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as {
      detail?:
        | { message?: string }
        | Array<{
            msg?: string
            message?: string
          }>
        | string
      message?: string
    }

    if (typeof payload.detail === "string" && payload.detail) {
      return payload.detail
    }

    if (Array.isArray(payload.detail) && payload.detail.length > 0) {
      const first = payload.detail[0]
      if (first?.msg) {
        return first.msg
      }
      if (first?.message) {
        return first.message
      }
    }

    if (payload.detail && !Array.isArray(payload.detail) && typeof payload.detail === "object" && payload.detail.message) {
      return payload.detail.message
    }

    if (payload.message) {
      return payload.message
    }
  } catch {
    // ignore json parsing failure
  }

  return `后端服务错误 (${response.status})`
}

function getTaskIdFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null
  }

  const obj = payload as Record<string, unknown>
  if (typeof obj.task_id === "string" && obj.task_id) {
    return obj.task_id
  }

  if (obj.data && typeof obj.data === "object") {
    const data = obj.data as Record<string, unknown>
    if (typeof data.task_id === "string" && data.task_id) {
      return data.task_id
    }
  }

  return null
}

function encodeTaskKey(taskKey: string): string {
  return encodeURIComponent(taskKey)
}

function getDownloadUrl(payload: DownloadUrlPayload): string | null {
  if (typeof payload === "string") {
    return payload || null
  }

  const url = payload.download_url || payload.data?.download_url
  if (!url) {
    return null
  }

  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url
  }

  return buildUrl(API_BASE_URL, url.startsWith("/") ? url : `/${url}`)
}

export const api = {
  async createTask(file: File, translateStyle: string, targetLanguage: string = "zh-CN"): Promise<ApiResponse<string>> {
    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("target_language", targetLanguage)
      formData.append("translate_style", translateStyle)

      const response = await fetch(buildUrl(API_BASE_URL, "/v1/tasks"), {
        method: "POST",
        body: formData,
      })

      if (!response.ok) {
        return {
          success: false,
          data: "",
          message: await parseErrorMessage(response),
          error_code: "BACKEND_ERROR",
        }
      }

      const payload = await response.json()
      const taskId = getTaskIdFromPayload(payload)

      if (!taskId) {
        return {
          success: false,
          data: "",
          message: "后端未返回任务ID",
          error_code: "NO_TASK_ID",
        }
      }

      return {
        success: true,
        data: taskId,
      }
    } catch (error) {
      return {
        success: false,
        data: "",
        message: error instanceof Error ? error.message : "创建任务失败",
        error_code: "API_ERROR",
      }
    }
  },

  async getTaskStatus(taskKey: string): Promise<ApiResponse<TaskStatus>> {
    try {
      const response = await fetch(buildUrl(API_BASE_URL, `/v1/tasks/${encodeTaskKey(taskKey)}`), {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      })

      if (!response.ok) {
        return {
          success: false,
          data: {
            status: "failed",
          },
          message: await parseErrorMessage(response),
          error_code: response.status === 404 ? "TASK_NOT_FOUND" : "BACKEND_ERROR",
        }
      }

      const task = (await response.json()) as BackendTask
      return {
        success: true,
        data: normalizeTask(task),
      }
    } catch (error) {
      return {
        success: false,
        data: {
          status: "failed",
        },
        message: error instanceof Error ? error.message : "获取任务状态失败",
        error_code: "API_ERROR",
      }
    }
  },

  async cancelTask(taskKey: string): Promise<ApiResponse<null>> {
    try {
      const response = await fetch(buildUrl(API_BASE_URL, `/v1/tasks/${encodeTaskKey(taskKey)}`), {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
      })

      if (!response.ok) {
        return {
          success: false,
          data: null,
          message: await parseErrorMessage(response),
          error_code: response.status === 404 ? "TASK_NOT_FOUND" : "BACKEND_ERROR",
        }
      }

      return {
        success: true,
        data: null,
        message: "任务已取消",
      }
    } catch (error) {
      return {
        success: false,
        data: null,
        message: error instanceof Error ? error.message : "取消任务失败",
        error_code: "API_ERROR",
      }
    }
  },

  async getDownloadResultUrl(taskKey: string): Promise<string> {
    const response = await fetch(buildUrl(API_BASE_URL, `/v1/tasks/${encodeTaskKey(taskKey)}/result-url`), {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    })

    if (!response.ok) {
      throw new Error(await parseErrorMessage(response))
    }

    const payload = (await response.json()) as DownloadUrlPayload
    const downloadUrl = getDownloadUrl(payload)

    if (!downloadUrl) {
      throw new Error("未获取到下载链接")
    }

    return downloadUrl
  },

  async downloadResult(taskKey: string): Promise<Response> {
    const downloadUrl = await this.getDownloadResultUrl(taskKey)
    return fetch(downloadUrl, {
      method: "GET",
    })
  },

  async retryTask(taskKey: string): Promise<ApiResponse<TaskStatus>> {
    try {
      const response = await fetch(buildUrl(API_BASE_URL, `/v1/tasks/${encodeTaskKey(taskKey)}/retry`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      })

      if (!response.ok) {
        return {
          success: false,
          data: {
            status: "failed",
          },
          message: await parseErrorMessage(response),
          error_code: "BACKEND_ERROR",
        }
      }

      const task = (await response.json()) as BackendTask

      return {
        success: true,
        data: normalizeTask(task),
        message: "任务已重试",
      }
    } catch (error) {
      return {
        success: false,
        data: {
          status: "failed",
        },
        message: error instanceof Error ? error.message : "重试任务失败",
        error_code: "API_ERROR",
      }
    }
  },
}
